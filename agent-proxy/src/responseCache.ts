interface CachedResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: Buffer;
    contentType: string;
    cachedAt: number;
    size: number;
    hitCount: number;
}

const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024;  // 100MB total
const MAX_ENTRY_SIZE_BYTES = 10 * 1024 * 1024;    // 10MB per entry
const CACHE_TTL_MS = 5 * 60 * 1000;               // 5 minutes
const MAX_ENTRIES = 500;

const cache = new Map<string, CachedResponse>();
let currentSizeBytes = 0;
let totalHits = 0;
let totalMisses = 0;

export function getCachedResponse(hash: string): CachedResponse | null {
    const entry = cache.get(hash);

    if (!entry) {
        totalMisses++;
        return null;
    }

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        cache.delete(hash);
        currentSizeBytes -= entry.size;
        totalMisses++;
        return null;
    }

    entry.hitCount++;
    totalHits++;

    // LRU refresh: delete and re-set to move to end of Map
    cache.delete(hash);
    cache.set(hash, entry);

    return entry;
}

export function setCachedResponse(
    hash: string,
    statusCode: number,
    headers: Record<string, string>,
    body: Buffer,
    contentType: string
): boolean {
    if (statusCode !== 200) {
        return false;
    }

    const size = body.byteLength;

    if (size > MAX_ENTRY_SIZE_BYTES) {
        return false;
    }

    // If already cached, remove old entry first
    const existing = cache.get(hash);
    if (existing) {
        cache.delete(hash);
        currentSizeBytes -= existing.size;
    }

    // Evict oldest entries until we have room
    while (currentSizeBytes + size > MAX_CACHE_SIZE_BYTES || cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        const oldestEntry = cache.get(oldest.value)!;
        cache.delete(oldest.value);
        currentSizeBytes -= oldestEntry.size;
    }

    const entry: CachedResponse = {
        statusCode,
        headers,
        body,
        contentType,
        cachedAt: Date.now(),
        size,
        hitCount: 0,
    };

    cache.set(hash, entry);
    currentSizeBytes += size;

    return true;
}

export function getCacheStats(): {
    entries: number;
    totalSize: number;
    totalHits: number;
    totalMisses: number;
} {
    return {
        entries: cache.size,
        totalSize: currentSizeBytes,
        totalHits,
        totalMisses,
    };
}

export function clearCache(): void {
    cache.clear();
    currentSizeBytes = 0;
    totalHits = 0;
    totalMisses = 0;
}

// Periodic cleanup of expired entries
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [hash, entry] of cache) {
        if (now - entry.cachedAt > CACHE_TTL_MS) {
            cache.delete(hash);
            currentSizeBytes -= entry.size;
        }
    }
}, 60_000);

cleanupInterval.unref();
