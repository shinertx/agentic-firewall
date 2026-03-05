/**
 * Smart Router — proactive model downgrade based on request complexity.
 *
 * Two-tier classification:
 *   Tier 1: Fast heuristics (0ms) — catches obvious LOW/HIGH cases
 *   Tier 2: Ollama classification (~200-500ms) — resolves ambiguous MEDIUM cases
 *
 * If Ollama is unavailable, MEDIUM is treated as HIGH (conservative, no downgrade).
 *
 * The router checks which provider API keys are available and only downgrades
 * to models on providers that are configured. It never routes to a provider
 * without a valid API key.
 */

import { isOllamaAvailable, ollamaClassify } from './ollamaClient';
import { getProviderKey, Provider } from './keyVault';
import { globalStats } from './stats';

export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SmartRouteResult {
    routed: boolean;
    originalModel: string;
    newModel: string;
    complexity: Complexity;
    reason?: string;
}

interface DowngradeRule {
    pattern: string;
    downgrade: string;
    provider: Provider;
    maxComplexity: Complexity;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │                     SMART ROUTER DOWNGRADE MAP                       │
// │                                                                      │
// │ Rules are evaluated in order. For each complexity level:              │
// │   LOW    → drop to cheapest model on same provider                   │
// │   MEDIUM → drop one tier on same provider                            │
// │                                                                      │
// │ The `provider` field ensures we only downgrade to models whose       │
// │ API key is configured. Rules for providers without keys are skipped. │
// └──────────────────────────────────────────────────────────────────────┘
const DOWNGRADE_MAP: DowngradeRule[] = [
    // === LOW complexity: use cheapest model on same provider ===

    // Anthropic
    { pattern: 'opus',   downgrade: 'claude-haiku-4-5',  provider: 'anthropic', maxComplexity: 'LOW' },
    { pattern: 'sonnet', downgrade: 'claude-haiku-4-5',  provider: 'anthropic', maxComplexity: 'LOW' },

    // OpenAI — reasoning models
    { pattern: 'o3',     downgrade: 'o4-mini',           provider: 'openai', maxComplexity: 'LOW' },
    { pattern: 'o1',     downgrade: 'o4-mini',           provider: 'openai', maxComplexity: 'LOW' },

    // OpenAI — GPT-5 series (specific first)
    { pattern: 'gpt-5.2-pro', downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },
    { pattern: 'gpt-5.2',     downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },
    { pattern: 'gpt-5',       downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },

    // OpenAI — GPT-4 series (specific first)
    { pattern: 'gpt-4.1',     downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },
    { pattern: 'gpt-4o',      downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },
    { pattern: 'gpt-4',       downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'LOW' },

    // Gemini
    { pattern: 'gemini-2.5-pro',  downgrade: 'gemini-2.5-flash', provider: 'gemini', maxComplexity: 'LOW' },
    { pattern: 'gemini-2.0-pro',  downgrade: 'gemini-2.0-flash', provider: 'gemini', maxComplexity: 'LOW' },
    { pattern: 'gemini-1.5-pro',  downgrade: 'gemini-1.5-flash', provider: 'gemini', maxComplexity: 'LOW' },

    // === MEDIUM complexity: drop one tier ===

    // Anthropic
    { pattern: 'opus',   downgrade: 'claude-sonnet-4-6', provider: 'anthropic', maxComplexity: 'MEDIUM' },

    // OpenAI — GPT-5 series
    { pattern: 'gpt-5.2-pro', downgrade: 'gpt-5.2',     provider: 'openai', maxComplexity: 'MEDIUM' },
    { pattern: 'gpt-5.2',     downgrade: 'gpt-4.1',     provider: 'openai', maxComplexity: 'MEDIUM' },
    { pattern: 'gpt-5',       downgrade: 'gpt-4.1',     provider: 'openai', maxComplexity: 'MEDIUM' },

    // OpenAI — GPT-4 series
    { pattern: 'gpt-4.1',     downgrade: 'gpt-4o',      provider: 'openai', maxComplexity: 'MEDIUM' },
    { pattern: 'gpt-4o',      downgrade: 'gpt-4o-mini',  provider: 'openai', maxComplexity: 'MEDIUM' },

    // Gemini
    { pattern: 'gemini-2.5-pro',  downgrade: 'gemini-2.5-flash', provider: 'gemini', maxComplexity: 'MEDIUM' },
];

// Models that are already the cheapest tier — never downgrade these.
// Use '-mini' not 'mini' because 'gemini' contains 'mini'.
const CHEAP_MODELS = ['haiku', '-mini', '-nano', 'flash', 'gpt-3.5'];

const COMPLEXITY_RANK: Record<Complexity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

// Cache which providers have valid keys (checked once at first use)
let providerKeyCache: Map<Provider, boolean> | null = null;

function getAvailableProviders(): Map<Provider, boolean> {
    if (providerKeyCache) return providerKeyCache;
    providerKeyCache = new Map();
    const providers: Provider[] = ['anthropic', 'openai', 'gemini', 'nvidia'];
    for (const p of providers) {
        const result = getProviderKey(p);
        providerKeyCache.set(p, 'key' in result);
    }
    return providerKeyCache;
}

/** Reset provider key cache (for testing). */
export function resetProviderKeyCache(): void {
    providerKeyCache = null;
}

/**
 * Extract the last user message text from a request body.
 * Handles Anthropic, OpenAI, and Gemini formats.
 */
function getLastUserMessage(body: any, isGemini: boolean): string {
    if (isGemini && body.contents && Array.isArray(body.contents)) {
        for (let i = body.contents.length - 1; i >= 0; i--) {
            const c = body.contents[i];
            if (c.role === 'user' && c.parts) {
                return c.parts.map((p: any) => p.text || '').join(' ');
            }
        }
        return '';
    }

    const messages = body.messages;
    if (!messages || !Array.isArray(messages)) return '';

    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'user') {
            if (typeof m.content === 'string') return m.content;
            if (Array.isArray(m.content)) {
                return m.content
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text || '')
                    .join(' ');
            }
        }
    }
    return '';
}

/**
 * Count conversation messages (excluding system).
 */
function getMessageCount(body: any, isGemini: boolean): number {
    if (isGemini) return body.contents?.length || 0;
    if (!body.messages) return 0;
    return body.messages.filter((m: any) => m.role !== 'system').length;
}

/**
 * Check if recent messages contain tool usage.
 */
function hasRecentToolUse(body: any, isGemini: boolean): boolean {
    const messages = isGemini ? body.contents : body.messages;
    if (!messages || !Array.isArray(messages)) return false;

    // Check last 5 messages for tool usage
    const recent = messages.slice(-5);
    for (const m of recent) {
        // Anthropic: tool_use in content blocks
        if (Array.isArray(m.content)) {
            if (m.content.some((b: any) => b.type === 'tool_use' || b.type === 'tool_result')) return true;
        }
        // OpenAI: tool_calls on assistant, role=tool for results
        if (m.tool_calls) return true;
        if (m.role === 'tool') return true;
        // Gemini: functionCall / functionResponse in parts
        if (m.parts && Array.isArray(m.parts)) {
            if (m.parts.some((p: any) => p.functionCall || p.functionResponse)) return true;
        }
    }
    return false;
}

/**
 * Tier 1: Fast heuristic classification.
 * Returns a definitive LOW/HIGH or null for MEDIUM (ambiguous).
 */
export function classifyHeuristic(body: any, isGemini: boolean): { complexity: Complexity | null; reason: string } {
    const msgCount = getMessageCount(body, isGemini);
    const lastMsg = getLastUserMessage(body, isGemini);
    const hasTools = hasRecentToolUse(body, isGemini);

    // HIGH: lots of context or active tool use
    if (hasTools) {
        return { complexity: 'HIGH', reason: 'Active tool use in recent messages' };
    }
    if (msgCount > 20) {
        return { complexity: 'HIGH', reason: `Large conversation (${msgCount} messages)` };
    }

    // LOW: short conversation with simple last message
    if (msgCount <= 3 && lastMsg.length < 200 && !lastMsg.includes('```')) {
        return { complexity: 'LOW', reason: 'Short conversation, simple message' };
    }

    // LOW: very short last message with no code
    if (lastMsg.length < 100 && !lastMsg.includes('```') && msgCount <= 6) {
        return { complexity: 'LOW', reason: 'Brief message, no code' };
    }

    // MEDIUM: ambiguous — let Tier 2 decide
    return { complexity: null, reason: 'Ambiguous complexity' };
}

/**
 * Tier 2: Ollama-based classification for ambiguous cases.
 */
async function classifyWithOllama(lastMessage: string): Promise<Complexity> {
    const prompt = `Classify this user request's complexity as exactly one word: LOW, MEDIUM, or HIGH.

LOW = simple question, greeting, short clarification, basic lookup
MEDIUM = moderate coding task, explanation, analysis of a specific topic
HIGH = complex multi-step task, architecture design, debugging, large refactor

User request: "${lastMessage.slice(0, 500)}"

Classification:`;

    globalStats.ollamaCalls++;
    const result = await ollamaClassify(prompt);
    const upper = result.toUpperCase().trim();

    if (upper.includes('LOW')) return 'LOW';
    if (upper.includes('MEDIUM')) return 'MEDIUM';
    // Default to HIGH (conservative) if unclear
    return 'HIGH';
}

/**
 * Find the best downgrade rule for a model + complexity combination.
 * Only returns rules for providers that have valid API keys configured.
 */
function findDowngrade(model: string, complexity: Complexity): DowngradeRule | null {
    const lower = model.toLowerCase();
    const available = getAvailableProviders();

    // Never downgrade already-cheap models
    if (CHEAP_MODELS.some(c => lower.includes(c))) return null;

    // Find the best matching rule where complexity <= maxComplexity
    // AND the target provider has a valid API key
    for (const rule of DOWNGRADE_MAP) {
        if (lower.includes(rule.pattern)
            && COMPLEXITY_RANK[complexity] <= COMPLEXITY_RANK[rule.maxComplexity]
            && available.get(rule.provider) === true) {
            // Don't downgrade to the same model
            if (lower !== rule.downgrade.toLowerCase()) {
                return rule;
            }
        }
    }
    return null;
}

/**
 * Main entry point: classify request complexity and optionally downgrade the model.
 */
export async function smartRoute(body: any, isGemini: boolean, isOpenAI: boolean): Promise<SmartRouteResult> {
    const model = body?.model || '';
    const noResult: SmartRouteResult = {
        routed: false,
        originalModel: model,
        newModel: model,
        complexity: 'HIGH',
    };

    if (!model || !body) return noResult;

    // Tier 1: fast heuristics
    const heuristic = classifyHeuristic(body, isGemini);
    let complexity: Complexity;

    if (heuristic.complexity !== null) {
        complexity = heuristic.complexity;
    } else {
        // Tier 2: Ollama classification for ambiguous cases
        const available = await isOllamaAvailable();
        if (available) {
            const lastMsg = getLastUserMessage(body, isGemini);
            complexity = await classifyWithOllama(lastMsg);
        } else {
            // Conservative: treat ambiguous as HIGH (no downgrade)
            complexity = 'HIGH';
        }
    }

    // Find applicable downgrade rule
    const rule = findDowngrade(model, complexity);
    if (!rule) {
        return { routed: false, originalModel: model, newModel: model, complexity, reason: heuristic.reason };
    }

    return {
        routed: true,
        originalModel: model,
        newModel: rule.downgrade,
        complexity,
        reason: heuristic.reason,
    };
}
