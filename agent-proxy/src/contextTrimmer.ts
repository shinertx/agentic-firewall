/**
 * Context Trimmer — reduces oversized conversation histories before upstream dispatch.
 *
 * The trimmer preserves semantic integrity:
 * - System prompts are always kept in full
 * - Tool-use / tool-result pairs are never split
 * - Gemini's strict alternating user/model turn structure is maintained
 * - Most recent messages have highest priority; oldest are trimmed first
 *
 * Integration point: after circuit breaker + no-progress check, before Context CDN.
 */

import { estimateTokens } from './tokenCounter';
import { getContextWindow, TARGET_RATIO } from './contextWindows';
import { isOllamaAvailable, ollamaGenerate } from './ollamaClient';
import { globalStats } from './stats';

export interface TrimResult {
    trimmed: boolean;
    body: any;
    originalTokens: number;
    trimmedTokens: number;
    removedMessages: number;
    droppedMessages?: any[];
    summarized?: boolean;
}

interface MessageUnit {
    messages: any[];
    tokens: number;
}

const NO_TRIM: TrimResult = { trimmed: false, body: null, originalTokens: 0, trimmedTokens: 0, removedMessages: 0 };

/**
 * Group messages into atomic units that cannot be split.
 * For Anthropic: tool_use (assistant) + tool_result (user) = one unit.
 */
function groupAnthropicMessages(messages: any[]): MessageUnit[] {
    const units: MessageUnit[] = [];
    let i = 0;

    while (i < messages.length) {
        const msg = messages[i];
        const hasToolUse = msg.role === 'assistant' && Array.isArray(msg.content) &&
            msg.content.some((b: any) => b.type === 'tool_use');

        if (hasToolUse && i + 1 < messages.length && messages[i + 1].role === 'user') {
            const nextMsg = messages[i + 1];
            const hasToolResult = Array.isArray(nextMsg.content) &&
                nextMsg.content.some((b: any) => b.type === 'tool_result');
            if (hasToolResult) {
                const pairStr = JSON.stringify(msg) + JSON.stringify(nextMsg);
                units.push({ messages: [msg, nextMsg], tokens: estimateTokens(pairStr) });
                i += 2;
                continue;
            }
        }

        units.push({ messages: [msg], tokens: estimateTokens(JSON.stringify(msg)) });
        i++;
    }

    return units;
}

/**
 * Group OpenAI messages into atomic units.
 * tool_calls (assistant) + subsequent tool responses = one unit.
 */
function groupOpenAIMessages(messages: any[]): MessageUnit[] {
    const units: MessageUnit[] = [];
    let i = 0;

    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
            const group = [msg];
            let j = i + 1;
            while (j < messages.length && messages[j].role === 'tool') {
                group.push(messages[j]);
                j++;
            }
            units.push({ messages: group, tokens: estimateTokens(JSON.stringify(group)) });
            i = j;
            continue;
        }
        units.push({ messages: [msg], tokens: estimateTokens(JSON.stringify(msg)) });
        i++;
    }

    return units;
}

/**
 * Keep as many units as possible from the back (most recent), within a token budget.
 * Returns the index into `units` to start keeping from.
 */
function keepFromBack(units: MessageUnit[], budget: number): { keepFromIndex: number; keptTokens: number } {
    let keptTokens = 0;
    let keepFromIndex = units.length; // default: keep nothing

    for (let j = units.length - 1; j >= 0; j--) {
        if (keptTokens + units[j].tokens <= budget) {
            keptTokens += units[j].tokens;
            keepFromIndex = j;
        } else {
            break;
        }
    }

    return { keepFromIndex, keptTokens };
}

/**
 * Trim an Anthropic request body.
 * Format: { system: string|array, messages: [{role, content}] }
 */
function trimAnthropic(body: any, targetTokens: number): TrimResult {
    const messages = body.messages;
    if (!messages || messages.length === 0) {
        return { ...NO_TRIM, body };
    }

    const systemStr = body.system ? JSON.stringify(body.system) : '';
    const systemTokens = estimateTokens(systemStr);
    const messageBudget = targetTokens - systemTokens;

    if (messageBudget <= 0) {
        return { ...NO_TRIM, body, originalTokens: estimateTokens(JSON.stringify(body)) };
    }

    const units = groupAnthropicMessages(messages);
    const totalMessageTokens = units.reduce((sum, u) => sum + u.tokens, 0);

    if (totalMessageTokens <= messageBudget) {
        return { trimmed: false, body, originalTokens: systemTokens + totalMessageTokens, trimmedTokens: 0, removedMessages: 0 };
    }

    const { keepFromIndex, keptTokens } = keepFromBack(units, messageBudget);
    const droppedUnits = units.slice(0, keepFromIndex);
    const keptUnits = units.slice(keepFromIndex);
    const removedCount = droppedUnits.reduce((sum, u) => sum + u.messages.length, 0);
    const droppedMessages = droppedUnits.flatMap(u => u.messages);
    const trimmedMessages = keptUnits.flatMap(u => u.messages);

    // Anthropic requires first message to be role: 'user'.
    // Must drop entire tool_use/tool_result pairs to avoid orphaned tool_result blocks
    // that reference a tool_use_id from a removed assistant message.
    while (trimmedMessages.length > 0 && trimmedMessages[0].role === 'assistant') {
        trimmedMessages.shift();
        // If the next message is a paired tool_result, remove it too
        if (trimmedMessages.length > 0 && trimmedMessages[0].role === 'user' &&
            Array.isArray(trimmedMessages[0].content) &&
            trimmedMessages[0].content.some((b: any) => b.type === 'tool_result')) {
            trimmedMessages.shift();
        }
    }

    return {
        trimmed: true,
        body: { ...body, messages: trimmedMessages },
        originalTokens: systemTokens + totalMessageTokens,
        trimmedTokens: (systemTokens + totalMessageTokens) - (systemTokens + keptTokens),
        removedMessages: removedCount,
        droppedMessages,
    };
}

/**
 * Trim an OpenAI/NVIDIA request body.
 * Format: { messages: [{role, content}] } — system messages in the array.
 */
function trimOpenAI(body: any, targetTokens: number): TrimResult {
    const messages = body.messages;
    if (!messages || messages.length === 0) {
        return { ...NO_TRIM, body };
    }

    const systemMsgs = messages.filter((m: any) => m.role === 'system');
    const convMsgs = messages.filter((m: any) => m.role !== 'system');

    const systemTokens = estimateTokens(JSON.stringify(systemMsgs));
    const messageBudget = targetTokens - systemTokens;

    if (messageBudget <= 0) {
        return { ...NO_TRIM, body, originalTokens: estimateTokens(JSON.stringify(body)) };
    }

    const units = groupOpenAIMessages(convMsgs);
    const totalConvTokens = units.reduce((sum, u) => sum + u.tokens, 0);

    if (totalConvTokens <= messageBudget) {
        return { trimmed: false, body, originalTokens: systemTokens + totalConvTokens, trimmedTokens: 0, removedMessages: 0 };
    }

    const { keepFromIndex, keptTokens } = keepFromBack(units, messageBudget);
    const droppedUnits = units.slice(0, keepFromIndex);
    const keptUnits = units.slice(keepFromIndex);
    const removedCount = droppedUnits.reduce((sum, u) => sum + u.messages.length, 0);
    const droppedMessages = droppedUnits.flatMap(u => u.messages);
    const trimmedConvMsgs = keptUnits.flatMap(u => u.messages);

    return {
        trimmed: true,
        body: { ...body, messages: [...systemMsgs, ...trimmedConvMsgs] },
        originalTokens: systemTokens + totalConvTokens,
        trimmedTokens: (systemTokens + totalConvTokens) - (systemTokens + keptTokens),
        removedMessages: removedCount,
        droppedMessages,
    };
}

/**
 * Trim a Gemini request body.
 * Format: { systemInstruction: {...}, contents: [{role, parts}] }
 * CRITICAL: Gemini requires STRICT alternating user/model turns.
 * We only remove complete (user, model) pairs from the front.
 */
function trimGemini(body: any, targetTokens: number): TrimResult {
    const contents = body.contents;
    if (!contents || contents.length === 0) {
        return { ...NO_TRIM, body };
    }

    const sysStr = body.systemInstruction ? JSON.stringify(body.systemInstruction) : '';
    const systemTokens = estimateTokens(sysStr);
    const messageBudget = targetTokens - systemTokens;

    if (messageBudget <= 0) {
        return { ...NO_TRIM, body, originalTokens: estimateTokens(JSON.stringify(body)) };
    }

    // Group into (user, model) pairs to preserve alternation
    const pairs: MessageUnit[] = [];
    let i = 0;
    while (i < contents.length) {
        if (i + 1 < contents.length &&
            contents[i].role === 'user' &&
            contents[i + 1].role === 'model') {
            const pairStr = JSON.stringify(contents[i]) + JSON.stringify(contents[i + 1]);
            pairs.push({ messages: [contents[i], contents[i + 1]], tokens: estimateTokens(pairStr) });
            i += 2;
        } else {
            // Final user message or mismatched — treat as standalone
            pairs.push({ messages: [contents[i]], tokens: estimateTokens(JSON.stringify(contents[i])) });
            i++;
        }
    }

    const totalTokens = pairs.reduce((sum, p) => sum + p.tokens, 0);
    if (totalTokens <= messageBudget) {
        return { trimmed: false, body, originalTokens: systemTokens + totalTokens, trimmedTokens: 0, removedMessages: 0 };
    }

    const { keepFromIndex, keptTokens } = keepFromBack(pairs, messageBudget);
    const droppedPairs = pairs.slice(0, keepFromIndex);
    const keptPairs = pairs.slice(keepFromIndex);
    const removedCount = droppedPairs.reduce((sum, p) => sum + p.messages.length, 0);
    const droppedMessages = droppedPairs.flatMap(p => p.messages);
    const trimmedContents = keptPairs.flatMap(p => p.messages);

    // Ensure alternation: first content must be 'user'
    if (trimmedContents.length > 0 && trimmedContents[0].role === 'model') {
        trimmedContents.shift();
    }

    return {
        trimmed: true,
        body: { ...body, contents: trimmedContents },
        originalTokens: systemTokens + totalTokens,
        trimmedTokens: (systemTokens + totalTokens) - (systemTokens + keptTokens),
        removedMessages: removedCount,
        droppedMessages,
    };
}

/**
 * Main entry point: trim a request body if it exceeds the model's context window.
 *
 * @param body - The request body (Anthropic, OpenAI, or Gemini format)
 * @param isGemini - Whether this is a Gemini request
 * @param isOpenAI - Whether this is an OpenAI/NVIDIA request
 * @param modelName - The model name (for context window lookup)
 * @param bodyLength - Pre-computed string length of the body (avoids re-serialization)
 */
export function trimContext(
    body: any,
    isGemini: boolean,
    isOpenAI: boolean,
    modelName: string,
    bodyLength?: number,
): TrimResult {
    if (!body) {
        return { ...NO_TRIM };
    }

    // Quick check: estimate total tokens from pre-computed body length
    const totalChars = bodyLength || JSON.stringify(body).length;
    const estimatedTotalTokens = Math.round(totalChars / 4);

    const contextWindow = getContextWindow(modelName || 'unknown');
    const targetTokens = Math.floor(contextWindow * TARGET_RATIO);

    // If under the target, no trimming needed
    if (estimatedTotalTokens <= targetTokens) {
        return { trimmed: false, body, originalTokens: estimatedTotalTokens, trimmedTokens: 0, removedMessages: 0 };
    }

    console.log(`[PROXY Context Trimmer] Payload ~${estimatedTotalTokens} tokens exceeds target ${targetTokens} (${contextWindow} * ${TARGET_RATIO}). Trimming...`);

    if (isGemini) {
        return trimGemini(body, targetTokens);
    } else if (isOpenAI) {
        return trimOpenAI(body, targetTokens);
    } else {
        return trimAnthropic(body, targetTokens);
    }
}

/**
 * Extract text content from dropped messages for summarization.
 */
function extractTextFromMessages(messages: any[], isGemini: boolean): string {
    const lines: string[] = [];
    for (const m of messages) {
        const role = m.role || 'unknown';
        let text = '';

        if (isGemini && m.parts) {
            text = m.parts.map((p: any) => p.text || '').filter(Boolean).join(' ');
        } else if (typeof m.content === 'string') {
            text = m.content;
        } else if (Array.isArray(m.content)) {
            text = m.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text || '')
                .join(' ');
        }

        if (text) {
            // Truncate individual messages to keep the prompt reasonable
            lines.push(`${role}: ${text.slice(0, 300)}`);
        }
    }
    return lines.join('\n');
}

/**
 * Summarize dropped messages using Ollama.
 * Returns null if Ollama is unavailable or summarization fails.
 */
export async function summarizeDroppedMessages(
    messages: any[],
    isGemini: boolean,
): Promise<string | null> {
    if (!messages || messages.length === 0) return null;

    const available = await isOllamaAvailable();
    if (!available) return null;

    const conversationText = extractTextFromMessages(messages, isGemini);
    if (!conversationText) return null;

    // Limit input to ~2000 chars to keep Ollama response fast
    const truncated = conversationText.slice(0, 2000);

    const prompt = `Summarize this conversation history in 2-3 concise sentences. Preserve key decisions, file names, and technical context. Be factual and brief.

Conversation:
${truncated}

Summary:`;

    globalStats.ollamaCalls++;
    const summary = await ollamaGenerate(prompt, { timeout: 5000 });

    if (summary && summary.length > 10) {
        return `[Context Summary] ${summary}`;
    }
    return null;
}

/**
 * Apply Ollama summarization to a trim result.
 * Prepends a summary of dropped messages to the trimmed body.
 * Returns the modified TrimResult with summarized=true, or the original if summarization fails.
 */
export async function applyOllamaSummary(
    trimResult: TrimResult,
    isGemini: boolean,
): Promise<TrimResult> {
    if (!trimResult.trimmed || !trimResult.droppedMessages || trimResult.droppedMessages.length === 0) {
        return trimResult;
    }

    const summary = await summarizeDroppedMessages(trimResult.droppedMessages, isGemini);
    if (!summary) return trimResult;

    const body = trimResult.body;

    if (isGemini && body.contents) {
        // Prepend summary as a user turn
        body.contents = [
            { role: 'user', parts: [{ text: summary }] },
            ...body.contents,
        ];
    } else if (body.messages) {
        // Find insertion point: after system messages (OpenAI) or at front (Anthropic)
        const firstNonSystem = body.messages.findIndex((m: any) => m.role !== 'system');
        const insertAt = firstNonSystem === -1 ? 0 : firstNonSystem;
        body.messages.splice(insertAt, 0, { role: 'user', content: summary });
    }

    return { ...trimResult, body, summarized: true };
}
