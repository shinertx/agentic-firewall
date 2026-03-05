import crypto from 'crypto';
import { globalStats } from './stats';
import { isRedisAvailable, getRedisClient } from './redis';
import { CB_TTL_MS, CB_WINDOW_SIZE, CB_THRESHOLD } from './config';

interface SessionEntry {
    hash: string;
    timestamp: number;
}

interface Session {
    entries: SessionEntry[];
}

const memoryStore = new Map<string, Session>();

const TTL_MS = CB_TTL_MS;
const WINDOW_SIZE = CB_WINDOW_SIZE;
const THRESHOLD = CB_THRESHOLD;

// Periodic cleanup of stale sessions to prevent unbounded memory growth
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of memoryStore) {
        session.entries = session.entries.filter(e => now - e.timestamp < TTL_MS);
        if (session.entries.length === 0) {
            memoryStore.delete(key);
        }
    }
}, 60_000).unref();

/** Get the number of active sessions (for observability/testing) */
export function getMemoryStoreSize(): number {
    return memoryStore.size;
}

// Lua script for atomic circuit breaker check-and-add in Redis
// Returns [blocked (0|1), identicalCount]
const CIRCUIT_BREAKER_LUA = `
local key = KEYS[1]
local hash = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local windowSize = tonumber(ARGV[4])
local threshold = tonumber(ARGV[5])

-- Clean expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - ttl)

-- Add current entry (hash:timestamp as member for uniqueness)
redis.call('ZADD', key, now, hash .. ':' .. now)

-- Trim to window size
local total = redis.call('ZCARD', key)
if total > windowSize then
    redis.call('ZREMRANGEBYRANK', key, 0, total - windowSize - 1)
end

-- Set key TTL so Redis auto-cleans abandoned sessions
redis.call('PEXPIRE', key, ttl)

-- Get the last threshold entries
local entries = redis.call('ZRANGE', key, -threshold, -1)
local identicalCount = 0
local allSame = true
local firstHash = nil

for _, entry in ipairs(entries) do
    local entryHash = string.match(entry, '(.+):%d+$')
    if entryHash == hash then
        identicalCount = identicalCount + 1
    end
    if firstHash == nil then
        firstHash = entryHash
    elseif entryHash ~= firstHash then
        allSame = false
    end
end

if #entries >= threshold and allSame then
    return {1, identicalCount}
end

return {0, identicalCount}
`;

async function checkCircuitBreakerRedis(sessionKey: string, hash: string): Promise<{ blocked: boolean; identicalCount: number } | null> {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const result = await redis.eval(
            CIRCUIT_BREAKER_LUA,
            1,
            `firewall:cb:${sessionKey}`,
            hash,
            Date.now().toString(),
            TTL_MS.toString(),
            WINDOW_SIZE.toString(),
            THRESHOLD.toString()
        ) as [number, number];
        return { blocked: result[0] === 1, identicalCount: result[1] };
    } catch {
        return null; // Fall back to in-memory
    }
}

/**
 * Smarter circuit breaker:
 * - Hashes the FULL payload (model + system + messages), not just the last user message
 * - Keys on API-key when available (fixes shared-IP problem), falls back to IP
 * - Entries expire after 5 minutes TTL
 * - Uses Redis with Lua for atomicity when available, falls back to in-memory
 */
export async function checkCircuitBreaker(ip: string, body: any, apiKey?: string, sessionId?: string): Promise<{ blocked: boolean; reason?: string; hash: string; identicalCount: number }> {
    if (!body || !body.messages || !Array.isArray(body.messages)) {
        return { blocked: false, hash: '', identicalCount: 0 };
    }

    // Prefer sessionId for keying, fall back to API-key hash, then IP
    const sessionKey = sessionId || (apiKey ? crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16) : ip);

    // Hash the full payload (model + system + all messages) for more accurate detection
    const payloadToHash = JSON.stringify({
        model: body.model || '',
        system: body.system || '',
        messages: body.messages
    });
    const hash = crypto.createHash('sha256').update(payloadToHash).digest('hex');
    const now = Date.now();

    // Try Redis first for atomic check (no race condition)
    if (isRedisAvailable()) {
        const redisResult = await checkCircuitBreakerRedis(sessionKey, hash);
        if (redisResult) {
            if (redisResult.blocked) {
                console.log(`[FIREWALL] Circuit Breaker triggered via Redis for session ${sessionKey}! Agent stuck in loop.`);
                globalStats.blockedLoops++;
                return { blocked: true, reason: 'Agentic Firewall: Loop detected. Terminating connection to prevent wasted tokens.', hash, identicalCount: redisResult.identicalCount };
            }
            return { blocked: false, hash, identicalCount: redisResult.identicalCount };
        }
        // Redis call failed — fall through to in-memory
    }

    // In-memory check (fallback when Redis unavailable)
    if (!memoryStore.has(sessionKey)) {
        memoryStore.set(sessionKey, { entries: [] });
    }

    const session = memoryStore.get(sessionKey)!;

    // Expire old entries
    session.entries = session.entries.filter(e => now - e.timestamp < TTL_MS);

    // Add current request
    session.entries.push({ hash, timestamp: now });

    // Keep window bounded
    if (session.entries.length > WINDOW_SIZE) {
        session.entries.shift();
    }

    // Count identical hashes in current window for response caching
    const identicalCount = session.entries.filter(e => e.hash === hash).length;

    // Loop detection: if the last THRESHOLD requests are identical
    if (session.entries.length >= THRESHOLD) {
        const lastN = session.entries.slice(-THRESHOLD);
        const allSame = lastN.every(e => e.hash === lastN[0].hash);
        if (allSame) {
            console.log(`[FIREWALL] Circuit Breaker triggered for session ${sessionKey}! Agent stuck in loop.`);

            // Increment blocked loops counter
            globalStats.blockedLoops++;

            return { blocked: true, reason: 'Agentic Firewall: Loop detected. Terminating connection to prevent wasted tokens.', hash, identicalCount };
        }
    }

    return { blocked: false, hash, identicalCount };
}
