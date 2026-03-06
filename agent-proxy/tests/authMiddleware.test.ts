import { afterEach, describe, expect, it } from 'vitest';
import { authMiddleware } from '../src/authMiddleware';

function mockReq(overrides: Record<string, unknown> = {}) {
    return {
        path: '/v1/chat/completions',
        method: 'POST',
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        headers: {},
        ...overrides,
    } as any;
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        body: null,
    };
    res.status = (code: number) => {
        res.statusCode = code;
        return res;
    };
    res.json = (payload: unknown) => {
        res.body = payload;
        return res;
    };
    return res;
}

describe('authMiddleware', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('allows localhost POSTs without provider headers in local mode', () => {
        process.env.PUBLIC_MODE = 'false';
        const req = mockReq();
        const res = mockRes();
        let called = false;

        authMiddleware(req, res, () => {
            called = true;
        });

        expect(called).toBe(true);
        expect(res.statusCode).toBe(200);
    });

    it('rejects remote POSTs in local mode', () => {
        process.env.PUBLIC_MODE = 'false';
        const req = mockReq({
            ip: '198.51.100.10',
            socket: { remoteAddress: '198.51.100.10' },
        });
        const res = mockRes();
        let called = false;

        authMiddleware(req, res, () => {
            called = true;
        });

        expect(called).toBe(false);
        expect(res.statusCode).toBe(403);
    });

    it('requires x-firewall-token in local mode when LOCAL_TOKEN is set', () => {
        process.env.PUBLIC_MODE = 'false';
        process.env.LOCAL_TOKEN = 'secret-token';
        const req = mockReq();
        const res = mockRes();
        let called = false;

        authMiddleware(req, res, () => {
            called = true;
        });

        expect(called).toBe(false);
        expect(res.statusCode).toBe(401);
    });

    it('allows local mode requests with the matching x-firewall-token', () => {
        process.env.PUBLIC_MODE = 'false';
        process.env.LOCAL_TOKEN = 'secret-token';
        const req = mockReq({
            headers: { 'x-firewall-token': 'secret-token' },
        });
        const res = mockRes();
        let called = false;

        authMiddleware(req, res, () => {
            called = true;
        });

        expect(called).toBe(true);
        expect(res.statusCode).toBe(200);
    });

    it('requires provider headers in public mode', () => {
        delete process.env.PUBLIC_MODE;
        const req = mockReq();
        const res = mockRes();
        let called = false;

        authMiddleware(req, res, () => {
            called = true;
        });

        expect(called).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});
