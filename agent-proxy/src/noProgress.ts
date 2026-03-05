/**
 * No-Progress Detection — fingerprints tool failures and detects spinning.
 *
 * Detects when an agent is stuck: same tool error 3+ times,
 * or high token usage with no new unique content.
 */

import crypto from 'crypto';
import { NP_FAILURE_STATE_TTL_MS, NP_MAX_FAILURE_ENTRIES, NP_WARN_AT, NP_BLOCK_AT } from './config';

interface ToolFailureState {
    lastErrorHash: string;
    consecutiveCount: number;
    totalFailures: number;
    lastSeenAt: number;
}

const failureStates = new Map<string, ToolFailureState>();

const FAILURE_STATE_TTL_MS = NP_FAILURE_STATE_TTL_MS;
const MAX_FAILURE_ENTRIES = NP_MAX_FAILURE_ENTRIES;

setInterval(() => {
    const now = Date.now();
    for (const [key, state] of failureStates) {
        if (now - state.lastSeenAt > FAILURE_STATE_TTL_MS) {
            failureStates.delete(key);
        }
    }
    // Hard cap: if still too many, evict oldest
    if (failureStates.size > MAX_FAILURE_ENTRIES) {
        const entries = [...failureStates.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
        const toRemove = entries.slice(0, entries.length - MAX_FAILURE_ENTRIES);
        for (const [key] of toRemove) {
            failureStates.delete(key);
        }
    }
}, 60_000).unref();

/**
 * Hash the content of tool-related messages to fingerprint errors.
 */
function hashContent(content: string): string {
    return crypto.createHash('sha256').update(content.slice(0, 500)).digest('hex').slice(0, 16);
}

/**
 * Check if a request body shows signs of no-progress.
 * Looks for tool_result errors that repeat, or identical assistant messages.
 *
 * Returns: { noProgress: boolean, reason?: string, consecutiveErrors?: number }
 */
export function checkNoProgress(identifier: string, body: any): {
    noProgress: boolean;
    reason?: string;
    consecutiveErrors?: number;
    warning?: string;
} {
    if (!body?.messages || !Array.isArray(body.messages)) {
        return { noProgress: false };
    }

    // Look at the last few messages for tool errors
    const recentMessages = body.messages.slice(-5);

    // Find tool_result errors
    for (const msg of recentMessages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block.type === 'tool_result' && block.is_error) {
                    const errorHash = hashContent(block.content || '');
                    let state = failureStates.get(identifier);

                    if (!state) {
                        state = { lastErrorHash: '', consecutiveCount: 0, totalFailures: 0, lastSeenAt: Date.now() };
                        failureStates.set(identifier, state);
                    }

                    state.totalFailures++;
                    state.lastSeenAt = Date.now();

                    if (errorHash === state.lastErrorHash) {
                        state.consecutiveCount++;
                    } else {
                        state.consecutiveCount = 1;
                        state.lastErrorHash = errorHash;
                    }

                    // Warn at NP_WARN_AT, block at NP_BLOCK_AT
                    if (state.consecutiveCount >= NP_BLOCK_AT) {
                        return {
                            noProgress: true,
                            reason: `Agent stuck: same tool error repeated ${state.consecutiveCount} times. Stopping to prevent waste.`,
                            consecutiveErrors: state.consecutiveCount,
                        };
                    }

                    if (state.consecutiveCount >= NP_WARN_AT) {
                        return {
                            noProgress: false,
                            warning: `Warning: same tool error repeated ${state.consecutiveCount} times. Agent may be stuck.`,
                            consecutiveErrors: state.consecutiveCount,
                        };
                    }
                }
            }
        }
    }

    // Check for spinning: same assistant message content repeated
    const assistantMessages = body.messages
        .filter((m: any) => m.role === 'assistant')
        .slice(-3);

    if (assistantMessages.length >= 3) {
        const hashes = assistantMessages.map((m: any) =>
            hashContent(JSON.stringify(m.content || ''))
        );
        if (hashes[0] === hashes[1] && hashes[1] === hashes[2]) {
            return {
                noProgress: true,
                reason: 'Agent spinning: last 3 assistant messages are identical.',
                consecutiveErrors: 3,
            };
        }
    }

    return { noProgress: false };
}

/**
 * Reset failure state for a user (e.g., when they send a new conversation).
 */
export function resetNoProgress(identifier: string) {
    failureStates.delete(identifier);
}

/**
 * Get total no-progress events for stats.
 */
export function getNoProgressStats(): { totalFailures: number, activeIdentifiers: number } {
    let totalFailures = 0;
    for (const state of failureStates.values()) {
        totalFailures += state.totalFailures;
    }
    return { totalFailures, activeIdentifiers: failureStates.size };
}
