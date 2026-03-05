import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attemptShadowRouterFailover } from '../src/shadowRouter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function okResponse() {
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }) };
}

function errorResponse(status: number) {
    return { ok: false, status, headers: new Headers() };
}

describe('Shadow Router', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    describe('Anthropic failover', () => {
        it('should failover sonnet to haiku on 429', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            const result = await attemptShadowRouterFailover(
                { model: 'claude-sonnet-4-6', messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).not.toBeNull();
            expect(mockFetch).toHaveBeenCalledOnce();
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('claude-haiku-4-5');
        });

        it('should failover opus to sonnet on 429', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            const result = await attemptShadowRouterFailover(
                { model: 'claude-opus-4-6', messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).not.toBeNull();
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('claude-sonnet-4-6');
        });

        it('should not failover haiku (already cheapest)', async () => {
            const result = await attemptShadowRouterFailover(
                { model: 'claude-haiku-4-5', messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should strip thinking parameters from failover body', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            await attemptShadowRouterFailover(
                { model: 'claude-sonnet-4-6', messages: [], thinking: { type: 'enabled', budget_tokens: 5000 } },
                { 'x-api-key': 'test' },
            );
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.thinking).toBeUndefined();
        });
    });

    describe('OpenAI failover', () => {
        it('should failover gpt-4o to gpt-4o-mini', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            const result = await attemptShadowRouterFailover(
                { model: 'gpt-4o', messages: [] },
                { 'authorization': 'Bearer test' },
            );
            expect(result).not.toBeNull();
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('gpt-4o-mini');
            expect(mockFetch.mock.calls[0][0]).toContain('openai.com');
        });

        it('should not failover gpt-4o-mini (already cheapest)', async () => {
            const result = await attemptShadowRouterFailover(
                { model: 'gpt-4o-mini', messages: [] },
                { 'authorization': 'Bearer test' },
            );
            expect(result).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('Gemini failover', () => {
        it('should failover gemini-2.5-pro to gemini-2.5-flash via URL', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=test';
            const body = { model: 'gemini-2.5-pro', contents: [{ parts: [{ text: 'hello' }] }] };
            const result = await attemptShadowRouterFailover(
                body,
                { 'x-goog-api-key': 'test' },
                geminiUrl,
            );
            expect(mockFetch).toHaveBeenCalledOnce();
            expect(result).not.toBeNull();
            // Verify the URL was rewritten with flash model
            const calledUrl = mockFetch.mock.calls[0][0];
            expect(calledUrl).toContain('gemini-2.5-flash');
            expect(calledUrl).not.toContain('gemini-2.5-pro');
        });

        it('should failover gemini-1.5-pro to gemini-1.5-flash', async () => {
            mockFetch.mockResolvedValueOnce(okResponse());
            const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=test';
            const result = await attemptShadowRouterFailover(
                { model: 'gemini-1.5-pro', contents: [] },
                { 'x-goog-api-key': 'test' },
                geminiUrl,
            );
            expect(result).not.toBeNull();
            expect(mockFetch.mock.calls[0][0]).toContain('gemini-1.5-flash');
        });

        it('should not failover gemini flash (already cheapest)', async () => {
            const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test';
            const result = await attemptShadowRouterFailover(
                { contents: [] },
                { 'x-goog-api-key': 'test' },
                geminiUrl,
            );
            expect(result).toBeNull();
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('Edge cases', () => {
        it('should return null for unknown models', async () => {
            const result = await attemptShadowRouterFailover(
                { model: 'llama-3.1-70b', messages: [] },
                { 'authorization': 'Bearer test' },
            );
            expect(result).toBeNull();
        });

        it('should return null when body has no model and no URL', async () => {
            const result = await attemptShadowRouterFailover(
                { messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).toBeNull();
        });

        it('should return null when failover request fails', async () => {
            mockFetch.mockResolvedValueOnce(errorResponse(500));
            const result = await attemptShadowRouterFailover(
                { model: 'claude-sonnet-4-6', messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).toBeNull();
        });

        it('should return null when fetch throws', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            const result = await attemptShadowRouterFailover(
                { model: 'claude-sonnet-4-6', messages: [] },
                { 'x-api-key': 'test' },
            );
            expect(result).toBeNull();
        });
    });
});
