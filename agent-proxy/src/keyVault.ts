import crypto from 'crypto';
import os from 'os';

/**
 * Key Vault — reads LLM provider API keys from local environment variables.
 *
 * In local-first mode, agents never send API keys through the proxy.
 * Instead, the proxy reads keys from the user's env vars and injects
 * them into outgoing requests to providers.
 *
 * SECURITY: Key values are NEVER logged, included in error messages,
 * or exposed through any API endpoint.
 */

export type Provider = 'anthropic' | 'openai' | 'gemini' | 'nvidia';

interface ProviderConfig {
    name: string;
    envVarNames: string[];       // Fallback chain: try each in order
    headerName: string;          // Header to set on outgoing request
    headerPrefix: string;        // e.g. 'Bearer ' for Authorization header
}

const PROVIDER_CONFIGS: Record<Provider, ProviderConfig> = {
    anthropic: {
        name: 'Anthropic',
        envVarNames: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY'],
        headerName: 'x-api-key',
        headerPrefix: '',
    },
    openai: {
        name: 'OpenAI',
        envVarNames: ['OPENAI_API_KEY', 'OPENAI_KEY'],
        headerName: 'authorization',
        headerPrefix: 'Bearer ',
    },
    gemini: {
        name: 'Gemini',
        envVarNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        headerName: 'x-goog-api-key',
        headerPrefix: '',
    },
    nvidia: {
        name: 'NVIDIA',
        envVarNames: ['NVIDIA_API_KEY', 'NVIDIA_KEY'],
        headerName: 'authorization',
        headerPrefix: 'Bearer ',
    },
};

// In-memory cache so we only read env vars once
const keyCache = new Map<Provider, string>();

/**
 * Get the API key for a provider from local env vars.
 * Returns the key string on success, or an error object on failure.
 */
export function getProviderKey(provider: Provider): { key: string } | { error: string } {
    // Check cache first
    if (keyCache.has(provider)) {
        return { key: keyCache.get(provider)! };
    }

    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
        return { error: `Unknown provider: ${provider}` };
    }

    // Try each env var in the fallback chain
    for (const envVar of config.envVarNames) {
        const value = process.env[envVar];
        if (value && value.trim().length > 0) {
            const trimmed = value.trim();
            keyCache.set(provider, trimmed);
            return { key: trimmed };
        }
    }

    return {
        error: `No API key configured for ${config.name}. Set one of: ${config.envVarNames.join(', ')}. Run: npx agentic-firewall setup`,
    };
}

/**
 * Get the header config for injecting the key into outgoing requests.
 */
export function getProviderHeaderConfig(provider: Provider): { headerName: string; headerPrefix: string } {
    const config = PROVIDER_CONFIGS[provider];
    return { headerName: config.headerName, headerPrefix: config.headerPrefix };
}

/**
 * Validate which providers have keys configured.
 * Used at startup to log readiness status.
 */
export function validateAllKeys(): { valid: string[]; missing: string[] } {
    const valid: string[] = [];
    const missing: string[] = [];

    for (const [provider, config] of Object.entries(PROVIDER_CONFIGS)) {
        const result = getProviderKey(provider as Provider);
        if ('key' in result) {
            valid.push(config.name);
        } else {
            missing.push(config.name);
        }
    }

    return { valid, missing };
}

/**
 * Generate a stable local machine user ID.
 * Replaces the old approach of hashing the client's API key.
 * Uses hostname + username so it's consistent across sessions.
 */
export function getLocalUserId(): string {
    const machineId = `${os.hostname()}-${os.userInfo().username}`;
    return crypto.createHash('sha256').update(machineId).digest('hex').slice(0, 12);
}

/**
 * Clear the key cache (useful for testing).
 */
export function clearKeyCache(): void {
    keyCache.clear();
}
