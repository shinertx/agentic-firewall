// Per-provider request queue with token bucket rate limiting and semaphore concurrency control.

type Provider = 'anthropic' | 'openai' | 'gemini' | 'nvidia';

export class QueueFullError extends Error {
    constructor(provider: string) {
        super(`Queue full for provider: ${provider}`);
        this.name = 'QueueFullError';
    }
}

export class QueueTimeoutError extends Error {
    constructor(provider: string) {
        super(`Queue timeout for provider: ${provider}`);
        this.name = 'QueueTimeoutError';
    }
}

interface QueueConfig {
    maxConcurrent: number;
    requestsPerMinute: number;
    maxQueueSize: number;
}

interface TokenBucket {
    tokens: number;
    lastRefill: number;
    maxTokens: number;
    refillRate: number; // tokens per ms
}

interface Semaphore {
    current: number;
    max: number;
}

interface QueuedRequest {
    resolve: (value: void) => void;
    reject: (reason: Error) => void;
    priority: 'normal' | 'high';
    enqueuedAt: number;
    timeout: NodeJS.Timeout;
}

interface ProviderQueueState {
    bucket: TokenBucket;
    semaphore: Semaphore;
    queue: QueuedRequest[];
    config: QueueConfig;
}

const DEFAULT_CONFIGS: Record<string, QueueConfig> = {
    anthropic: { maxConcurrent: 5, requestsPerMinute: 40, maxQueueSize: 20 },
    openai: { maxConcurrent: 10, requestsPerMinute: 60, maxQueueSize: 30 },
    gemini: { maxConcurrent: 10, requestsPerMinute: 60, maxQueueSize: 30 },
    nvidia: { maxConcurrent: 5, requestsPerMinute: 20, maxQueueSize: 10 },
};

const QUEUE_TIMEOUT_MS = 30_000;
const CLEANUP_INTERVAL_MS = 5_000;

const providerStates = new Map<string, ProviderQueueState>();

function getOrCreateState(provider: string): ProviderQueueState {
    let state = providerStates.get(provider);
    if (state) return state;

    const config = DEFAULT_CONFIGS[provider] ?? {
        maxConcurrent: 5,
        requestsPerMinute: 30,
        maxQueueSize: 15,
    };

    const maxTokens = config.requestsPerMinute;
    const refillRate = maxTokens / 60_000;

    state = {
        bucket: {
            tokens: maxTokens,
            lastRefill: Date.now(),
            maxTokens,
            refillRate,
        },
        semaphore: {
            current: 0,
            max: config.maxConcurrent,
        },
        queue: [],
        config,
    };

    providerStates.set(provider, state);
    return state;
}

function refillBucket(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
    bucket.lastRefill = now;
}

function drainQueue(provider: string): void {
    const state = providerStates.get(provider);
    if (!state) return;

    while (state.queue.length > 0) {
        refillBucket(state.bucket);

        if (state.bucket.tokens < 1 || state.semaphore.current >= state.semaphore.max) {
            break;
        }

        const request = state.queue.shift()!;
        clearTimeout(request.timeout);
        state.bucket.tokens -= 1;
        state.semaphore.current += 1;
        request.resolve();
    }
}

// Cleanup interval: reject stale queued requests older than QUEUE_TIMEOUT_MS.
const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [provider, state] of providerStates) {
        const stale: QueuedRequest[] = [];
        state.queue = state.queue.filter((req) => {
            if (now - req.enqueuedAt >= QUEUE_TIMEOUT_MS) {
                stale.push(req);
                return false;
            }
            return true;
        });
        for (const req of stale) {
            clearTimeout(req.timeout);
            req.reject(new QueueTimeoutError(provider));
        }
    }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref();

export function acquireSlot(
    provider: string,
    priority: 'high' | 'normal' = 'normal'
): Promise<void> {
    const state = getOrCreateState(provider);

    refillBucket(state.bucket);

    if (state.bucket.tokens >= 1 && state.semaphore.current < state.semaphore.max) {
        state.bucket.tokens -= 1;
        state.semaphore.current += 1;
        return Promise.resolve();
    }

    if (state.queue.length >= state.config.maxQueueSize) {
        return Promise.reject(new QueueFullError(provider));
    }

    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            const idx = state.queue.indexOf(entry);
            if (idx !== -1) {
                state.queue.splice(idx, 1);
            }
            reject(new QueueTimeoutError(provider));
        }, QUEUE_TIMEOUT_MS);

        const entry: QueuedRequest = {
            resolve,
            reject,
            priority,
            enqueuedAt: Date.now(),
            timeout,
        };

        if (priority === 'high') {
            // Insert before the first normal-priority item.
            const insertIdx = state.queue.findIndex((r) => r.priority === 'normal');
            if (insertIdx === -1) {
                state.queue.push(entry);
            } else {
                state.queue.splice(insertIdx, 0, entry);
            }
        } else {
            state.queue.push(entry);
        }
    });
}

export function releaseSlot(provider: string): void {
    const state = providerStates.get(provider);
    if (!state) return;

    state.semaphore.current = Math.max(0, state.semaphore.current - 1);
    drainQueue(provider);
}

export function autoTuneFromHeaders(provider: string, headers: Headers): void {
    const limitHeader = headers.get('x-ratelimit-limit-requests');
    if (!limitHeader) return;

    const reported = parseInt(limitHeader, 10);
    if (!reported || reported <= 0) return;

    const state = getOrCreateState(provider);
    const newRate = Math.floor(reported * 0.8);

    state.bucket.maxTokens = newRate;
    state.bucket.refillRate = newRate / 60_000;
}

export function getQueueStats(): Record<string, { queued: number; active: number; rateLimit: number }> {
    const stats: Record<string, { queued: number; active: number; rateLimit: number }> = {};

    for (const [provider, state] of providerStates) {
        stats[provider] = {
            queued: state.queue.length,
            active: state.semaphore.current,
            rateLimit: state.bucket.maxTokens,
        };
    }

    return stats;
}

export function resetQueue(provider?: string): void {
    if (provider) {
        const state = providerStates.get(provider);
        if (state) {
            for (const req of state.queue) {
                clearTimeout(req.timeout);
            }
            providerStates.delete(provider);
        }
    } else {
        for (const [, state] of providerStates) {
            for (const req of state.queue) {
                clearTimeout(req.timeout);
            }
        }
        providerStates.clear();
    }
}
