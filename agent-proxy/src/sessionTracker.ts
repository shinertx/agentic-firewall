import { Request } from 'express';
import crypto from 'crypto';
import { getInputCost } from './pricing';
import { isRedisAvailable, getRedisClient } from './redis';

export interface SessionData {
    sessionId: string;
    userId: string;
    createdAt: string;
    lastActivityAt: string;
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    savedMoney: number;
    savedTokens: number;
    blockedLoops: number;
    models: Record<string, number>;
    status: 'active' | 'expired';
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 1000;

// Redis key patterns
const REDIS_SESSION_PREFIX = 'firewall:session:';
const REDIS_SESSION_IDS_KEY = 'firewall:session_ids';
const REDIS_SESSION_TTL_SECS = Math.ceil(SESSION_TTL_MS / 1000);

const sessions = new Map<string, SessionData>();

/**
 * Derive a session ID from the request. Uses explicit header if present,
 * otherwise hashes (userId + model + system prefix) for fingerprinting.
 */
export function resolveSessionId(req: Request): string {
    const explicit = req.headers['x-session-id'];
    if (explicit) return String(explicit);

    const userId = (req.headers['x-api-key'] as string) || req.ip || '127.0.0.1';
    const body = (req as any).body || {};
    const model: string = body.model || '';

    let firstSystemContent = '';
    if (typeof body.system === 'string') {
        firstSystemContent = body.system.slice(0, 200);
    } else if (Array.isArray(body.messages) && body.messages.length > 0 && body.messages[0].role === 'system') {
        const content = body.messages[0].content;
        firstSystemContent = (typeof content === 'string' ? content : '').slice(0, 200);
    }

    return crypto
        .createHash('sha256')
        .update(userId + model + firstSystemContent)
        .digest('hex')
        .slice(0, 16);
}

/**
 * Return existing session or create a new one. Evicts oldest session
 * when the map exceeds MAX_SESSIONS.
 */
export function getOrCreateSession(sessionId: string, userId: string): SessionData {
    const existing = sessions.get(sessionId);
    if (existing) {
        existing.lastActivityAt = new Date().toISOString();
        existing.status = 'active';
        return existing;
    }

    // Evict oldest session if at capacity
    if (sessions.size >= MAX_SESSIONS) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [key, session] of sessions) {
            const ts = new Date(session.lastActivityAt).getTime();
            if (ts < oldestTime) {
                oldestTime = ts;
                oldestKey = key;
            }
        }
        if (oldestKey) sessions.delete(oldestKey);
    }

    const now = new Date().toISOString();
    const session: SessionData = {
        sessionId,
        userId,
        createdAt: now,
        lastActivityAt: now,
        totalSpend: 0,
        totalTokens: 0,
        totalRequests: 0,
        savedMoney: 0,
        savedTokens: 0,
        blockedLoops: 0,
        models: {},
        status: 'active',
    };
    sessions.set(sessionId, session);
    syncSessionToRedis(sessionId, session);
    return session;
}

/**
 * Record estimated spend for a request. CDN hits apply 90% savings.
 */
export function recordSessionSpend(
    sessionId: string,
    model: string,
    estimatedTokens: number,
    isCDN: boolean,
): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    const costPerToken = getInputCost(model) / 1_000_000;
    const spend = estimatedTokens * costPerToken;

    session.totalSpend += spend;
    session.totalTokens += estimatedTokens;
    session.totalRequests += 1;
    session.models[model] = (session.models[model] || 0) + 1;

    if (isCDN) {
        session.savedMoney += spend * 0.9;
        session.savedTokens += estimatedTokens * 0.9;
    }

    syncSessionToRedis(sessionId, session);
}

/**
 * Increment the blocked-loops counter for a session.
 */
export function recordSessionLoop(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.blockedLoops += 1;
    syncSessionToRedis(sessionId, session);
}

/**
 * Reconcile estimated spend with real token counts from the provider response.
 * Adjusts totalSpend and totalTokens by the delta between real and estimated values.
 */
export function reconcileSessionSpend(
    sessionId: string,
    model: string,
    estimatedTokens: number,
    realInputTokens: number,
    realOutputTokens: number,
    isCDN: boolean,
): void {
    const session = sessions.get(sessionId);
    if (!session) return;

    const costPerToken = getInputCost(model) / 1_000_000;
    const realTokens = realInputTokens + realOutputTokens;
    const delta = realTokens - estimatedTokens;

    session.totalSpend += delta * costPerToken;
    session.totalTokens += delta;

    if (isCDN) {
        const deltaSpend = delta * costPerToken;
        session.savedMoney += deltaSpend * 0.9;
        session.savedTokens += delta * 0.9;
    }

    syncSessionToRedis(sessionId, session);
}

export function getSessionStats(sessionId: string): SessionData | null {
    return sessions.get(sessionId) || null;
}

export function getUserSessions(userId: string): SessionData[] {
    const result: SessionData[] = [];
    for (const session of sessions.values()) {
        if (session.userId === userId) result.push(session);
    }
    return result;
}

export function getAllSessions(): SessionData[] {
    return Array.from(sessions.values());
}

/**
 * Mark sessions with no activity within SESSION_TTL_MS as expired.
 * Returns the number of sessions expired this cycle.
 */
export function expireStaleSessions(): number {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let count = 0;
    for (const session of sessions.values()) {
        if (session.status === 'active' && new Date(session.lastActivityAt).getTime() < cutoff) {
            session.status = 'expired';
            count++;
        }
    }
    return count;
}

// ─── Redis sync helpers ──────────────────────────────────

/** Sync a single session record to Redis with TTL (non-blocking). */
function syncSessionToRedis(sessionId: string, session: SessionData): void {
    const redis = getRedisClient();
    if (!redis) return;
    const key = REDIS_SESSION_PREFIX + sessionId;
    redis.hset(key, {
        sessionId: session.sessionId,
        userId: session.userId,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        totalSpend: session.totalSpend.toString(),
        totalTokens: session.totalTokens.toString(),
        totalRequests: session.totalRequests.toString(),
        savedMoney: session.savedMoney.toString(),
        savedTokens: session.savedTokens.toString(),
        blockedLoops: session.blockedLoops.toString(),
        models: JSON.stringify(session.models),
        status: session.status,
    }).then(() => {
        redis.expire(key, REDIS_SESSION_TTL_SECS);
        redis.sadd(REDIS_SESSION_IDS_KEY, sessionId);
    }).catch(() => {});
}

/** Load all session data from Redis into memory. */
export async function loadSessionsFromRedis(): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;
    try {
        const sessionIds = await redis.smembers(REDIS_SESSION_IDS_KEY);
        if (!sessionIds.length) return false;
        let loaded = 0;
        for (const id of sessionIds) {
            const data = await redis.hgetall(REDIS_SESSION_PREFIX + id);
            if (data && data.sessionId) {
                sessions.set(id, {
                    sessionId: data.sessionId,
                    userId: data.userId,
                    createdAt: data.createdAt,
                    lastActivityAt: data.lastActivityAt,
                    totalSpend: parseFloat(data.totalSpend) || 0,
                    totalTokens: parseFloat(data.totalTokens) || 0,
                    totalRequests: parseInt(data.totalRequests) || 0,
                    savedMoney: parseFloat(data.savedMoney) || 0,
                    savedTokens: parseFloat(data.savedTokens) || 0,
                    blockedLoops: parseInt(data.blockedLoops) || 0,
                    models: data.models ? JSON.parse(data.models) : {},
                    status: (data.status as 'active' | 'expired') || 'active',
                });
                loaded++;
            } else {
                // Key expired in Redis, remove from set
                redis.srem(REDIS_SESSION_IDS_KEY, id).catch(() => {});
            }
        }
        if (loaded > 0) {
            console.log(`[SESSIONS] Loaded ${loaded} sessions from Redis`);
        }
        return loaded > 0;
    } catch (err) {
        console.error('[SESSIONS] Failed to load from Redis:', err);
        return false;
    }
}

/** Bulk sync all sessions to Redis. */
export async function saveSessionsToRedis(): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;
    try {
        const pipeline = redis.pipeline();
        for (const [id, session] of sessions) {
            const key = REDIS_SESSION_PREFIX + id;
            pipeline.hset(key, {
                sessionId: session.sessionId,
                userId: session.userId,
                createdAt: session.createdAt,
                lastActivityAt: session.lastActivityAt,
                totalSpend: session.totalSpend.toString(),
                totalTokens: session.totalTokens.toString(),
                totalRequests: session.totalRequests.toString(),
                savedMoney: session.savedMoney.toString(),
                savedTokens: session.savedTokens.toString(),
                blockedLoops: session.blockedLoops.toString(),
                models: JSON.stringify(session.models),
                status: session.status,
            });
            pipeline.expire(key, REDIS_SESSION_TTL_SECS);
            pipeline.sadd(REDIS_SESSION_IDS_KEY, id);
        }
        await pipeline.exec();
    } catch (err) {
        console.error('[SESSIONS] Failed to save to Redis:', err);
    }
}

// ─── Persistence (export/import pattern — file fallback) ──

/**
 * Serialize all session data to a plain object for persistence.
 */
export function exportSessionData(): Record<string, SessionData> {
    const out: Record<string, SessionData> = {};
    for (const [key, session] of sessions) {
        out[key] = session;
    }
    return out;
}

/**
 * Restore session data from a previously exported plain object.
 */
export function importSessionData(data: Record<string, SessionData>): void {
    for (const [key, session] of Object.entries(data)) {
        sessions.set(key, session);
    }
}

// Periodic cleanup of stale sessions (every 60s, does not block process exit)
setInterval(expireStaleSessions, 60_000).unref();
