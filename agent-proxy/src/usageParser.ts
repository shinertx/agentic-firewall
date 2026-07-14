// Parses real token usage data from SSE stream chunks returned by LLM providers.
// Each parser is fault-tolerant: malformed data returns null, never throws.

export interface ParsedUsage {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheCreationTokens: number;
    provider: 'anthropic' | 'openai' | 'gemini' | 'unknown';
}

/**
 * Parse usage from Anthropic SSE stream chunks.
 * Looks for message_start (input/cache tokens) and message_delta (output tokens).
 */
export function parseAnthropicUsage(chunks: Buffer[]): ParsedUsage | null {
    try {
        const text = Buffer.concat(chunks).toString('utf-8');

        let inputTokens = 0;
        let outputTokens = 0;
        let cachedTokens = 0;
        let cacheCreationTokens = 0;
        let found = false;

        const eventRegex = /event:\s*(\w+)\r?\ndata:\s*(.+)/g;
        let match: RegExpExecArray | null;

        while ((match = eventRegex.exec(text)) !== null) {
            const eventType = match[1];
            const dataStr = match[2];

            let data: any;
            try {
                data = JSON.parse(dataStr);
            } catch {
                continue;
            }

            if (eventType === 'message_start' && data?.message?.usage) {
                const usage = data.message.usage;
                inputTokens = usage.input_tokens || 0;
                cachedTokens = usage.cache_read_input_tokens || 0;
                cacheCreationTokens = usage.cache_creation_input_tokens || 0;
                found = true;
            }

            if (eventType === 'message_delta' && data?.usage) {
                outputTokens = data.usage.output_tokens || 0;
                found = true;
            }
        }

        return found ? { inputTokens, outputTokens, cachedTokens, cacheCreationTokens, provider: 'anthropic' } : null;
    } catch {
        return null;
    }
}

/**
 * Parse usage from OpenAI SSE stream chunks.
 * The final data chunk before [DONE] contains usage when stream_options.include_usage was set.
 */
export function parseOpenAIUsage(chunks: Buffer[]): ParsedUsage | null {
    try {
        const text = Buffer.concat(chunks).toString('utf-8');

        // Split on data: prefix boundaries, filtering empty segments
        const segments = text.split('\ndata: ').flatMap(s => {
            // Handle leading "data: " at the very start of the stream
            if (s.startsWith('data: ')) {
                return [s.slice(6)];
            }
            return [s];
        });

        // Walk segments in reverse to find the usage chunk (appears just before [DONE])
        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i].trim();

            if (segment === '[DONE]' || segment === '') continue;

            let data: any;
            try {
                data = JSON.parse(segment);
            } catch {
                continue;
            }

            if (data?.usage) {
                const usage = data.usage;
                return {
                    inputTokens: usage.prompt_tokens || 0,
                    outputTokens: usage.completion_tokens || 0,
                    cachedTokens: usage.prompt_tokens_details?.cached_tokens || 0,
                    cacheCreationTokens: 0,
                    provider: 'openai',
                };
            }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Parse usage from Gemini JSON response.
 * Gemini returns usageMetadata in the response body (not SSE).
 */
export function parseGeminiUsage(chunks: Buffer[]): ParsedUsage | null {
    try {
        const text = Buffer.concat(chunks).toString('utf-8');

        const data = JSON.parse(text);
        const metadata = data?.usageMetadata;

        if (!metadata) return null;

        return {
            inputTokens: metadata.promptTokenCount || 0,
            outputTokens: metadata.candidatesTokenCount || 0,
            cachedTokens: metadata.cachedContentTokenCount || 0,
            cacheCreationTokens: 0,
            provider: 'gemini',
        };
    } catch {
        return null;
    }
}

/**
 * Dispatch to the correct parser based on provider string.
 * For unknown providers, tries all parsers and returns the first match.
 */
export function parseUsageFromChunks(chunks: Buffer[], provider: string): ParsedUsage | null {
    try {
        if (!chunks || chunks.length === 0) return null;

        switch (provider) {
            case 'anthropic':
                return parseAnthropicUsage(chunks);
            case 'openai':
                return parseOpenAIUsage(chunks);
            case 'gemini':
                return parseGeminiUsage(chunks);
            default: {
                // Unknown provider: try each parser in turn
                const anthropic = parseAnthropicUsage(chunks);
                if (anthropic) return anthropic;

                const openai = parseOpenAIUsage(chunks);
                if (openai) return openai;

                const gemini = parseGeminiUsage(chunks);
                if (gemini) return gemini;

                return null;
            }
        }
    } catch {
        return null;
    }
}
