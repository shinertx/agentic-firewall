import crypto from 'crypto';
import os from 'os';

/**
 * Telemetry Reporter — opt-in anonymized stats reporting.
 *
 * When TELEMETRY_ENABLED=true, sends aggregated usage stats
 * to a configurable remote endpoint. Used for centralized
 * dashboards and product improvement.
 *
 * NEVER sends: API keys, prompts, responses, usernames, hostnames.
 * ONLY sends: request counts, model names, dollars saved, blocked loops.
 */

const TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT || 'https://api.jockeyvc.com/v1/telemetry';
const TELEMETRY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Stable anonymous ID — same machine always gets same ID
function getAnonymousId(): string {
    const raw = `${os.hostname()}-${os.userInfo().username}-telemetry`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

interface TelemetryPayload {
    anonymousId: string;
    timestamp: string;
    version: string;
    stats: {
        totalRequests: number;
        savedMoney: number;
        savedTokens: number;
        blockedLoops: number;
        providers: string[];
        uptime: number;
    };
}

let telemetryTimer: ReturnType<typeof setInterval> | null = null;
const startTime = Date.now();

/**
 * Send telemetry payload. Fails silently — never blocks proxy operation.
 */
async function sendTelemetry(stats: any, providers: string[]): Promise<void> {
    try {
        const payload: TelemetryPayload = {
            anonymousId: getAnonymousId(),
            timestamp: new Date().toISOString(),
            version: '0.6.0',
            stats: {
                totalRequests: stats.totalRequests || 0,
                savedMoney: stats.savedMoney || 0,
                savedTokens: stats.savedTokens || 0,
                blockedLoops: stats.blockedLoops || 0,
                providers,
                uptime: Date.now() - startTime,
            },
        };

        await fetch(TELEMETRY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        // Silent failure — telemetry should never affect proxy operation
    }
}

/**
 * Start periodic telemetry reporting.
 * Only activates if TELEMETRY_ENABLED=true in environment.
 */
export function startTelemetry(getStats: () => any, getProviders: () => string[]): void {
    if (process.env.TELEMETRY_ENABLED !== 'true') {
        return;
    }

    console.log('[TELEMETRY] Opt-in telemetry enabled. Sending anonymous stats every 24h.');

    telemetryTimer = setInterval(() => {
        sendTelemetry(getStats(), getProviders());
    }, TELEMETRY_INTERVAL_MS);

    // Don't prevent process exit
    if (telemetryTimer.unref) {
        telemetryTimer.unref();
    }
}

/**
 * Send final telemetry on shutdown.
 */
export function flushTelemetry(stats: any, providers: string[]): void {
    if (process.env.TELEMETRY_ENABLED !== 'true') return;
    // Fire and forget — don't block shutdown
    sendTelemetry(stats, providers).catch(() => {});
}

/**
 * Stop telemetry reporting.
 */
export function stopTelemetry(): void {
    if (telemetryTimer) {
        clearInterval(telemetryTimer);
        telemetryTimer = null;
    }
}
