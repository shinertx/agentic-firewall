import crypto from 'crypto';

interface Session {
    lastRequests: string[];
}

const memoryStore: Record<string, Session> = {};

export function checkCircuitBreaker(ip: string, body: any): { blocked: boolean; reason?: string } {
    if (!body || !body.messages || !Array.isArray(body.messages)) {
        return { blocked: false };
    }

    // A simple heuristic: if the last user message text is EXACTLY the same as previous ones.
    const lastUserMsg = [...body.messages].reverse().find((m: any) => m.role === 'user');
    if (!lastUserMsg) return { blocked: false };

    const content = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (!memoryStore[ip]) {
        memoryStore[ip] = { lastRequests: [] };
    }

    memoryStore[ip].lastRequests.push(hash);

    // Keep only last 5
    if (memoryStore[ip].lastRequests.length > 5) {
        memoryStore[ip].lastRequests.shift();
    }

    // Loop detection: if the last 3 requests are identical
    const history = memoryStore[ip].lastRequests;
    if (history.length >= 3) {
        const last3 = history.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            console.log(`[FIREWALL] 🚨 Circuit Breaker triggered for IP ${ip}! Agent stuck in loop.`);
            return { blocked: true, reason: 'Agentic Firewall: Loop detected. Terminating connection to prevent wasted tokens.' };
        }
    }

    return { blocked: false };
}
