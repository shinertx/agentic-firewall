import Redis from 'ioredis';

let client: Redis | null = null;
let connected = false;

const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
    client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
            const delay = Math.min(times * 500, 5000);
            return delay;
        },
        lazyConnect: false,
    });

    client.on('connect', () => {
        connected = true;
        console.log('[REDIS] Connected');
    });

    client.on('error', (err) => {
        console.error('[REDIS] Error:', err.message);
    });

    client.on('close', () => {
        connected = false;
        console.log('[REDIS] Disconnected');
    });
}

export function isRedisAvailable(): boolean {
    return connected && client !== null;
}

export function getRedisClient(): Redis | null {
    return connected ? client : null;
}

export async function getJSON<T>(key: string): Promise<T | null> {
    if (!connected || !client) return null;
    try {
        const raw = await client.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export async function setJSON(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!connected || !client) return;
    try {
        const json = JSON.stringify(value);
        if (ttlSeconds) {
            await client.set(key, json, 'EX', ttlSeconds);
        } else {
            await client.set(key, json);
        }
    } catch (err) {
        console.error('[REDIS] setJSON error:', (err as Error).message);
    }
}

export async function incrByFloat(key: string, field: string, value: number): Promise<number> {
    if (!connected || !client) return 0;
    try {
        const result = await client.hincrbyfloat(key, field, value);
        return parseFloat(result);
    } catch {
        return 0;
    }
}

export async function evalLua(script: string, keys: string[], args: (string | number)[]): Promise<any> {
    if (!connected || !client) return null;
    try {
        return await client.eval(script, keys.length, ...keys, ...args);
    } catch (err) {
        console.error('[REDIS] Lua eval error:', (err as Error).message);
        return null;
    }
}

export async function disconnectRedis(): Promise<void> {
    if (client) {
        try {
            await client.quit();
        } catch {
            client.disconnect();
        }
        connected = false;
    }
}
