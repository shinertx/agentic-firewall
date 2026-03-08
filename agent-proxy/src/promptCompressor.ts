import crypto from 'crypto';
import { isOllamaAvailable, ollamaGenerate } from './ollamaClient';
import { globalStats } from './stats';
import { COMP_SYSTEM_PROMPT_THRESHOLD, COMP_HISTORY_THRESHOLD, COMP_MIN_CONTENT_LENGTH, COMP_CACHE_TTL_MS, COMP_MAX_OLLAMA_INPUT, OLLAMA_SUMMARIZE_TIMEOUT_MS } from './config';

export interface CompressionResult {
    compressed: boolean;
    body: any;
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    compressionRatio: number;
    cacheHit: boolean;
    ollamaLatencyMs: number;
}

const SYSTEM_PROMPT_THRESHOLD = COMP_SYSTEM_PROMPT_THRESHOLD;
const HISTORY_THRESHOLD = COMP_HISTORY_THRESHOLD;
const MIN_CONTENT_LENGTH = COMP_MIN_CONTENT_LENGTH;
const CACHE_TTL_MS = COMP_CACHE_TTL_MS;
const MAX_OLLAMA_INPUT = COMP_MAX_OLLAMA_INPUT;
const COMPRESSION_TIMEOUT = OLLAMA_SUMMARIZE_TIMEOUT_MS;

const compressionCache = new Map<string, { compressed: string; tokens: number; createdAt: number }>();

let totalCompressed = 0;
let tokensSaved = 0;
let cacheHits = 0;
let ratioSum = 0;
let ratioCount = 0;

function estimateTokens(text: string): number {
    return Math.round(text.length / 4);
}

function extractSystemContent(body: any, isGemini: boolean, isOpenAI: boolean): string {
    if (isGemini) {
        try {
            const parts = body?.systemInstruction?.parts;
            if (Array.isArray(parts)) {
                return parts.map((p: any) => p.text || '').join('\n');
            }
        } catch { /* ignore */ }
        return '';
    }

    if (isOpenAI) {
        try {
            const messages = body?.messages;
            if (Array.isArray(messages)) {
                return messages
                    .filter((m: any) => m.role === 'system')
                    .map((m: any) => typeof m.content === 'string' ? m.content : '')
                    .join('\n');
            }
        } catch { /* ignore */ }
        return '';
    }

    // Anthropic
    try {
        if (typeof body?.system === 'string') return body.system;
        if (Array.isArray(body?.system)) {
            return body.system
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text || '')
                .join('\n');
        }
    } catch { /* ignore */ }
    return '';
}

function replaceSystemContent(body: any, compressed: string, isGemini: boolean, isOpenAI: boolean): any {
    const clone = JSON.parse(JSON.stringify(body));

    if (isGemini) {
        if (clone.systemInstruction?.parts) {
            clone.systemInstruction.parts = [{ text: compressed }];
        }
        return clone;
    }

    if (isOpenAI) {
        if (Array.isArray(clone.messages)) {
            const idx = clone.messages.findIndex((m: any) => m.role === 'system');
            if (idx !== -1) {
                clone.messages[idx].content = compressed;
            }
        }
        return clone;
    }

    // Anthropic
    if (typeof clone.system === 'string') {
        clone.system = compressed;
    } else if (Array.isArray(clone.system)) {
        clone.system = [{ type: 'text', text: compressed }];
    }
    return clone;
}

function replaceMiddleMessages(body: any, summary: string, isGemini: boolean): any {
    const clone = JSON.parse(JSON.stringify(body));
    const key = isGemini ? 'contents' : 'messages';
    const messages = clone[key];

    if (!Array.isArray(messages)) return clone;

    const first = messages.slice(0, 5);
    const last = messages.slice(-10);

    const summaryRole = isGemini ? 'user' : 'user';
    const summaryMessage = isGemini
        ? { role: summaryRole, parts: [{ text: `[Compressed conversation summary]\n${summary}` }] }
        : { role: summaryRole, content: `[Compressed conversation summary]\n${summary}` };

    // For Gemini, ensure alternation: if last of first 5 is 'user', insert a model ack
    if (isGemini && first.length > 0 && first[first.length - 1]?.role === 'user') {
        first.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }

    clone[key] = [...first, summaryMessage, ...last];
    return clone;
}

async function compressSystemPrompt(content: string): Promise<{ compressed: string; tokens: number; cacheHit: boolean } | null> {
    if (content.length < MIN_CONTENT_LENGTH) return null;

    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const cached = compressionCache.get(hash);

    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
        return { compressed: cached.compressed, tokens: cached.tokens, cacheHit: true };
    }

    const truncated = content.length > MAX_OLLAMA_INPUT ? content.slice(0, MAX_OLLAMA_INPUT) : content;

    const prompt =
        'You are a prompt compressor. Condense the following system prompt into the most essential information.\n\n' +
        'RULES:\n' +
        '- Preserve ALL specific instructions, constraints, and technical requirements\n' +
        '- Preserve exact names, IDs, URLs, code patterns, and format specifications\n' +
        '- Remove verbose explanations, examples that illustrate already-clear points, and redundancy\n' +
        '- Use concise language\n' +
        '- Target length: 25% of original\n' +
        '- Output ONLY the compressed prompt, no commentary\n\n' +
        'SYSTEM PROMPT TO COMPRESS:\n' + truncated;

    const result = await ollamaGenerate(prompt, { timeout: COMPRESSION_TIMEOUT });

    // Require at least 30% reduction — marginal compression isn't worth the
    // Ollama latency and quality risk from a local 3B model.
    if (result.length > 10 && result.length < content.length * 0.7) {
        const tokens = estimateTokens(result);
        compressionCache.set(hash, { compressed: result, tokens, createdAt: Date.now() });
        return { compressed: result, tokens, cacheHit: false };
    }

    return null;
}

async function compressHistory(messages: any[], isGemini: boolean): Promise<{ compressed: string; tokens: number; cacheHit: boolean } | null> {
    const middle = messages.slice(5, -10);
    if (middle.length === 0) return null;

    const textParts: string[] = [];
    for (const msg of middle) {
        if (isGemini) {
            const parts = msg?.parts;
            if (Array.isArray(parts)) {
                for (const p of parts) {
                    if (p.text) textParts.push(`${msg.role || 'unknown'}: ${p.text}`);
                }
            }
        } else {
            const content = msg?.content;
            if (typeof content === 'string') {
                textParts.push(`${msg.role || 'unknown'}: ${content}`);
            } else if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.text) textParts.push(`${msg.role || 'unknown'}: ${block.text}`);
                }
            }
        }
    }

    const text = textParts.join('\n');
    if (text.length < MIN_CONTENT_LENGTH) return null;

    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const cached = compressionCache.get(hash);

    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
        return { compressed: cached.compressed, tokens: cached.tokens, cacheHit: true };
    }

    const truncated = text.length > MAX_OLLAMA_INPUT ? text.slice(0, MAX_OLLAMA_INPUT) : text;

    const prompt =
        'Summarize this conversation segment. Preserve: key decisions, code files modified, errors encountered, current task state. ' +
        'Format as a concise narrative.\n\n' +
        'CONVERSATION:\n' + truncated;

    const result = await ollamaGenerate(prompt, { timeout: COMPRESSION_TIMEOUT });

    // Same 30% floor as system prompt compression
    if (result.length > 10 && result.length < text.length * 0.7) {
        const tokens = estimateTokens(result);
        compressionCache.set(hash, { compressed: result, tokens, createdAt: Date.now() });
        return { compressed: result, tokens, cacheHit: false };
    }

    return null;
}

export async function compressPrompt(
    body: any,
    isGemini: boolean,
    isOpenAI: boolean,
    modelName: string
): Promise<CompressionResult> {
    const noOp: CompressionResult = {
        compressed: false,
        body,
        originalTokens: 0,
        compressedTokens: 0,
        savedTokens: 0,
        compressionRatio: 1.0,
        cacheHit: false,
        ollamaLatencyMs: 0,
    };

    if (!body) return noOp;

    const available = await isOllamaAvailable();
    if (!available) return noOp;

    const startTime = Date.now();
    let modifiedBody = body;
    let totalOriginalTokens = 0;
    let totalCompressedTokens = 0;
    let anyCacheHit = false;
    let anyCompressed = false;

    // System prompt compression
    const systemContent = extractSystemContent(body, isGemini, isOpenAI);
    if (systemContent.length > SYSTEM_PROMPT_THRESHOLD) {
        const result = await compressSystemPrompt(systemContent);
        if (result) {
            const origTokens = estimateTokens(systemContent);
            totalOriginalTokens += origTokens;
            totalCompressedTokens += result.tokens;
            if (result.cacheHit) anyCacheHit = true;
            modifiedBody = replaceSystemContent(modifiedBody, result.compressed, isGemini, isOpenAI);
            anyCompressed = true;
        }
    }

    // History compression
    const messagesKey = isGemini ? 'contents' : 'messages';
    const messages = modifiedBody?.[messagesKey];
    if (Array.isArray(messages) && messages.length > HISTORY_THRESHOLD) {
        const result = await compressHistory(messages, isGemini);
        if (result) {
            const middle = messages.slice(5, -10);
            let middleText = '';
            for (const msg of middle) {
                if (isGemini) {
                    const parts = msg?.parts;
                    if (Array.isArray(parts)) {
                        for (const p of parts) {
                            if (p.text) middleText += p.text;
                        }
                    }
                } else {
                    const content = msg?.content;
                    if (typeof content === 'string') {
                        middleText += content;
                    } else if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.text) middleText += block.text;
                        }
                    }
                }
            }
            const origTokens = estimateTokens(middleText);
            totalOriginalTokens += origTokens;
            totalCompressedTokens += result.tokens;
            if (result.cacheHit) anyCacheHit = true;
            modifiedBody = replaceMiddleMessages(modifiedBody, result.compressed, isGemini);
            anyCompressed = true;
        }
    }

    const ollamaLatencyMs = Date.now() - startTime;

    if (!anyCompressed) return { ...noOp, ollamaLatencyMs };

    const saved = totalOriginalTokens - totalCompressedTokens;
    const ratio = totalOriginalTokens > 0 ? totalCompressedTokens / totalOriginalTokens : 1.0;

    totalCompressed++;
    tokensSaved += saved;
    if (anyCacheHit) cacheHits++;
    ratioSum += ratio;
    ratioCount++;

    globalStats.ollamaCalls++;

    return {
        compressed: true,
        body: modifiedBody,
        originalTokens: totalOriginalTokens,
        compressedTokens: totalCompressedTokens,
        savedTokens: saved,
        compressionRatio: Math.round(ratio * 1000) / 1000,
        cacheHit: anyCacheHit,
        ollamaLatencyMs,
    };
}

export function getCompressionStats(): { totalCompressed: number; tokensSaved: number; cacheHits: number; avgRatio: number } {
    return {
        totalCompressed,
        tokensSaved,
        cacheHits,
        avgRatio: ratioCount > 0 ? Math.round((ratioSum / ratioCount) * 1000) / 1000 : 0,
    };
}

// Cache cleanup every 5 minutes
const cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of compressionCache) {
        if (now - entry.createdAt > CACHE_TTL_MS) {
            compressionCache.delete(key);
        }
    }
}, 5 * 60 * 1000);
cacheCleanupInterval.unref();
