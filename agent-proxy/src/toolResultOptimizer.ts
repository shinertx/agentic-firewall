/**
 * Tool Result Optimizer — deduplicates and compresses stale tool results
 * to reduce token waste in long agentic conversations.
 *
 * Two passes:
 *   1. Dedup: If the same tool result content appears multiple times in the
 *      conversation, replace all but the most recent with a compact reference.
 *   2. Stale compression: For tool results outside the recent window that
 *      exceed a size threshold, replace with head+tail summary. The agent
 *      can always re-invoke the tool if it needs the full content.
 *
 * Handles Anthropic, OpenAI, and Gemini message formats.
 */

import crypto from 'crypto';
import {
    TRO_RECENT_WINDOW,
    TRO_SIZE_THRESHOLD,
    TRO_HEAD_LINES,
    TRO_TAIL_LINES,
} from './config';

export interface OptimizeResult {
    optimized: boolean;
    body: any;
    dedupedCount: number;
    compressedCount: number;
    savedChars: number;
}

const NO_OP: OptimizeResult = { optimized: false, body: null, dedupedCount: 0, compressedCount: 0, savedChars: 0 };

interface ToolResultEntry {
    msgIndex: number;
    blockIndex: number;       // -1 for OpenAI (whole message), index within content array for Anthropic
    content: string;          // stringified content for hashing
    charCount: number;
    toolName: string;
    format: 'anthropic' | 'openai' | 'gemini';
}

// ─── Content extraction helpers ────────────────────────────

function anthropicToolResultText(block: any): string {
    if (typeof block.content === 'string') return block.content;
    if (Array.isArray(block.content)) {
        return block.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text || '')
            .join('\n');
    }
    return '';
}

function geminiResponseText(resp: any): string {
    if (!resp) return '';
    if (typeof resp === 'string') return resp;
    // Extract the longest string value from the response object.
    // Common patterns: { content: "..." }, { result: "..." }, { text: "..." }
    // This avoids JSON.stringify escaping newlines, which breaks line-based summarization.
    if (typeof resp === 'object' && !Array.isArray(resp)) {
        let longest = '';
        for (const val of Object.values(resp)) {
            if (typeof val === 'string' && val.length > longest.length) {
                longest = val;
            }
        }
        if (longest.length > 100) return longest;
    }
    return JSON.stringify(resp);
}

// ─── Tool name extraction ──────────────────────────────────

function findAnthropicToolName(messages: any[], toolUseId: string): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (block.type === 'tool_use' && block.id === toolUseId) {
                return block.name || 'tool';
            }
        }
    }
    return 'tool';
}

function findOpenAIToolName(messages: any[], toolCallId: string): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant' || !msg.tool_calls) continue;
        for (const tc of msg.tool_calls) {
            if (tc.id === toolCallId) {
                return tc.function?.name || 'tool';
            }
        }
    }
    return 'tool';
}

// ─── Summary generation ────────────────────────────────────

function makeSummary(content: string, toolName: string, reason: string): string {
    const lines = content.split('\n');
    const lineCount = lines.length;
    const charCount = content.length;
    const tokenEst = Math.round(charCount / 4);

    const head = lines.slice(0, TRO_HEAD_LINES).join('\n');
    const tail = lines.slice(-TRO_TAIL_LINES).join('\n');

    if (lineCount <= TRO_HEAD_LINES + TRO_TAIL_LINES) {
        // Content is small enough that head+tail would be the whole thing — just keep it
        return content;
    }

    return (
        `[${reason}: ${toolName}() — ${lineCount} lines, ~${tokenEst} tokens]\n` +
        head + '\n' +
        `\n... ${lineCount - TRO_HEAD_LINES - TRO_TAIL_LINES} lines omitted — re-invoke tool if needed ...\n\n` +
        tail
    );
}

function makeGeminiSummary(content: string, toolName: string, reason: string): object {
    return { _optimized: reason, tool: toolName, summary: makeSummary(content, toolName, reason) };
}

// ─── Collector: walk messages and find all tool results ────

function collectToolResults(messages: any[], format: 'anthropic' | 'openai' | 'gemini'): ToolResultEntry[] {
    const entries: ToolResultEntry[] = [];

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (format === 'anthropic') {
            if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
            for (let j = 0; j < msg.content.length; j++) {
                const block = msg.content[j];
                if (block.type !== 'tool_result') continue;
                const text = anthropicToolResultText(block);
                if (!text) continue;
                const toolName = findAnthropicToolName(messages, block.tool_use_id);
                entries.push({
                    msgIndex: i,
                    blockIndex: j,
                    content: text,
                    charCount: text.length,
                    toolName,
                    format,
                });
            }
        } else if (format === 'openai') {
            if (msg.role !== 'tool') continue;
            const text = typeof msg.content === 'string' ? msg.content : '';
            if (!text) continue;
            const toolName = findOpenAIToolName(messages, msg.tool_call_id);
            entries.push({
                msgIndex: i,
                blockIndex: -1,
                content: text,
                charCount: text.length,
                toolName,
                format,
            });
        } else if (format === 'gemini') {
            if (!msg.parts || !Array.isArray(msg.parts)) continue;
            for (let j = 0; j < msg.parts.length; j++) {
                const part = msg.parts[j];
                if (!part.functionResponse) continue;
                const text = geminiResponseText(part.functionResponse.response);
                if (!text) continue;
                entries.push({
                    msgIndex: i,
                    blockIndex: j,
                    content: text,
                    charCount: text.length,
                    toolName: part.functionResponse.name || 'function',
                    format,
                });
            }
        }
    }

    return entries;
}

// ─── Dedup pass ────────────────────────────────────────────

function hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function findDuplicates(entries: ToolResultEntry[]): Set<number> {
    // Group entries by content hash. For each group with >1, mark all but the last (most recent).
    const groups = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].charCount < 100) continue; // Don't dedup tiny results
        const hash = hashContent(entries[i].content);
        const list = groups.get(hash) || [];
        list.push(i);
        groups.set(hash, list);
    }

    const toDedup = new Set<number>();
    for (const indices of groups.values()) {
        if (indices.length < 2) continue;
        // Keep the last occurrence, mark all earlier ones for dedup
        for (let k = 0; k < indices.length - 1; k++) {
            toDedup.add(indices[k]);
        }
    }
    return toDedup;
}

// ─── Stale compression pass ────────────────────────────────

function findStaleEntries(entries: ToolResultEntry[], totalMessages: number): Set<number> {
    const boundary = totalMessages - TRO_RECENT_WINDOW;
    const toCompress = new Set<number>();

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.msgIndex >= boundary) continue;        // Inside recent window — skip
        if (entry.charCount < TRO_SIZE_THRESHOLD) continue; // Too small to bother
        toCompress.add(i);
    }

    return toCompress;
}

// ─── Apply changes to cloned body ──────────────────────────

function applyChanges(
    messages: any[],
    entries: ToolResultEntry[],
    toDedupSet: Set<number>,
    toCompressSet: Set<number>,
): { savedChars: number; dedupedCount: number; compressedCount: number } {
    let savedChars = 0;
    let dedupedCount = 0;
    let compressedCount = 0;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isDedup = toDedupSet.has(i);
        const isCompress = toCompressSet.has(i) && !isDedup; // Dedup takes priority

        if (!isDedup && !isCompress) continue;

        const reason = isDedup ? 'Duplicate — see latest version below' : 'Compressed stale result';
        let replacement: string;

        if (isDedup) {
            // Very compact for dedup — just a reference
            replacement = `[Duplicate ${entry.toolName}() result — identical content appears later in conversation. Re-invoke if needed.]`;
            dedupedCount++;
        } else {
            replacement = makeSummary(entry.content, entry.toolName, 'Compressed stale result');
            compressedCount++;
        }

        // Only count savings if the replacement is actually shorter
        if (replacement.length >= entry.charCount) continue;
        savedChars += entry.charCount - replacement.length;

        const msg = messages[entry.msgIndex];

        if (entry.format === 'anthropic') {
            const block = msg.content[entry.blockIndex];
            block.content = replacement;
        } else if (entry.format === 'openai') {
            msg.content = replacement;
        } else if (entry.format === 'gemini') {
            msg.parts[entry.blockIndex].functionResponse.response = isDedup
                ? { _optimized: 'duplicate', summary: replacement }
                : makeGeminiSummary(entry.content, entry.toolName, 'Compressed stale result');
        }
    }

    return { savedChars, dedupedCount, compressedCount };
}

// ─── Main entry point ──────────────────────────────────────

export function optimizeToolResults(
    body: any,
    isGemini: boolean,
    isOpenAI: boolean,
): OptimizeResult {
    if (!body) return NO_OP;

    const messagesKey = isGemini ? 'contents' : 'messages';
    const messages = body[messagesKey];
    if (!Array.isArray(messages) || messages.length <= TRO_RECENT_WINDOW) return NO_OP;

    const format = isGemini ? 'gemini' : isOpenAI ? 'openai' : 'anthropic';
    const entries = collectToolResults(messages, format);
    if (entries.length === 0) return NO_OP;

    const toDedupSet = findDuplicates(entries);
    const toCompressSet = findStaleEntries(entries, messages.length);

    // Nothing to optimize
    if (toDedupSet.size === 0 && toCompressSet.size === 0) return NO_OP;

    // Deep clone the body so we don't mutate the original
    const cloned = JSON.parse(JSON.stringify(body));
    const clonedMessages = cloned[messagesKey];

    // Re-collect on cloned messages (entries reference message indices, which are stable)
    const clonedEntries = collectToolResults(clonedMessages, format);
    const { savedChars, dedupedCount, compressedCount } = applyChanges(
        clonedMessages,
        clonedEntries,
        toDedupSet,
        toCompressSet,
    );

    if (savedChars === 0) return NO_OP;

    return {
        optimized: true,
        body: cloned,
        dedupedCount,
        compressedCount,
        savedChars,
    };
}
