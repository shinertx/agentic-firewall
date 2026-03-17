/**
 * Smart No-Progress Detection — semantic analysis of agent behavior.
 *
 * Instead of a simple error counter, tracks multiple progress signals
 * to distinguish genuinely stuck agents from agents working through problems.
 *
 * Progress signals (any one resets the patience counter):
 *   1. Success:          any non-error tool result
 *   2. Tool diversity:   calling a tool not seen in the recent window
 *   3. Argument variation: same tool with different arguments
 *   4. Error evolution:  error message changes (agent hit a new problem)
 *   5. Output diversity: assistant producing new/unique content
 *
 * Only blocks when ALL signals indicate zero progress for NP_BLOCK_AT turns.
 * Warns when zero progress for NP_WARN_AT turns.
 *
 * Supports both Anthropic format (tool_use/tool_result content blocks)
 * and OpenAI format (tool_calls on assistant, role=tool for results).
 */

import crypto from 'crypto';
import { NP_FAILURE_STATE_TTL_MS, NP_MAX_FAILURE_ENTRIES, NP_WARN_AT, NP_BLOCK_AT } from './config';

// ─── Types ───────────────────────────────────────────────

interface ToolCallRecord {
    name: string;
    argHash: string;
}

interface TurnInfo {
    toolCalls: ToolCallRecord[];
    results: { isError: boolean; contentHash: string }[];
    assistantContentHash: string;
}

export type ProgressSignalType = 'success' | 'new_tool' | 'new_args' | 'error_evolved' | 'new_output';

interface ProgressSignal {
    type: ProgressSignalType;
    detail: string;
}

interface ProgressState {
    // Sliding window of recent tool calls (bounded to PROGRESS_WINDOW)
    recentToolCalls: ToolCallRecord[];
    // Sliding window of recent assistant content hashes
    recentAssistantHashes: string[];

    // Error tracking
    lastErrorHash: string;
    consecutiveIdenticalErrors: number;

    // Progress patience — how many turns with zero progress signals
    turnsSinceProgress: number;
    lastProgressSignals: ProgressSignal[];

    // Stats
    totalFailures: number;
    totalTurns: number;
    lastSeenAt: number;
}

// How many recent tool calls / assistant hashes to track
const PROGRESS_WINDOW = 10;
const ASSISTANT_HASH_WINDOW = 5;

const progressStates = new Map<string, ProgressState>();

// ─── Cleanup ─────────────────────────────────────────────

setInterval(() => {
    const now = Date.now();
    for (const [key, state] of progressStates) {
        if (now - state.lastSeenAt > NP_FAILURE_STATE_TTL_MS) {
            progressStates.delete(key);
        }
    }
    if (progressStates.size > NP_MAX_FAILURE_ENTRIES) {
        const entries = [...progressStates.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
        const toRemove = entries.slice(0, entries.length - NP_MAX_FAILURE_ENTRIES);
        for (const [key] of toRemove) {
            progressStates.delete(key);
        }
    }
}, 60_000).unref();

// ─── Helpers ─────────────────────────────────────────────

function hashContent(content: string): string {
    return crypto.createHash('sha256').update(content.slice(0, 500)).digest('hex').slice(0, 16);
}

function getOrCreateState(identifier: string): ProgressState {
    if (!progressStates.has(identifier)) {
        progressStates.set(identifier, {
            recentToolCalls: [],
            recentAssistantHashes: [],
            lastErrorHash: '',
            consecutiveIdenticalErrors: 0,
            turnsSinceProgress: 0,
            lastProgressSignals: [],
            totalFailures: 0,
            totalTurns: 0,
            lastSeenAt: Date.now(),
        });
    }
    return progressStates.get(identifier)!;
}

// ─── Turn Extraction ─────────────────────────────────────

/**
 * Extract the current turn's tool calls and results from the message history.
 * Handles both Anthropic and OpenAI message formats.
 */
function extractCurrentTurn(messages: any[]): TurnInfo | null {
    let lastUser: any = null;
    let lastAssistant: any = null;

    // Walk backwards to find the last assistant and last user messages
    for (let i = messages.length - 1; i >= 0; i--) {
        if (!lastUser && messages[i].role === 'user') lastUser = messages[i];
        if (!lastAssistant && messages[i].role === 'assistant') lastAssistant = messages[i];
        if (lastUser && lastAssistant) break;
    }

    if (!lastAssistant && !lastUser) return null;

    // ─ Tool calls from assistant ─

    const toolCalls: ToolCallRecord[] = [];

    // Anthropic: tool_use blocks in content array
    if (lastAssistant && Array.isArray(lastAssistant.content)) {
        for (const block of lastAssistant.content) {
            if (block.type === 'tool_use') {
                toolCalls.push({
                    name: block.name || 'unknown',
                    argHash: hashContent(JSON.stringify(block.input || {})),
                });
            }
        }
    }

    // OpenAI: tool_calls array on assistant message
    if (lastAssistant?.tool_calls && Array.isArray(lastAssistant.tool_calls)) {
        for (const tc of lastAssistant.tool_calls) {
            toolCalls.push({
                name: tc.function?.name || 'unknown',
                argHash: hashContent(tc.function?.arguments || '{}'),
            });
        }
    }

    // ─ Tool results from user ─

    const results: { isError: boolean; contentHash: string }[] = [];

    // Anthropic: tool_result blocks in content array
    if (lastUser && Array.isArray(lastUser.content)) {
        for (const block of lastUser.content) {
            if (block.type === 'tool_result') {
                const content = typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content || '');
                results.push({
                    isError: !!block.is_error,
                    contentHash: hashContent(content),
                });
            }
        }
    }

    // OpenAI: role=tool messages at the end of the conversation
    // These appear as separate messages right before the current request
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'tool') {
            results.push({
                isError: false, // OpenAI tool messages don't have is_error; errors come as content
                contentHash: hashContent(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')),
            });
        } else if (m.role === 'assistant' || m.role === 'user') {
            break; // Stop when we hit a non-tool message
        }
    }

    // ─ Assistant content hash ─

    let assistantContentHash = '';
    if (lastAssistant) {
        assistantContentHash = hashContent(JSON.stringify(lastAssistant.content || ''));
    }

    return { toolCalls, results, assistantContentHash };
}

// ─── Progress Detection ──────────────────────────────────

/**
 * Analyze a turn against the session's history to detect progress signals.
 */
function detectProgress(state: ProgressState, turn: TurnInfo): ProgressSignal[] {
    const signals: ProgressSignal[] = [];

    // Signal 1: Success — any non-error tool result is a strong progress signal
    const hasSuccess = turn.results.some(r => !r.isError);
    if (hasSuccess && turn.results.length > 0) {
        signals.push({ type: 'success', detail: 'Tool call succeeded' });
    }

    // Signal 2: Tool diversity — a tool name not seen in the recent window
    const recentToolNames = new Set(state.recentToolCalls.map(tc => tc.name));
    for (const tc of turn.toolCalls) {
        if (tc.name && !recentToolNames.has(tc.name)) {
            signals.push({ type: 'new_tool', detail: `New tool: ${tc.name}` });
            break;
        }
    }

    // Signal 3: Argument variation — same tool, different args
    const recentArgKeys = new Set(state.recentToolCalls.map(tc => `${tc.name}:${tc.argHash}`));
    for (const tc of turn.toolCalls) {
        if (!recentArgKeys.has(`${tc.name}:${tc.argHash}`)) {
            signals.push({ type: 'new_args', detail: `New args for ${tc.name}` });
            break;
        }
    }

    // Signal 4: Error evolution — error hash differs from the last error
    const currentErrors = turn.results.filter(r => r.isError);
    if (currentErrors.length > 0 && state.lastErrorHash) {
        const newErrorHash = currentErrors[0].contentHash;
        if (newErrorHash !== state.lastErrorHash) {
            signals.push({ type: 'error_evolved', detail: 'Error changed — agent hit a different problem' });
        }
    }

    // Signal 5: Output diversity — assistant producing content not seen recently
    if (turn.assistantContentHash && !state.recentAssistantHashes.includes(turn.assistantContentHash)) {
        signals.push({ type: 'new_output', detail: 'New assistant content' });
    }

    return signals;
}

// ─── Public API ──────────────────────────────────────────

/**
 * Check if a request body shows signs of no-progress.
 *
 * Analyzes the latest turn's tool calls, results, and assistant output
 * against a sliding window of recent activity. Blocks only when ALL
 * progress signals are absent for NP_BLOCK_AT consecutive turns.
 */
export function checkNoProgress(identifier: string, body: any): {
    noProgress: boolean;
    reason?: string;
    consecutiveErrors?: number;
    warning?: string;
    progressSignals?: ProgressSignal[];
} {
    if (!body?.messages || !Array.isArray(body.messages)) {
        return { noProgress: false };
    }

    const state = getOrCreateState(identifier);
    state.lastSeenAt = Date.now();
    state.totalTurns++;

    // Check for spinning FIRST — this is a conversation-level check that
    // applies regardless of whether the current turn has tool activity.
    // Skip firewall synthetic messages — they would cause cascading blocks
    // because the proxy returns identical "loop detected" text each time.
    const assistantMessages = body.messages
        .filter((m: any) => {
            if (m.role !== 'assistant') return false;
            const text = typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? m.content.map((b: any) => b.text || '').join('')
                : '';
            if (text.includes('Agentic Firewall')) return false;
            return true;
        })
        .slice(-3);

    if (assistantMessages.length >= 3) {
        const hashes = assistantMessages.map((m: any) =>
            hashContent(JSON.stringify(m.content || ''))
        );
        if (hashes[0] === hashes[1] && hashes[1] === hashes[2]) {
            // Reset state so the agent can recover after we block this request
            state.turnsSinceProgress = 0;
            state.consecutiveIdenticalErrors = 0;
            state.lastErrorHash = '';
            return {
                noProgress: true,
                reason: 'Agent spinning: last 3 assistant messages are identical.',
                consecutiveErrors: 3,
                progressSignals: [],
            };
        }
    }

    // Extract the current turn's fingerprint
    const turn = extractCurrentTurn(body.messages);

    if (!turn || (turn.toolCalls.length === 0 && turn.results.length === 0)) {
        // No tool activity in this turn — not relevant for tool-based progress detection.
        // Reset patience since the agent may be doing text-only work.
        state.turnsSinceProgress = 0;
        return { noProgress: false };
    }

    // Detect progress signals
    const signals = detectProgress(state, turn);

    // Update error tracking
    const currentErrors = turn.results.filter(r => r.isError);
    if (currentErrors.length > 0) {
        const errorHash = currentErrors[0].contentHash;
        state.totalFailures++;

        if (errorHash === state.lastErrorHash) {
            state.consecutiveIdenticalErrors++;
        } else {
            state.consecutiveIdenticalErrors = 1;
            state.lastErrorHash = errorHash;
        }
    } else if (turn.results.some(r => !r.isError)) {
        // Success resets error tracking
        state.consecutiveIdenticalErrors = 0;
        state.lastErrorHash = '';
    }

    // Update sliding windows
    state.recentToolCalls.push(...turn.toolCalls);
    if (state.recentToolCalls.length > PROGRESS_WINDOW) {
        state.recentToolCalls = state.recentToolCalls.slice(-PROGRESS_WINDOW);
    }

    if (turn.assistantContentHash) {
        state.recentAssistantHashes.push(turn.assistantContentHash);
        if (state.recentAssistantHashes.length > ASSISTANT_HASH_WINDOW) {
            state.recentAssistantHashes = state.recentAssistantHashes.slice(-ASSISTANT_HASH_WINDOW);
        }
    }

    // Update progress patience
    if (signals.length > 0) {
        state.turnsSinceProgress = 0;
        state.lastProgressSignals = signals;
    } else {
        state.turnsSinceProgress++;
    }

    // ─ Decision ─

    if (state.turnsSinceProgress >= NP_BLOCK_AT) {
        const result = {
            noProgress: true,
            reason: `Agent stuck: ${state.turnsSinceProgress} turns with zero progress signals (${state.consecutiveIdenticalErrors} identical errors). Stopping to prevent waste.`,
            consecutiveErrors: state.consecutiveIdenticalErrors,
            progressSignals: [] as ProgressSignal[],
        };
        // Reset state after blocking so the next request starts fresh.
        // Without this, the synthetic "loop detected" response poisons the
        // conversation history and the agent can never recover.
        state.turnsSinceProgress = 0;
        state.consecutiveIdenticalErrors = 0;
        state.lastErrorHash = '';
        return result;
    }

    if (state.turnsSinceProgress >= NP_WARN_AT) {
        return {
            noProgress: false,
            warning: `Warning: ${state.turnsSinceProgress} turns with no progress. Agent may be stuck.`,
            consecutiveErrors: state.consecutiveIdenticalErrors,
            progressSignals: signals,
        };
    }

    return { noProgress: false, progressSignals: signals };
}

/**
 * Reset progress state for an identifier.
 */
export function resetNoProgress(identifier: string) {
    progressStates.delete(identifier);
}

/**
 * Get aggregate no-progress stats.
 */
export function getNoProgressStats(): { totalFailures: number; activeIdentifiers: number } {
    let totalFailures = 0;
    for (const state of progressStates.values()) {
        totalFailures += state.totalFailures;
    }
    return { totalFailures, activeIdentifiers: progressStates.size };
}
