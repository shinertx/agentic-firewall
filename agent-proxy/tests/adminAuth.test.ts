import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initAdminCredentials,
    validateCredentials,
    hasCredentialsConfigured,
    createSession,
    validateSession,
    destroySession,
    parseCookies,
    requireAdminAuth,
    requireAdminPage,
} from '../src/adminAuth';

// Mock Express request/response
function mockReq(overrides: any = {}): any {
    return {
        headers: {},
        ip: overrides.ip || undefined,
        socket: { remoteAddress: overrides.remoteAddress || '10.0.0.1' },
        ...overrides,
    };
}

function mockRes(): any {
    const res: any = {
        statusCode: 200,
        _json: null,
        _redirect: null,
    };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (data: any) => { res._json = data; return res; };
    res.redirect = (url: string) => { res._redirect = url; return res; };
    return res;
}

describe('Admin Auth', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('initAdminCredentials + validateCredentials', () => {
        it('should initialize and validate correct credentials', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'secret123';
            initAdminCredentials();

            expect(hasCredentialsConfigured()).toBe(true);
            expect(validateCredentials('admin', 'secret123')).toBe(true);
        });

        it('should reject wrong password', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'secret123';
            initAdminCredentials();

            expect(validateCredentials('admin', 'wrongpass')).toBe(false);
        });

        it('should reject wrong username', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'secret123';
            initAdminCredentials();

            expect(validateCredentials('notadmin', 'secret123')).toBe(false);
        });

        it('should return false when no credentials configured', () => {
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            delete process.env.ADMIN_TOKEN;
            initAdminCredentials();

            expect(hasCredentialsConfigured()).toBe(false);
            expect(validateCredentials('admin', 'secret123')).toBe(false);
        });

        it('should accept ADMIN_TOKEN as password in token-only mode', () => {
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            process.env.ADMIN_TOKEN = 'my-secret-token';
            initAdminCredentials();

            expect(hasCredentialsConfigured()).toBe(false);
            expect(validateCredentials('anything', 'my-secret-token')).toBe(true);
            expect(validateCredentials('anything', 'wrong-token')).toBe(false);
        });

        it('should handle partial env (only user, no pass)', () => {
            process.env.ADMIN_USER = 'admin';
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            expect(hasCredentialsConfigured()).toBe(false);
        });
    });

    describe('Session management', () => {
        it('should create and validate a session', () => {
            const sessionId = createSession('admin');
            expect(typeof sessionId).toBe('string');
            expect(sessionId.length).toBe(64); // 32 bytes = 64 hex chars
            expect(validateSession(sessionId)).toBe(true);
        });

        it('should reject invalid session id', () => {
            expect(validateSession('nonexistent')).toBe(false);
        });

        it('should destroy a session', () => {
            const sessionId = createSession('admin');
            expect(validateSession(sessionId)).toBe(true);
            destroySession(sessionId);
            expect(validateSession(sessionId)).toBe(false);
        });
    });

    describe('parseCookies', () => {
        it('should parse standard cookie header', () => {
            expect(parseCookies('admin_session=abc123; theme=dark')).toEqual({
                admin_session: 'abc123',
                theme: 'dark',
            });
        });

        it('should handle undefined', () => {
            expect(parseCookies(undefined)).toEqual({});
        });

        it('should handle empty string', () => {
            expect(parseCookies('')).toEqual({});
        });

        it('should handle URL-encoded values', () => {
            const cookies = parseCookies('name=hello%20world');
            expect(cookies.name).toBe('hello world');
        });
    });

    describe('requireAdminAuth middleware', () => {
        it('should allow localhost access when nothing configured', () => {
            delete process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ ip: '127.0.0.1' });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(true);
        });

        it('should reject remote access when nothing configured', () => {
            delete process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ ip: '203.0.113.5' });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('should accept valid Bearer token', () => {
            process.env.ADMIN_TOKEN = 'my-secret-token';
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ headers: { authorization: 'Bearer my-secret-token' } });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(true);
        });

        it('should reject invalid Bearer token', () => {
            process.env.ADMIN_TOKEN = 'my-secret-token';
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ headers: { authorization: 'Bearer wrong-token' } });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(false);
            expect(res.statusCode).toBe(401);
        });

        it('should accept valid session cookie', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'test';
            delete process.env.ADMIN_TOKEN;
            initAdminCredentials();

            const sessionId = createSession('admin');
            const req = mockReq({ headers: { cookie: `admin_session=${sessionId}` } });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(true);

            destroySession(sessionId);
        });

        it('should accept session cookie in token-only mode', () => {
            process.env.ADMIN_TOKEN = 'my-secret-token';
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const sessionId = createSession('admin');
            const req = mockReq({ headers: { cookie: `admin_session=${sessionId}` } });
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(true);

            destroySession(sessionId);
        });

        it('should reject missing auth when token configured', () => {
            process.env.ADMIN_TOKEN = 'my-secret-token';
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq();
            const res = mockRes();
            let called = false;
            requireAdminAuth(req, res, () => { called = true; });
            expect(called).toBe(false);
            expect(res.statusCode).toBe(401);
        });
    });

    describe('requireAdminPage middleware', () => {
        it('should redirect to /admin/login when not authenticated', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'test';
            delete process.env.ADMIN_TOKEN;
            initAdminCredentials();

            const req = mockReq();
            const res = mockRes();
            let called = false;
            requireAdminPage(req, res, () => { called = true; });
            expect(called).toBe(false);
            expect(res._redirect).toBe('/admin/login');
        });

        it('should allow access with valid session cookie', () => {
            process.env.ADMIN_USER = 'admin';
            process.env.ADMIN_PASS = 'test';
            delete process.env.ADMIN_TOKEN;
            initAdminCredentials();

            const sessionId = createSession('admin');
            const req = mockReq({ headers: { cookie: `admin_session=${sessionId}` } });
            const res = mockRes();
            let called = false;
            requireAdminPage(req, res, () => { called = true; });
            expect(called).toBe(true);

            destroySession(sessionId);
        });

        it('should allow localhost access when nothing configured', () => {
            delete process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ ip: '::1' });
            const res = mockRes();
            let called = false;
            requireAdminPage(req, res, () => { called = true; });
            expect(called).toBe(true);
        });

        it('should redirect remote access when nothing configured', () => {
            delete process.env.ADMIN_TOKEN;
            delete process.env.ADMIN_USER;
            delete process.env.ADMIN_PASS;
            initAdminCredentials();

            const req = mockReq({ ip: '203.0.113.5' });
            const res = mockRes();
            let called = false;
            requireAdminPage(req, res, () => { called = true; });
            expect(called).toBe(false);
            expect(res._redirect).toBe('/admin/login');
        });
    });
});
