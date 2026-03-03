import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCachedResponse, setCachedResponse, getCacheStats, clearCache } from '../src/responseCache';

const testHeaders = { 'content-type': 'text/event-stream' };
const testBody = Buffer.from('test response data');

beforeEach(() => {
    clearCache();
    vi.useRealTimers();
});

describe('Response Cache', () => {

    it('should return null for unknown hash', () => {
        const result = getCachedResponse('nonexistent-hash-abc123');
        expect(result).toBeNull();
    });

    it('should round-trip setCachedResponse + getCachedResponse', () => {
        const success = setCachedResponse('hash-1', 200, testHeaders, testBody, 'text/event-stream');
        expect(success).toBe(true);

        const cached = getCachedResponse('hash-1');
        expect(cached).not.toBeNull();
        expect(cached!.statusCode).toBe(200);
        expect(cached!.headers).toEqual(testHeaders);
        expect(cached!.body.toString()).toBe('test response data');
        expect(cached!.contentType).toBe('text/event-stream');
        expect(cached!.hitCount).toBe(1);
    });

    it('should reject non-200 status codes', () => {
        const result404 = setCachedResponse('hash-err-404', 404, testHeaders, testBody, 'text/plain');
        expect(result404).toBe(false);

        const result500 = setCachedResponse('hash-err-500', 500, testHeaders, testBody, 'text/plain');
        expect(result500).toBe(false);

        const result429 = setCachedResponse('hash-err-429', 429, testHeaders, testBody, 'text/plain');
        expect(result429).toBe(false);

        // Verify nothing was cached
        expect(getCacheStats().entries).toBe(0);
    });

    it('should reject oversized entries (>10MB)', () => {
        const oversizedBody = Buffer.alloc(11 * 1024 * 1024); // 11MB
        const result = setCachedResponse('hash-big', 200, testHeaders, oversizedBody, 'application/octet-stream');
        expect(result).toBe(false);
        expect(getCacheStats().entries).toBe(0);
    });

    it('should expire entries after TTL (5 minutes)', () => {
        vi.useFakeTimers();

        setCachedResponse('hash-ttl', 200, testHeaders, testBody, 'text/event-stream');
        expect(getCachedResponse('hash-ttl')).not.toBeNull();

        // Advance 6 minutes (past the 5-minute TTL)
        vi.advanceTimersByTime(6 * 60 * 1000);

        const expired = getCachedResponse('hash-ttl');
        expect(expired).toBeNull();

        vi.useRealTimers();
    });

    it('should evict LRU entries when total cache size exceeds 100MB', () => {
        // Each entry ~1MB, fill to 100 entries = ~100MB, then add one more
        const oneMB = Buffer.alloc(1024 * 1024);

        for (let i = 0; i < 100; i++) {
            setCachedResponse(`hash-lru-${i}`, 200, testHeaders, oneMB, 'application/octet-stream');
        }

        // Adding one more should evict the oldest
        setCachedResponse('hash-lru-new', 200, testHeaders, oneMB, 'application/octet-stream');

        // The first entry should have been evicted
        const oldest = getCachedResponse('hash-lru-0');
        expect(oldest).toBeNull();

        // The newest should still be present
        const newest = getCachedResponse('hash-lru-new');
        expect(newest).not.toBeNull();
    });

    it('should evict oldest entries when max entries (500) is exceeded', () => {
        const smallBody = Buffer.from('x');

        for (let i = 0; i < 501; i++) {
            setCachedResponse(`hash-max-${i}`, 200, testHeaders, smallBody, 'text/plain');
        }

        // The first entry (index 0) should have been evicted
        const evicted = getCachedResponse('hash-max-0');
        expect(evicted).toBeNull();

        // A later entry should still be present
        const present = getCachedResponse('hash-max-500');
        expect(present).not.toBeNull();

        expect(getCacheStats().entries).toBeLessThanOrEqual(500);
    });

    it('should return correct counts from getCacheStats', () => {
        // Start fresh — zero entries
        const initialStats = getCacheStats();
        expect(initialStats.entries).toBe(0);
        expect(initialStats.totalSize).toBe(0);
        expect(initialStats.totalHits).toBe(0);
        expect(initialStats.totalMisses).toBe(0);

        // Add two entries
        setCachedResponse('hash-s1', 200, testHeaders, testBody, 'text/plain');
        setCachedResponse('hash-s2', 200, testHeaders, Buffer.from('abcdef'), 'text/plain');

        // One miss
        getCachedResponse('nonexistent');

        // Two hits
        getCachedResponse('hash-s1');
        getCachedResponse('hash-s2');

        const stats = getCacheStats();
        expect(stats.entries).toBe(2);
        expect(stats.totalSize).toBe(testBody.byteLength + 6);
        expect(stats.totalHits).toBe(2);
        expect(stats.totalMisses).toBe(1);
    });

    it('should empty everything and reset counters on clearCache', () => {
        setCachedResponse('hash-c1', 200, testHeaders, testBody, 'text/plain');
        setCachedResponse('hash-c2', 200, testHeaders, testBody, 'text/plain');
        getCachedResponse('hash-c1'); // hit
        getCachedResponse('missing');  // miss

        clearCache();

        const stats = getCacheStats();
        expect(stats.entries).toBe(0);
        expect(stats.totalSize).toBe(0);
        expect(stats.totalHits).toBe(0);
        expect(stats.totalMisses).toBe(0);

        // Previously cached items should be gone
        expect(getCachedResponse('hash-c1')).toBeNull();
    });
});
