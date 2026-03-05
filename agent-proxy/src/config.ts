/**
 * Centralized configuration constants for the Agentic Firewall.
 * Tunable thresholds that were previously scattered across modules.
 */

// ─── Circuit Breaker ────────────────────────────────────
export const CB_TTL_MS = 5 * 60 * 1000;          // Entries expire after 5 minutes
export const CB_WINDOW_SIZE = 5;                   // Sliding window of recent hashes
export const CB_THRESHOLD = 4;                     // Identical requests before blocking

// ─── No-Progress Detection ──────────────────────────────
export const NP_FAILURE_STATE_TTL_MS = 10 * 60 * 1000;  // Expire stale failure states after 10 min
export const NP_MAX_FAILURE_ENTRIES = 500;               // Hard cap on tracked identifiers
export const NP_WARN_AT = 3;                             // Warn after N consecutive same errors
export const NP_BLOCK_AT = 5;                            // Block after N consecutive same errors

// ─── Prompt Compressor ──────────────────────────────────
export const COMP_SYSTEM_PROMPT_THRESHOLD = 10_000;  // Compress system prompts > 10k chars
export const COMP_HISTORY_THRESHOLD = 50;            // Compress histories > 50 messages
export const COMP_MIN_CONTENT_LENGTH = 400;          // Skip compression for short content
export const COMP_CACHE_TTL_MS = 60 * 60 * 1000;    // Compression cache TTL (1 hour)
export const COMP_MAX_OLLAMA_INPUT = 8_000;          // Truncate input to Ollama at 8k chars

// ─── Context Trimmer ────────────────────────────────────
export const TRIM_CONTEXT_MARGIN = 0.90;             // Trim to 90% of context window

// ─── Request Queue ──────────────────────────────────────
export const QUEUE_TIMEOUT_MS = 30_000;              // Queue wait timeout

// ─── Rate Limiting (Public Endpoints) ───────────────────
export const RATE_LIMIT_WINDOW_MS = 60_000;          // 1 minute window
export const RATE_LIMIT_MAX = 60;                    // Max requests per window per IP

// ─── Ollama Client ──────────────────────────────────────
export const OLLAMA_HEALTH_CACHE_TTL_MS = 30_000;    // Health check cache duration
export const OLLAMA_CLASSIFY_TIMEOUT_MS = 2_000;     // Timeout for classification calls
export const OLLAMA_SUMMARIZE_TIMEOUT_MS = 5_000;    // Timeout for summarization calls
export const OLLAMA_HEALTH_TIMEOUT_MS = 500;         // Timeout for health check
export const OLLAMA_MAX_RETRIES = 1;                 // Retry count for generate calls

// ─── Stats Persistence ──────────────────────────────────
export const STATS_FLUSH_INTERVAL_MS = 30_000;       // Flush stats to disk every 30s
export const ACTIVITY_BUFFER_SIZE = 50;              // Circular buffer for recent activity

// ─── Context CDN ────────────────────────────────────────
export const CDN_MIN_CHARS_ANTHROPIC = 4_096;        // Min chars for Anthropic cache injection (~1024 tokens)
export const CDN_MIN_TOKENS_OPENAI = 1_024;          // Min tokens for OpenAI prefix caching
