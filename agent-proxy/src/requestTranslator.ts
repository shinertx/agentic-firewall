import { getProviderKey, getProviderHeaderConfig } from './keyVault';
import { getContextWindow } from './contextWindows';

export type ProviderFormat = 'anthropic' | 'openai' | 'gemini';

export interface TranslationResult {
    body: any;
    url: string;
    headers: Record<string, string>;
    targetProvider: string;
    targetModel: string;
}

export interface TranslationError {
    error: string;
    reason: 'tool_use' | 'context_too_large' | 'no_key' | 'unsupported_format';
}

interface CrossProviderTarget {
    sourcePattern: string;
    targetModel: string;
    targetProvider: string;
}

// Cross-provider failover: when same-provider 429 failover also fails,
// try an equivalent-tier model on a different provider.
//
// ┌──────────────────────────────────────────────────────────────────────┐
// │              CROSS-PROVIDER EQUIVALENCE MAPPING                     │
// │                                                                     │
// │ Tier 1 (Premium):  Opus ↔ GPT-4o ↔ Gemini 2.5 Pro                │
// │ Tier 2 (Standard): Sonnet ↔ GPT-4.1 ↔ Gemini 2.5 Pro            │
// │ Tier 3 (Budget):   Haiku ↔ GPT-4o-mini ↔ Gemini 2.5 Flash       │
// │ Reasoning:         o3/o1 → Sonnet (best non-reasoning alternative) │
// └──────────────────────────────────────────────────────────────────────┘
const CROSS_PROVIDER_MAP: CrossProviderTarget[] = [
    // Anthropic → OpenAI
    { sourcePattern: 'opus', targetModel: 'gpt-4o', targetProvider: 'openai' },
    { sourcePattern: 'sonnet', targetModel: 'gpt-4.1', targetProvider: 'openai' },
    { sourcePattern: 'haiku', targetModel: 'gpt-4o-mini', targetProvider: 'openai' },

    // OpenAI → Anthropic
    { sourcePattern: 'o3', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'o1', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gpt-5', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gpt-4.1', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gpt-4o', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gpt-4', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },

    // Gemini → Anthropic (best text quality)
    { sourcePattern: 'gemini-2.5-pro', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gemini-2.5-flash', targetModel: 'gpt-4o-mini', targetProvider: 'openai' },
    { sourcePattern: 'gemini-2.0-flash', targetModel: 'gpt-4o-mini', targetProvider: 'openai' },
    { sourcePattern: 'gemini-1.5-pro', targetModel: 'claude-sonnet-4-6', targetProvider: 'anthropic' },
    { sourcePattern: 'gemini-1.5-flash', targetModel: 'gpt-4o-mini', targetProvider: 'openai' },
];

const PROVIDER_URLS = {
    anthropic: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
};

function buildGeminiUrl(model: string, stream: boolean, apiKey: string): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}`;
}

export function detectFormat(body: any): ProviderFormat {
    try {
        if (body.contents && Array.isArray(body.contents)) {
            return 'gemini';
        }
        if (body.system !== undefined) {
            return 'anthropic';
        }
        return 'openai';
    } catch {
        return 'openai';
    }
}

export function hasToolUseContent(body: any, format: ProviderFormat): boolean {
    try {
        if (format === 'anthropic') {
            const messages = body.messages || [];
            for (const msg of messages) {
                if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === 'tool_use' || block.type === 'tool_result') {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        if (format === 'openai') {
            const messages = body.messages || [];
            for (const msg of messages) {
                if (Array.isArray(msg.tool_calls)) {
                    return true;
                }
                if (msg.role === 'tool') {
                    return true;
                }
            }
            return false;
        }

        if (format === 'gemini') {
            const contents = body.contents || [];
            for (const content of contents) {
                const parts = content.parts || [];
                for (const part of parts) {
                    if (part.functionCall || part.functionResponse) {
                        return true;
                    }
                }
            }
            return false;
        }

        return false;
    } catch {
        return false;
    }
}

export function findCrossProviderTarget(model: string): CrossProviderTarget | null {
    try {
        const lower = model.toLowerCase();
        for (const entry of CROSS_PROVIDER_MAP) {
            if (lower.includes(entry.sourcePattern)) {
                return entry;
            }
        }
        return null;
    } catch {
        return null;
    }
}

function extractTextFromBlocks(content: any): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter((block: any) => block.type === 'text' && block.text)
            .map((block: any) => block.text)
            .join('\n');
    }
    return '';
}

function enforceAlternation(contents: any[]): any[] {
    if (contents.length === 0) return contents;

    const merged: any[] = [contents[0]];
    for (let i = 1; i < contents.length; i++) {
        const prev = merged[merged.length - 1];
        const curr = contents[i];
        if (prev.role === curr.role) {
            const prevParts = prev.parts || [];
            const currParts = curr.parts || [];
            merged[merged.length - 1] = {
                role: prev.role,
                parts: [...prevParts, ...currParts],
            };
        } else {
            merged.push(curr);
        }
    }
    return merged;
}

function anthropicToOpenAI(body: any, targetModel: string): any {
    try {
        const messages: any[] = [];

        if (body.system) {
            const systemText = extractTextFromBlocks(body.system);
            if (systemText) {
                messages.push({ role: 'system', content: systemText });
            }
        }

        const srcMessages = body.messages || [];
        for (const msg of srcMessages) {
            messages.push({
                role: msg.role,
                content: extractTextFromBlocks(msg.content),
            });
        }

        return {
            model: targetModel,
            messages,
            max_tokens: body.max_tokens,
            stream: body.stream,
        };
    } catch {
        return { model: targetModel, messages: [], stream: body.stream };
    }
}

function openAIToAnthropic(body: any, targetModel: string): any {
    try {
        const srcMessages = body.messages || [];
        const systemParts: string[] = [];
        const messages: any[] = [];

        for (const msg of srcMessages) {
            if (msg.role === 'system') {
                const text = typeof msg.content === 'string' ? msg.content : '';
                if (text) systemParts.push(text);
            } else {
                messages.push({ role: msg.role, content: msg.content });
            }
        }

        const system = systemParts.join('\n');
        const max_tokens = body.max_tokens || body.max_completion_tokens || 4096;

        return {
            model: targetModel,
            system,
            messages,
            max_tokens,
            stream: body.stream,
        };
    } catch {
        return { model: targetModel, system: '', messages: [], max_tokens: 4096, stream: body.stream };
    }
}

function anthropicToGemini(body: any, targetModel: string): any {
    try {
        let systemInstruction: any = undefined;
        if (body.system) {
            const text = extractTextFromBlocks(body.system);
            if (text) {
                systemInstruction = { parts: [{ text }] };
            }
        }

        const contents: any[] = [];
        const srcMessages = body.messages || [];
        for (const msg of srcMessages) {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            const text = extractTextFromBlocks(msg.content);
            contents.push({ role, parts: [{ text }] });
        }

        const merged = enforceAlternation(contents);

        const result: any = {
            contents: merged,
            generationConfig: { maxOutputTokens: body.max_tokens || 4096 },
        };
        if (systemInstruction) {
            result.systemInstruction = systemInstruction;
        }
        return result;
    } catch {
        return { contents: [], generationConfig: { maxOutputTokens: 4096 } };
    }
}

function openAIToGemini(body: any, targetModel: string): any {
    try {
        let systemInstruction: any = undefined;
        const contents: any[] = [];
        const srcMessages = body.messages || [];

        for (const msg of srcMessages) {
            if (msg.role === 'system') {
                const text = typeof msg.content === 'string' ? msg.content : '';
                if (text) {
                    systemInstruction = { parts: [{ text }] };
                }
            } else {
                const role = msg.role === 'assistant' ? 'model' : 'user';
                const text = typeof msg.content === 'string' ? msg.content : '';
                contents.push({ role, parts: [{ text }] });
            }
        }

        const merged = enforceAlternation(contents);

        const result: any = {
            contents: merged,
            generationConfig: { maxOutputTokens: body.max_tokens || body.max_completion_tokens || 4096 },
        };
        if (systemInstruction) {
            result.systemInstruction = systemInstruction;
        }
        return result;
    } catch {
        return { contents: [], generationConfig: { maxOutputTokens: 4096 } };
    }
}

function geminiToAnthropic(body: any, targetModel: string): any {
    try {
        let system = '';
        if (body.systemInstruction && body.systemInstruction.parts) {
            system = body.systemInstruction.parts
                .map((p: any) => p.text || '')
                .join('\n');
        }

        const messages: any[] = [];
        const srcContents = body.contents || [];
        for (const content of srcContents) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const parts = content.parts || [];
            const text = parts.map((p: any) => p.text || '').join('\n');
            messages.push({ role, content: text });
        }

        if (messages.length > 0 && messages[0].role !== 'user') {
            messages.unshift({ role: 'user', content: '' });
        }

        return {
            model: targetModel,
            system,
            messages,
            max_tokens: 4096,
            stream: body.stream,
        };
    } catch {
        return { model: targetModel, system: '', messages: [], max_tokens: 4096 };
    }
}

function geminiToOpenAI(body: any, targetModel: string): any {
    try {
        const messages: any[] = [];

        if (body.systemInstruction && body.systemInstruction.parts) {
            const text = body.systemInstruction.parts
                .map((p: any) => p.text || '')
                .join('\n');
            if (text) {
                messages.push({ role: 'system', content: text });
            }
        }

        const srcContents = body.contents || [];
        for (const content of srcContents) {
            const role = content.role === 'model' ? 'assistant' : 'user';
            const parts = content.parts || [];
            const text = parts.map((p: any) => p.text || '').join('\n');
            messages.push({ role, content: text });
        }

        return {
            model: targetModel,
            messages,
        };
    } catch {
        return { model: targetModel, messages: [] };
    }
}

function translateBody(body: any, sourceFormat: ProviderFormat, targetFormat: ProviderFormat, targetModel: string): any {
    if (sourceFormat === 'anthropic' && targetFormat === 'openai') {
        return anthropicToOpenAI(body, targetModel);
    }
    if (sourceFormat === 'openai' && targetFormat === 'anthropic') {
        return openAIToAnthropic(body, targetModel);
    }
    if (sourceFormat === 'anthropic' && targetFormat === 'gemini') {
        return anthropicToGemini(body, targetModel);
    }
    if (sourceFormat === 'openai' && targetFormat === 'gemini') {
        return openAIToGemini(body, targetModel);
    }
    if (sourceFormat === 'gemini' && targetFormat === 'anthropic') {
        return geminiToAnthropic(body, targetModel);
    }
    if (sourceFormat === 'gemini' && targetFormat === 'openai') {
        return geminiToOpenAI(body, targetModel);
    }
    return body;
}

function targetProviderToFormat(provider: string): ProviderFormat {
    if (provider === 'anthropic') return 'anthropic';
    if (provider === 'gemini') return 'gemini';
    return 'openai';
}

export function translateRequest(
    body: any,
    sourceFormat: ProviderFormat,
    targetProvider: string,
    targetModel: string,
    callerKey?: string,
): TranslationResult | TranslationError {
    try {
        if (hasToolUseContent(body, sourceFormat)) {
            return { error: 'Cannot translate requests with tool use content', reason: 'tool_use' };
        }

        // Use the caller's own key if provided; only fall back to server-side
        // env keys when no caller key is available (local-first mode).
        let apiKey: string;
        if (callerKey) {
            apiKey = callerKey;
        } else {
            const keyResult = getProviderKey(targetProvider as any);
            if ('error' in keyResult) {
                return { error: keyResult.error, reason: 'no_key' };
            }
            apiKey = keyResult.key;
        }

        const estimatedTokens = JSON.stringify(body).length / 4;
        const contextWindow = getContextWindow(targetModel);
        if (estimatedTokens > contextWindow * 0.8) {
            return {
                error: `Estimated ${Math.round(estimatedTokens)} tokens exceeds 80% of ${targetModel} context window (${contextWindow})`,
                reason: 'context_too_large',
            };
        }

        const targetFormat = targetProviderToFormat(targetProvider);
        const translatedBody = translateBody(body, sourceFormat, targetFormat, targetModel);

        const headers: Record<string, string> = {};
        const { headerName, headerPrefix } = getProviderHeaderConfig(targetProvider as any);
        let url: string;

        if (targetProvider === 'anthropic') {
            headers[headerName] = `${headerPrefix}${apiKey}`;
            headers['anthropic-version'] = '2023-06-01';
            headers['content-type'] = 'application/json';
            url = PROVIDER_URLS.anthropic;
        } else if (targetProvider === 'gemini') {
            headers['content-type'] = 'application/json';
            const isStream = !!(body.stream || translatedBody.stream);
            url = buildGeminiUrl(targetModel, isStream, apiKey);
        } else {
            headers[headerName] = `${headerPrefix}${apiKey}`;
            headers['content-type'] = 'application/json';
            url = PROVIDER_URLS.openai;
        }

        return {
            body: translatedBody,
            url,
            headers,
            targetProvider,
            targetModel,
        };
    } catch (err: any) {
        return {
            error: err?.message || 'Translation failed',
            reason: 'unsupported_format',
        };
    }
}
