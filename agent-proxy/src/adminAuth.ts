/**
 * Admin Authentication — scrypt-hashed credentials with session cookies.
 *
 * Behavior matrix:
 * | ADMIN_USER+PASS | ADMIN_TOKEN | Result                            |
 * |-----------------|-------------|-----------------------------------|
 * | Not set         | Not set     | Open access (backward compat)     |
 * | Not set         | Set         | Bearer-only (existing behavior)   |
 * | Set             | Not set     | Cookie login for pages             |
 * | Set             | Set         | Both work (recommended)           |
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ─── Credential Storage ─────────────────────────────────

let adminUser: string | null = null;
let adminPassHash: Buffer | null = null;
let adminSalt: Buffer | null = null;

const SCRYPT_KEYLEN = 64;

/**
 * Initialize admin credentials from environment variables.
 * Call once at startup after dotenv loads.
 */
export function initAdminCredentials(): void {
    const user = process.env.ADMIN_USER;
    const pass = process.env.ADMIN_PASS;

    if (!user || !pass) {
        adminUser = null;
        adminPassHash = null;
        adminSalt = null;
        return;
    }

    adminUser = user;
    // Deterministic salt from username for consistent hashing
    adminSalt = crypto.createHash('sha256').update(user).digest();
    adminPassHash = crypto.scryptSync(pass, adminSalt, SCRYPT_KEYLEN);
    console.log(`[ADMIN AUTH] Credentials initialized for user: ${user}`);
}

/**
 * Validate username + password against stored credentials.
 */
export function validateCredentials(username: string, password: string): boolean {
    if (!adminUser || !adminPassHash || !adminSalt) return false;
    if (username !== adminUser) return false;

    const hash = crypto.scryptSync(password, adminSalt, SCRYPT_KEYLEN);
    return crypto.timingSafeEqual(hash, adminPassHash);
}

export function hasCredentialsConfigured(): boolean {
    return adminUser !== null && adminPassHash !== null;
}

// ─── Session Management ─────────────────────────────────

interface Session {
    createdAt: number;
    username: string;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createSession(username: string): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { createdAt: Date.now(), username });
    return sessionId;
}

export function validateSession(sessionId: string): boolean {
    const session = sessions.get(sessionId);
    if (!session) return false;
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(sessionId);
        return false;
    }
    return true;
}

export function destroySession(sessionId: string): void {
    sessions.delete(sessionId);
}

// Cleanup expired sessions every 5 minutes
const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            sessions.delete(id);
        }
    }
}, 5 * 60 * 1000);
sessionCleanupInterval.unref();

// ─── Cookie Helpers ─────────────────────────────────────

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) return {};
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split(';')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        cookies[key] = decodeURIComponent(val);
    }
    return cookies;
}

// ─── Middleware ──────────────────────────────────────────

/**
 * Admin auth for API endpoints — returns 401 JSON on failure.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    const adminToken = process.env.ADMIN_TOKEN;
    const credsConfigured = hasCredentialsConfigured();

    // If neither ADMIN_TOKEN nor ADMIN_USER/PASS are configured → open access
    if (!adminToken && !credsConfigured) {
        next();
        return;
    }

    // Check Bearer token
    const authHeader = req.headers.authorization;
    if (adminToken && authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (token === adminToken) {
            next();
            return;
        }
    }

    // Check session cookie
    if (credsConfigured) {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies['admin_session'];
        if (sessionId && validateSession(sessionId)) {
            next();
            return;
        }
    }

    res.status(401).json({ error: { message: 'Admin authentication required' } });
}

/**
 * Admin auth for page routes — redirects to /admin/login on failure.
 */
export function requireAdminPage(req: Request, res: Response, next: NextFunction): void {
    const adminToken = process.env.ADMIN_TOKEN;
    const credsConfigured = hasCredentialsConfigured();

    // If nothing configured → open access
    if (!adminToken && !credsConfigured) {
        next();
        return;
    }

    // Check Bearer token (for API clients hitting page routes)
    const authHeader = req.headers.authorization;
    if (adminToken && authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (token === adminToken) {
            next();
            return;
        }
    }

    // Check session cookie
    if (credsConfigured) {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies['admin_session'];
        if (sessionId && validateSession(sessionId)) {
            next();
            return;
        }
    }

    res.redirect('/admin/login');
}
