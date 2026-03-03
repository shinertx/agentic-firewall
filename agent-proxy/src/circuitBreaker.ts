import crypto from 'crypto';
import { globalStats } from './stats';

interface SessionEntry {
    hash: string;
    timestamp: number;
}

interface Session {
    entries: SessionEntry[];
}

const memoryStore = new Map<string, Session>();

// Entries older than 5 minutes are expired (prevents false positives across sessions)
const TTL_MS = 5 * 60 * 1000;
// Sliding window size
const WINDOW_SIZE = 5;
// Number of identical requests before triggering
const THRESHOLD = 4;

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

/**
 * Smarter circuit breaker:
 * - Hashes the FULL payload (model + system + messages), not just the last user message
 * - Keys on API-key when available (fixes shared-IP problem), falls back to IP
 * - Entries expire after 5 minutes TTL
 */
export function checkCircuitBreaker(ip: string, body: any, apiKey?: string, sessionId?: string): { blocked: boolean; reason?: string; hash: string; identicalCount: number } {
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
            console.log(`[FIREWALL] 🚨 Circuit Breaker triggered for session ${sessionKey}! Agent stuck in loop.`);

            // Increment blocked loops counter
            globalStats.blockedLoops++;

            return { blocked: true, reason: 'Agentic Firewall: Loop detected. Terminating connection to prevent wasted tokens.', hash, identicalCount };
        }
    }

    return { blocked: false, hash, identicalCount };
}
