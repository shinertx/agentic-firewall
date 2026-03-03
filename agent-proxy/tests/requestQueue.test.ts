import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/stats', () => ({ globalStats: {} }));

import {
    acquireSlot,
    releaseSlot,
    autoTuneFromHeaders,
    getQueueStats,
    resetQueue,
    QueueFullError,
    QueueTimeoutError,
} from '../src/requestQueue';

describe('Request Queue', () => {
    beforeEach(() => {
        resetQueue();
    });

    it('should acquire a slot immediately under default limits', async () => {
        await expect(acquireSlot('anthropic')).resolves.toBeUndefined();
        const stats = getQueueStats();
        expect(stats['anthropic'].active).toBe(1);
    });

    it('should block at maxConcurrent (anthropic default = 5)', async () => {
        // Acquire 5 slots — all should resolve immediately
        for (let i = 0; i < 5; i++) {
            await acquireSlot('anthropic');
        }

        // 6th should queue (not resolve immediately)
        const sixth = acquireSlot('anthropic');
        // Give a tick to ensure it didn't resolve synchronously
        await new Promise((r) => setTimeout(r, 10));

        const stats = getQueueStats();
        expect(stats['anthropic'].active).toBe(5);
        expect(stats['anthropic'].queued).toBe(1);

        // Release one slot to unblock the 6th
        releaseSlot('anthropic');
        await sixth;

        const statsAfter = getQueueStats();
        expect(statsAfter['anthropic'].active).toBe(5);
        expect(statsAfter['anthropic'].queued).toBe(0);
    });

    it('should reject with QueueFullError when queue reaches maxQueueSize', async () => {
        // Anthropic defaults: maxConcurrent=5, maxQueueSize=20
        // Fill concurrency first
        for (let i = 0; i < 5; i++) {
            await acquireSlot('anthropic');
        }

        // Fill queue to capacity (20 entries)
        const queued: Promise<void>[] = [];
        for (let i = 0; i < 20; i++) {
            queued.push(acquireSlot('anthropic'));
        }

        const stats = getQueueStats();
        expect(stats['anthropic'].queued).toBe(20);

        // 21st queued request should throw QueueFullError
        await expect(acquireSlot('anthropic')).rejects.toThrow(QueueFullError);

        // Clean up: release all slots to resolve queued promises
        for (let i = 0; i < 25; i++) {
            releaseSlot('anthropic');
        }
        await Promise.allSettled(queued);
    });

    it('should give high-priority requests precedence over normal ones', async () => {
        // Fill all 5 concurrent slots
        for (let i = 0; i < 5; i++) {
            await acquireSlot('anthropic');
        }

        const resolved: string[] = [];

        // Queue a normal-priority request
        const normalPromise = acquireSlot('anthropic', 'normal').then(() => {
            resolved.push('normal');
        });

        // Queue a high-priority request
        const highPromise = acquireSlot('anthropic', 'high').then(() => {
            resolved.push('high');
        });

        // Release one slot — high-priority should resolve first
        releaseSlot('anthropic');
        await new Promise((r) => setTimeout(r, 10));

        expect(resolved[0]).toBe('high');

        // Release another to resolve normal
        releaseSlot('anthropic');
        await new Promise((r) => setTimeout(r, 10));

        expect(resolved).toEqual(['high', 'normal']);
    });

    it('should not throw when releasing without a prior acquire', () => {
        expect(() => releaseSlot('anthropic')).not.toThrow();

        // Semaphore should stay at 0 (not go negative)
        const stats = getQueueStats();
        // Provider may not be in stats if never acquired — that's fine
        if (stats['anthropic']) {
            expect(stats['anthropic'].active).toBe(0);
        }
    });

    it('should auto-tune rate limit from x-ratelimit-limit-requests header', () => {
        // Initialize the provider state first
        acquireSlot('openai');
        releaseSlot('openai');

        const headers = new Headers();
        headers.set('x-ratelimit-limit-requests', '100');

        autoTuneFromHeaders('openai', headers);

        const stats = getQueueStats();
        // 100 * 0.8 = 80
        expect(stats['openai'].rateLimit).toBe(80);
    });

    it('should maintain independent queues per provider', async () => {
        // Fill anthropic to its max concurrent (5)
        for (let i = 0; i < 5; i++) {
            await acquireSlot('anthropic');
        }

        // OpenAI should still be available (maxConcurrent=10)
        await expect(acquireSlot('openai')).resolves.toBeUndefined();

        const stats = getQueueStats();
        expect(stats['anthropic'].active).toBe(5);
        expect(stats['openai'].active).toBe(1);
    });

    it('should clear state with resetQueue()', async () => {
        await acquireSlot('anthropic');
        await acquireSlot('openai');

        resetQueue();

        const stats = getQueueStats();
        expect(Object.keys(stats)).toHaveLength(0);
    });

    it('should clear only the specified provider with resetQueue(provider)', async () => {
        await acquireSlot('anthropic');
        await acquireSlot('openai');

        resetQueue('anthropic');

        const stats = getQueueStats();
        expect(stats['anthropic']).toBeUndefined();
        expect(stats['openai']).toBeDefined();
        expect(stats['openai'].active).toBe(1);
    });

    it('should return correct structure from getQueueStats', async () => {
        await acquireSlot('anthropic');

        const stats = getQueueStats();
        expect(stats['anthropic']).toEqual(
            expect.objectContaining({
                queued: expect.any(Number),
                active: expect.any(Number),
                rateLimit: expect.any(Number),
            }),
        );
        expect(stats['anthropic'].active).toBe(1);
        expect(stats['anthropic'].queued).toBe(0);
        expect(stats['anthropic'].rateLimit).toBe(40); // default anthropic requestsPerMinute
    });
});
