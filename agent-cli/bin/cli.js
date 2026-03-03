#!/usr/bin/env node

/**
 * agent-firewall CLI v0.5.0
 * Agent Runtime Control — keep autonomous AI agents under control.
 *
 * Usage:
 *   npx agent-firewall setup     — auto-detect agents, patch configs, verify connection
 *   npx agent-firewall scan      — scan agent logs for waste (with real $ numbers)
 *   npx agent-firewall status    — check proxy stats (requests, savings, blocked loops)
 *   npx agent-firewall verify    — test that traffic is routing through the firewall
 *   npx agent-firewall uninstall — remove proxy routing from shell config + agent configs
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const VERSION = '0.6.0';
const PROXY_URL = 'http://localhost:4000';
const PROXY_API = `${PROXY_URL}/api/stats`;
const HTTP_TIMEOUT_MS = 10_000;

// Provider env var names (matches keyVault.ts fallback chains)
const PROVIDER_ENV_VARS = {
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY'],
    openai: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    nvidia: ['NVIDIA_API_KEY', 'NVIDIA_KEY'],
};

// ─── Platform Detection ─────────────────────────────────
const IS_WIN = process.platform === 'win32';
const IS_TTY = process.stdout.isTTY === true;

// ─── Colors (TTY-aware, Windows-safe) ───────────────────
const c = IS_TTY ? {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    white: '\x1b[37m',
    black: '\x1b[30m',
} : Object.fromEntries(
    ['reset', 'bold', 'dim', 'green', 'yellow', 'red', 'cyan', 'magenta', 'bgRed', 'bgGreen', 'white', 'black']
        .map(k => [k, ''])
);

// Emoji fallback for Windows cmd.exe
const icons = IS_WIN && !process.env.WT_SESSION ? {
    ok: '[OK]', fail: '[FAIL]', warn: '[WARN]', info: '[i]', shield: '[#]',
} : {
    ok: '✅', fail: '❌', warn: '⚠️', info: 'ℹ', shield: '🛡️',
};

function log(msg) { console.log(msg); }
function ok(msg) { log(`${c.green}${icons.ok}${c.reset} ${msg}`); }
function warn(msg) { log(`${c.yellow}${icons.warn}${c.reset}  ${msg}`); }
function fail(msg) { log(`${c.red}${icons.fail}${c.reset} ${msg}`); }
function info(msg) { log(`${c.cyan}${icons.info}${c.reset}  ${msg}`); }
function header(msg) { log(`\n${c.bold}${c.magenta}${icons.shield}  ${msg}${c.reset}\n`); }

// ─── Confirmation Prompt ────────────────────────────────
function confirm(question) {
    return new Promise((resolve) => {
        if (!IS_TTY) { resolve(true); return; } // auto-yes in non-interactive
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${c.cyan}?${c.reset} ${question} ${c.dim}[Y/n]${c.reset} `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() !== 'n');
        });
    });
}

// ─── Spinner ────────────────────────────────────────────
function spinner(msg) {
    if (!IS_TTY) { log(`  ${msg}...`); return { stop() { } }; }
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const id = setInterval(() => {
        process.stdout.write(`\r  ${c.cyan}${frames[i++ % frames.length]}${c.reset} ${msg}`);
    }, 80);
    return {
        stop(result) {
            clearInterval(id);
            process.stdout.write(`\r  ${result || msg}${' '.repeat(20)}\n`);
        }
    };
}

// ─── Pricing (per million tokens) ───────────────────────
const PRICING = {
    'claude-sonnet-4': { input: 3.00, output: 15.00, cached: 0.30 },
    'claude-3-5-sonnet': { input: 3.00, output: 15.00, cached: 0.30 },
    'claude-3-5-haiku': { input: 0.80, output: 4.00, cached: 0.08 },
    'claude-haiku-4-5': { input: 0.80, output: 4.00, cached: 0.08 },
    'claude-3-opus': { input: 15.00, output: 75.00, cached: 1.50 },
    'gpt-4o': { input: 2.50, output: 10.00, cached: 1.25 },
    'gpt-4o-mini': { input: 0.15, output: 0.60, cached: 0.075 },
    'gpt-5': { input: 5.00, output: 15.00, cached: 2.50 },
    'gpt-5.2': { input: 5.00, output: 15.00, cached: 2.50 },
    'gpt-5.3': { input: 5.00, output: 15.00, cached: 2.50 },
    'o1': { input: 15.00, output: 60.00, cached: 7.50 },
    'o3': { input: 10.00, output: 40.00, cached: 5.00 },
};

function getModelPricing(model) {
    if (!model) return PRICING['gpt-4o'];
    for (const [key, price] of Object.entries(PRICING)) {
        if (model.includes(key)) return price;
    }
    return { input: 3.00, output: 15.00, cached: 0.30 };
}

function tokenCost(tokens, pricePerMillion) {
    return (tokens / 1_000_000) * pricePerMillion;
}

// ─── HTTP Helper (with timeout, supports http:// and https://) ──
const http = require('http');
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });
        req.on('error', reject);
        req.setTimeout(HTTP_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error(`Request timed out after ${HTTP_TIMEOUT_MS / 1000}s`));
        });
    });
}

// ─── Shell Config Detection (cross-platform) ────────────
function findShellConfig() {
    const home = os.homedir();

    if (IS_WIN) {
        // PowerShell profile
        const psProfile = process.env.USERPROFILE
            ? path.join(process.env.USERPROFILE, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1')
            : null;
        if (psProfile && fs.existsSync(psProfile)) return { path: psProfile, type: 'powershell' };
        // Windows PowerShell (older)
        const wpsProfile = process.env.USERPROFILE
            ? path.join(process.env.USERPROFILE, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1')
            : null;
        if (wpsProfile && fs.existsSync(wpsProfile)) return { path: wpsProfile, type: 'powershell' };
        // Create one if neither exists
        if (psProfile) return { path: psProfile, type: 'powershell', create: true };
        return null;
    }

    // Unix: prefer .zshrc, then .bashrc, then .bash_profile
    const candidates = ['.zshrc', '.bashrc', '.bash_profile'];
    for (const name of candidates) {
        const p = path.join(home, name);
        if (fs.existsSync(p)) return { path: p, type: 'posix' };
    }
    // Default to .zshrc on macOS, .bashrc on Linux
    const defaultName = process.platform === 'darwin' ? '.zshrc' : '.bashrc';
    return { path: path.join(home, defaultName), type: 'posix', create: true };
}

const MARKER = '# agent-firewall proxy routing';
const MARKER_END = '# /agent-firewall';

function getShellBlock(type) {
    // LOCAL-FIRST: Source API keys from ~/.firewall/.env and route agents through localhost
    if (type === 'powershell') {
        return [
            MARKER,
            '# Agentic Firewall: local-first proxy (API keys never leave this machine)',
            `$firewallEnv = Join-Path $env:USERPROFILE ".firewall\\.env"`,
            `if (Test-Path $firewallEnv) { Get-Content $firewallEnv | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process") } } }`,
            `$env:OPENAI_BASE_URL = "${PROXY_URL}/v1"`,
            `$env:ANTHROPIC_BASE_URL = "${PROXY_URL}"`,
            MARKER_END,
        ].join('\n');
    }
    return [
        MARKER,
        '# Agentic Firewall: local-first proxy (API keys never leave this machine)',
        '[ -f ~/.firewall/.env ] && set -a && source ~/.firewall/.env && set +a',
        `export OPENAI_BASE_URL="${PROXY_URL}/v1"`,
        `export ANTHROPIC_BASE_URL="${PROXY_URL}"`,
        MARKER_END,
    ].join('\n');
}

// ─── Agent Detection ────────────────────────────────────
// Detects installed agents for display purposes.
// OpenClaw routing is done via env vars (ANTHROPIC_BASE_URL / OPENAI_BASE_URL),
// NOT by patching openclaw.json — see docs.openclaw.ai/gateway/configuration-reference
function detectAgents() {
    const agents = [];
    const home = os.homedir();

    const openclawDir = path.join(home, '.openclaw');
    if (fs.existsSync(openclawDir)) {
        agents.push({ name: 'OpenClaw', configPath: openclawDir, type: 'openclaw' });
    }

    const claudeConfig = path.join(home, '.claude', 'settings.json');
    if (fs.existsSync(claudeConfig) || fs.existsSync(path.join(home, '.claude', 'projects'))) {
        agents.push({ name: 'Claude Code', configPath: claudeConfig, type: 'claude-code' });
    }

    // Check for Ollama (local LLM runtime)
    try {
        const { execSync } = require('child_process');
        const ollamaVersion = execSync('ollama --version', { encoding: 'utf-8', timeout: 3000 }).trim();
        agents.push({ name: `Ollama (${ollamaVersion})`, configPath: path.join(home, '.ollama'), type: 'ollama' });
    } catch {
        // Ollama not installed — skip silently
    }

    return { agents };
}

// ─── Ollama Helpers ─────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Check if Ollama API is responding on localhost:11434 */
function isOllamaRunning() {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:11434/api/tags', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

/** Check if a specific model is already pulled in Ollama */
function ollamaHasModel(modelName) {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:11434/api/tags', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const models = (parsed.models || []).map(m => m.name || '');
                    // Match "qwen2.5:3b" against "qwen2.5:3b" or "qwen2.5:3b-..." variants
                    resolve(models.some(m => m === modelName || m.startsWith(modelName)));
                } catch { resolve(false); }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    });
}

// ─── Log Discovery ──────────────────────────────────────
function findAllLogs() {
    const home = os.homedir();
    const logs = { claudeCode: [], openClaw: [] };

    // Claude Code: ~/.claude/projects/*/sessions/*.jsonl
    const claudeProjects = path.join(home, '.claude', 'projects');
    if (fs.existsSync(claudeProjects)) {
        const walkDir = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) walkDir(full);
                    else if (e.name.endsWith('.jsonl')) logs.claudeCode.push(full);
                }
            } catch { /* permission denied */ }
        };
        walkDir(claudeProjects);
    }

    // OpenClaw: ~/.openclaw/agents/<agentId>/sessions/*.jsonl (all agents, not just main)
    const openclawAgents = path.join(home, '.openclaw', 'agents');
    if (fs.existsSync(openclawAgents)) {
        try {
            const agentDirs = fs.readdirSync(openclawAgents, { withFileTypes: true })
                .filter(e => e.isDirectory());
            for (const agentDir of agentDirs) {
                const sessionsDir = path.join(openclawAgents, agentDir.name, 'sessions');
                if (fs.existsSync(sessionsDir)) {
                    try {
                        fs.readdirSync(sessionsDir)
                            .filter(f => f.endsWith('.jsonl'))
                            .forEach(f => logs.openClaw.push(path.join(sessionsDir, f)));
                    } catch { /* skip */ }
                }
            }
        } catch { /* skip */ }
    }

    return logs;
}

// ─── Claude Code Transcript Analyzer ────────────────────
function analyzeClaudeTranscript(filepath) {
    const result = {
        totalInputTokens: 0, totalOutputTokens: 0,
        cacheCreationTokens: 0, cacheReadTokens: 0,
        toolErrors: 0, retryLoops: 0, requests: 0,
        models: {}, wastedTokens: 0, sessions: 0,
    };

    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        let lastToolError = '';
        let consecutiveErrors = 0;
        const seenRequestIds = new Set();

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                if (entry.message?.usage && entry.requestId) {
                    if (!seenRequestIds.has(entry.requestId)) {
                        seenRequestIds.add(entry.requestId);
                        const u = entry.message.usage;
                        result.totalInputTokens += (u.input_tokens || 0);
                        result.totalOutputTokens += (u.output_tokens || 0);
                        result.cacheCreationTokens += (u.cache_creation_input_tokens || 0);
                        result.cacheReadTokens += (u.cache_read_input_tokens || 0);
                        result.requests++;
                        const model = entry.message.model || 'unknown';
                        result.models[model] = (result.models[model] || 0) + 1;
                    }
                }

                if (entry.type === 'user' && entry.message?.content) {
                    const msgContent = entry.message.content;
                    if (Array.isArray(msgContent)) {
                        for (const block of msgContent) {
                            if (block.is_error) {
                                result.toolErrors++;
                                const errorSig = (block.content || '').slice(0, 100);
                                if (errorSig === lastToolError) {
                                    consecutiveErrors++;
                                    if (consecutiveErrors >= 3) result.retryLoops++;
                                } else {
                                    consecutiveErrors = 1;
                                    lastToolError = errorSig;
                                }
                            }
                        }
                    }
                }

                if (entry.type === 'user' && entry.parentUuid === null) {
                    result.sessions++;
                }
            } catch { /* skip non-JSON lines */ }
        }

        if (result.cacheCreationTokens > 0 && result.requests > 1) {
            const expectedCacheReads = result.cacheCreationTokens;
            const missedCacheTokens = Math.max(0, expectedCacheReads - result.cacheReadTokens);
            result.wastedTokens = Math.min(missedCacheTokens, result.totalInputTokens);
        }
    } catch { /* file read error */ }

    return result;
}

// ─── OpenClaw Session Analyzer ──────────────────────────
function analyzeOpenClawSession(filepath) {
    const result = { messages: 0, provider: 'unknown', modelId: 'unknown', toolCalls: 0, toolErrors: 0 };

    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'message') result.messages++;
                if (entry.type === 'model_change') {
                    result.provider = entry.provider || 'unknown';
                    result.modelId = entry.modelId || 'unknown';
                }
                if (entry.customType === 'model-snapshot') {
                    result.provider = entry.data?.provider || result.provider;
                    result.modelId = entry.data?.modelId || result.modelId;
                }
            } catch { /* skip */ }
        }
    } catch { /* file read error */ }

    return result;
}

// ─── Scan Command ───────────────────────────────────────
async function scan() {
    header('Agent Waste Scanner');
    log(`${c.dim}Analyzing your agent usage for waste patterns and savings opportunities...${c.reset}\n`);

    const logs = findAllLogs();
    const totalFiles = logs.claudeCode.length + logs.openClaw.length;

    if (totalFiles === 0) {
        warn('No agent transcript files found.');
        info('Looking for logs in:');
        log(`  ${c.dim}~/.claude/projects/**/**.jsonl${c.reset}`);
        log(`  ${c.dim}~/.openclaw/agents/main/sessions/*.jsonl${c.reset}`);
        log('');

        try {
            const s = spinner('Checking proxy for data');
            const stats = await httpGet(PROXY_API);
            s.stop(`${c.green}${icons.ok}${c.reset} Proxy connected`);
            if (stats && stats.totalRequests > 0) {
                log('');
                showProxyWaste(stats);
            } else {
                info('Route some traffic through the firewall first: npx agent-firewall setup\n');
            }
        } catch {
            info('Run `npx agent-firewall setup` to get started.\n');
        }
        return;
    }

    let grandTotalInput = 0, grandTotalOutput = 0;
    let grandCacheCreation = 0, grandCacheRead = 0;
    let grandToolErrors = 0, grandRetryLoops = 0;
    let grandRequests = 0, grandWastedTokens = 0;
    const grandModels = {};

    if (logs.claudeCode.length > 0) {
        info(`Found ${c.bold}${logs.claudeCode.length}${c.reset} Claude Code transcript(s)\n`);
        for (const file of logs.claudeCode) {
            const r = analyzeClaudeTranscript(file);
            if (r.requests === 0) continue;
            grandTotalInput += r.totalInputTokens;
            grandTotalOutput += r.totalOutputTokens;
            grandCacheCreation += r.cacheCreationTokens;
            grandCacheRead += r.cacheReadTokens;
            grandToolErrors += r.toolErrors;
            grandRetryLoops += r.retryLoops;
            grandRequests += r.requests;
            grandWastedTokens += r.wastedTokens;
            for (const [model, count] of Object.entries(r.models)) {
                grandModels[model] = (grandModels[model] || 0) + count;
            }
        }
    }

    if (logs.openClaw.length > 0) {
        info(`Found ${c.bold}${logs.openClaw.length}${c.reset} OpenClaw session(s)\n`);
        for (const file of logs.openClaw) {
            const r = analyzeOpenClawSession(file);
            if (r.messages > 0) {
                log(`  ${c.bold}${path.basename(file)}${c.reset}: ${r.messages} messages via ${c.cyan}${r.provider}/${r.modelId}${c.reset}`);
            }
        }
        log('');
    }

    // Cost calculations
    let totalInputCost = 0, totalOutputCost = 0;
    let totalCacheSavings = 0, potentialCacheSavings = 0;

    for (const [model, count] of Object.entries(grandModels)) {
        const pricing = getModelPricing(model);
        const pct = count / Math.max(grandRequests, 1);
        const modelInputTokens = grandTotalInput * pct;
        const modelOutputTokens = grandTotalOutput * pct;
        const modelCacheRead = grandCacheRead * pct;

        totalInputCost += tokenCost(modelInputTokens, pricing.input);
        totalOutputCost += tokenCost(modelOutputTokens, pricing.output);

        const savedPerToken = pricing.input - pricing.cached;
        totalCacheSavings += tokenCost(modelCacheRead, savedPerToken);

        const modelWasted = grandWastedTokens * pct;
        potentialCacheSavings += tokenCost(modelWasted, savedPerToken);
    }

    const totalSpend = totalInputCost + totalOutputCost;

    // Results
    log(`${c.bold}  ─── Your Agent Usage Report ───${c.reset}\n`);
    log(`  ${c.bold}API Calls:${c.reset}           ${grandRequests.toLocaleString()}`);
    log(`  ${c.bold}Input Tokens:${c.reset}        ${grandTotalInput.toLocaleString()}`);
    log(`  ${c.bold}Output Tokens:${c.reset}       ${grandTotalOutput.toLocaleString()}`);
    log(`  ${c.bold}Cache Created:${c.reset}       ${grandCacheCreation.toLocaleString()} tokens`);
    log(`  ${c.bold}Cache Read:${c.reset}          ${grandCacheRead.toLocaleString()} tokens`);
    log('');
    log(`  ${c.bold}Estimated Spend:${c.reset}     ${c.yellow}$${totalSpend.toFixed(2)}${c.reset}`);
    if (totalCacheSavings > 0) {
        log(`  ${c.bold}Already Saved:${c.reset}       ${c.green}$${totalCacheSavings.toFixed(2)}${c.reset} ${c.dim}(from cache hits)${c.reset}`);
    }

    if (potentialCacheSavings > 0.01) {
        log('');
        log(`  ${c.bgRed}${c.white}${c.bold} 🚨 MISSED SAVINGS: $${potentialCacheSavings.toFixed(2)} ${c.reset}`);
        log(`  ${c.dim}${grandWastedTokens.toLocaleString()} tokens were re-sent instead of cached.${c.reset}`);
        log(`  ${c.dim}The Agent Firewall would have cached these automatically.${c.reset}`);
    }

    if (grandToolErrors > 0) {
        log('');
        log(`  ${c.red}${c.bold}Tool Errors:${c.reset}         ${c.red}${grandToolErrors}${c.reset}`);
        if (grandRetryLoops > 0) {
            log(`  ${c.red}${c.bold}Retry Loops:${c.reset}         ${c.red}${grandRetryLoops}${c.reset} ${c.dim}(3+ consecutive identical errors)${c.reset}`);
            const loopWaste = tokenCost(grandRetryLoops * 50000, 3.00);
            log(`  ${c.red}${c.bold}Loop Waste:${c.reset}          ${c.red}~$${loopWaste.toFixed(2)}${c.reset} ${c.dim}(estimated)${c.reset}`);
        }
    }

    if (Object.keys(grandModels).length > 0) {
        log(`\n  ${c.bold}Models Used:${c.reset}`);
        for (const [model, count] of Object.entries(grandModels).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
            log(`    ${model.padEnd(32)} ${c.dim}${count} calls${c.reset}`);
        }
    }

    log('');
    if (potentialCacheSavings > 0.01 || grandToolErrors > 0) {
        log(`  ${c.bgGreen}${c.black}${c.bold} Fix this now → npx agent-firewall setup ${c.reset}`);
        log(`  ${c.dim}Routes your agent through a governance proxy that caches${c.reset}`);
        log(`  ${c.dim}repeated prompts and kills stuck loops automatically.${c.reset}`);
    } else {
        ok('Your agents are running efficiently.');
        log(`  ${c.dim}Run ${c.bold}npx agent-firewall setup${c.reset}${c.dim} to add caching and loop detection.${c.reset}`);
    }
    log('');
}

function showProxyWaste(stats) {
    log(`  ${c.bold}Proxy Data:${c.reset}`);
    log(`  Requests proxied:  ${c.bold}${stats.totalRequests}${c.reset}`);
    log(`  Money saved:       ${c.green}$${stats.savedMoney?.toFixed(4) || '0.0000'}${c.reset}`);
    log(`  Tokens cached:     ${c.green}${(stats.savedTokens || 0).toLocaleString()}${c.reset}`);
    log(`  Loops blocked:     ${c.red}${stats.blockedLoops || 0}${c.reset}`);
    log('');
    if (stats.blockedLoops > 0) {
        const loopWaste = (stats.blockedLoops * 50000 / 1_000_000) * 3.00;
        log(`  ${c.bgRed}${c.white}${c.bold} 🚨 ${stats.blockedLoops} loops killed — saved ~$${loopWaste.toFixed(2)} ${c.reset}`);
        log('');
    }
}

// ─── Key Detection ──────────────────────────────────────
function detectExistingKeys() {
    const found = {};
    for (const [provider, envVars] of Object.entries(PROVIDER_ENV_VARS)) {
        for (const envVar of envVars) {
            if (process.env[envVar]) {
                found[provider] = { envVar, masked: maskKey(process.env[envVar]) };
                break;
            }
        }
    }
    return found;
}

function maskKey(key) {
    if (!key || key.length < 8) return '***';
    return key.slice(0, 4) + '...' + key.slice(-4);
}

// ─── Firewall Env File ─────────────────────────────────
function getFirewallEnvPath() {
    return path.join(os.homedir(), '.firewall', '.env');
}

function readFirewallEnv() {
    const envPath = getFirewallEnvPath();
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip surrounding quotes
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            vars[key] = val;
        }
    }
    return vars;
}

function writeFirewallEnv(vars) {
    const envDir = path.join(os.homedir(), '.firewall');
    fs.mkdirSync(envDir, { recursive: true });
    const envPath = getFirewallEnvPath();
    const lines = ['# Agentic Firewall — provider API keys (local-only, never transmitted)', '#'];
    for (const [key, val] of Object.entries(vars)) {
        lines.push(`${key}="${val}"`);
    }
    fs.writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
}

// ─── Hidden Input ───────────────────────────────────────
function promptHidden(question) {
    return new Promise((resolve) => {
        if (!IS_TTY) { resolve(''); return; }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        // Mute output for hidden input
        process.stdout.write(`${c.cyan}?${c.reset} ${question}: `);
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        if (stdin.setRawMode) stdin.setRawMode(true);
        let input = '';
        const onData = (ch) => {
            const char = ch.toString();
            if (char === '\n' || char === '\r') {
                if (stdin.setRawMode) stdin.setRawMode(wasRaw || false);
                stdin.removeListener('data', onData);
                process.stdout.write('\n');
                rl.close();
                resolve(input);
            } else if (char === '\u007f' || char === '\b') {
                input = input.slice(0, -1);
            } else if (char === '\u0003') {
                // Ctrl+C
                process.exit(1);
            } else {
                input += char;
            }
        };
        stdin.on('data', onData);
    });
}

// ─── Setup Command (Local-First) ────────────────────────
async function setup() {
    header('Agent Firewall — Local Setup');
    log(`${c.dim}API keys stay on your machine. Never transmitted to any server.${c.reset}\n`);

    // Step 1: Detect agents
    const { agents } = detectAgents();
    if (agents.length > 0) {
        agents.forEach(a => ok(`Detected ${c.bold}${a.name}${c.reset}`));
        log('');
    }

    // Step 2: Detect existing API keys
    const existingKeys = detectExistingKeys();
    const firewallEnv = readFirewallEnv();
    const allKeys = { ...firewallEnv };

    const providers = [
        { id: 'anthropic', name: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' },
        { id: 'openai', name: 'OpenAI (GPT)', envVar: 'OPENAI_API_KEY' },
        { id: 'gemini', name: 'Google Gemini', envVar: 'GEMINI_API_KEY' },
        { id: 'nvidia', name: 'NVIDIA NIM', envVar: 'NVIDIA_API_KEY' },
    ];

    for (const p of providers) {
        if (existingKeys[p.id]) {
            ok(`${p.name}: found in env (${c.dim}${existingKeys[p.id].masked}${c.reset})`);
            // Copy to firewall env if not already there
            if (!allKeys[p.envVar]) {
                allKeys[p.envVar] = process.env[existingKeys[p.id].envVar];
            }
        } else if (firewallEnv[p.envVar]) {
            ok(`${p.name}: found in ~/.firewall/.env (${c.dim}${maskKey(firewallEnv[p.envVar])}${c.reset})`);
        } else {
            const yes = await confirm(`Add ${p.name} API key?`);
            if (yes) {
                const key = await promptHidden(`Enter ${p.envVar}`);
                if (key && key.trim().length > 5) {
                    allKeys[p.envVar] = key.trim();
                    ok(`${p.name} key saved.`);
                } else {
                    info(`Skipped ${p.name}.`);
                }
            }
        }
    }

    // Step 2.5: Ollama — detect, start service, pull model, enable
    log('');
    const ollamaAgent = agents.find(a => a.type === 'ollama');
    if (ollamaAgent) {
        ok(`${ollamaAgent.name} detected!`);
        const ollamaModel = allKeys['OLLAMA_MODEL'] || 'qwen2.5:3b';

        // Ensure Ollama service is running
        const ollamaRunning = await isOllamaRunning();
        if (!ollamaRunning) {
            const s1 = spinner('Starting Ollama service');
            try {
                const { exec } = require('child_process');
                // Start ollama serve in background (detached, no stdio)
                const child = exec('ollama serve', { stdio: 'ignore', detached: true });
                child.unref();
                // Wait for it to come up (poll up to 10s)
                let started = false;
                for (let attempt = 0; attempt < 20; attempt++) {
                    await sleep(500);
                    if (await isOllamaRunning()) { started = true; break; }
                }
                if (started) {
                    s1.stop(`${c.green}${icons.ok}${c.reset} Ollama service started`);
                } else {
                    s1.stop(`${c.yellow}${icons.warn}${c.reset} Ollama installed but service didn't start. Run: ${c.bold}ollama serve${c.reset}`);
                }
            } catch {
                s1.stop(`${c.yellow}${icons.warn}${c.reset} Could not start Ollama service. Run: ${c.bold}ollama serve${c.reset}`);
            }
        } else {
            ok('Ollama service is running.');
        }

        // Check if the model is already pulled
        const hasModel = await ollamaHasModel(ollamaModel);
        if (!hasModel) {
            const s2 = spinner(`Pulling ${ollamaModel} (this may take a minute)`);
            try {
                const { execSync } = require('child_process');
                execSync(`ollama pull ${ollamaModel}`, { stdio: 'ignore', timeout: 300_000 });
                s2.stop(`${c.green}${icons.ok}${c.reset} Model ${c.bold}${ollamaModel}${c.reset} pulled`);
            } catch {
                s2.stop(`${c.yellow}${icons.warn}${c.reset} Could not pull ${ollamaModel}. Run: ${c.bold}ollama pull ${ollamaModel}${c.reset}`);
            }
        } else {
            ok(`Model ${c.bold}${ollamaModel}${c.reset} ready.`);
        }

        allKeys['OLLAMA_ENABLED'] = 'true';
        allKeys['OLLAMA_MODEL'] = ollamaModel;
        info(`Smart routing + prompt summarization will use ${c.bold}${ollamaModel}${c.reset}`);
        info(`Change model: edit OLLAMA_MODEL in ~/.firewall/.env`);
    } else {
        info(`${c.dim}Ollama not found — smart routing disabled. Install: https://ollama.ai${c.reset}`);
    }

    // Step 3: Write keys to ~/.firewall/.env
    if (Object.keys(allKeys).length > 0) {
        writeFirewallEnv(allKeys);
        ok(`Keys saved to ${c.dim}~/.firewall/.env${c.reset} (chmod 600)`);
    } else {
        warn('No API keys configured. Add them later with: npx agent-firewall setup');
    }

    // Step 4: Shell env vars (agent routing to localhost)
    log('');
    const shell = findShellConfig();
    if (shell) {
        if (fs.existsSync(shell.path)) {
            const content = fs.readFileSync(shell.path, 'utf-8');
            if (content.includes(MARKER)) {
                // Replace existing block with updated local-first block
                const regex = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
                const cleaned = content.replace(regex, '\n');
                fs.writeFileSync(shell.path, cleaned + `\n${getShellBlock(shell.type)}\n`);
                ok('Shell config updated for local-first mode.');
            } else {
                const fileName = path.basename(shell.path);
                const yes = await confirm(`Add local proxy routing to ${fileName}?`);
                if (yes) {
                    fs.appendFileSync(shell.path, `\n${getShellBlock(shell.type)}\n`);
                    ok(`Added to ${c.dim}${fileName}${c.reset}.`);
                    if (shell.type === 'posix') {
                        info(`Run ${c.bold}source ~/${fileName}${c.reset} to activate.`);
                    } else {
                        info(`Restart your PowerShell to activate.`);
                    }
                }
            }
        } else if (shell.create) {
            const yes = await confirm(`Create ${path.basename(shell.path)} with proxy routing?`);
            if (yes) {
                fs.mkdirSync(path.dirname(shell.path), { recursive: true });
                fs.writeFileSync(shell.path, `${getShellBlock(shell.type)}\n`);
                ok(`Created ${c.dim}${path.basename(shell.path)}${c.reset} with proxy config.`);
            }
        }
    }

    // Step 5: Check if proxy is running
    log('');
    const s = spinner('Checking local proxy');
    try {
        const health = await httpGet(`${PROXY_URL}/health`);
        if (health && health.status === 'ok') {
            s.stop(`${c.green}${icons.ok}${c.reset} Proxy running! Providers: ${health.providers?.join(', ') || 'none'}`);
        } else {
            s.stop(`${c.yellow}${icons.warn}${c.reset} Proxy responded but health check unexpected.`);
        }
    } catch (err) {
        s.stop(`${c.yellow}${icons.warn}${c.reset} Proxy not running on localhost:4000.`);
        info(`Start it with: ${c.bold}cd agent-proxy && npm run dev${c.reset}`);
        info(`Or with PM2:   ${c.bold}pm2 start "npx tsx agent-proxy/src/index.ts" --name agentic-firewall${c.reset}`);
    }

    header('Setup Complete!');
    log(`${c.bold}${c.green}Your API keys never leave this machine.${c.reset}`);
    log('');
    log(`${c.dim}• Keys stored locally in ~/.firewall/.env (chmod 600)${c.reset}`);
    log(`${c.dim}• Proxy runs on localhost:4000 — agents route through it${c.reset}`);
    log(`${c.dim}• Loop detection, prompt caching, budget control — all local${c.reset}`);
    if (allKeys['OLLAMA_ENABLED'] === 'true') {
        log(`${c.dim}• Ollama optimizes requests locally (smart routing + summarization)${c.reset}`);
    }
    log('');
    log(`Run ${c.bold}npx agent-firewall scan${c.reset} to see your waste report.`);
    log(`Run ${c.bold}npx agent-firewall verify${c.reset} to test the connection.`);
    log(`Run ${c.bold}npx agent-firewall uninstall${c.reset} to undo everything.\n`);
}

// ─── Uninstall Command ──────────────────────────────────
async function uninstall() {
    header('Agent Firewall — Uninstall');

    // Remove shell config block
    const shell = findShellConfig();
    if (shell && fs.existsSync(shell.path)) {
        const content = fs.readFileSync(shell.path, 'utf-8');
        if (content.includes(MARKER)) {
            const regex = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
            const cleaned = content.replace(regex, '\n');
            fs.writeFileSync(shell.path, cleaned);
            ok(`Removed env vars from ${c.dim}${path.basename(shell.path)}${c.reset}`);
            if (shell.type === 'posix') {
                info(`Run ${c.bold}source ~/${path.basename(shell.path)}${c.reset} to apply.`);
            } else {
                info('Restart PowerShell to apply.');
            }
        } else {
            ok('Shell config already clean.');
        }
    }

    // OpenClaw: no config changes needed — routing is via env vars only.
    // Removing env vars from shell config (above) is sufficient.

    log('');
    ok('Agent Firewall uninstalled. Your agents now connect directly to providers.');
    log(`${c.dim}Run ${c.bold}npx agent-firewall setup${c.reset}${c.dim} to re-enable.${c.reset}\n`);
}

// ─── Status Command ─────────────────────────────────────
async function status() {
    header('Agent Firewall — Status');
    const s = spinner('Fetching proxy stats');
    try {
        const stats = await httpGet(PROXY_API);
        s.stop(`${c.green}${icons.ok}${c.reset} Connected`);
        log('');
        log(`  ${c.bold}Requests:${c.reset}      ${stats.totalRequests}`);
        log(`  ${c.bold}Money Saved:${c.reset}   $${stats.savedMoney?.toFixed(4) || '0.0000'}`);
        log(`  ${c.bold}Tokens Saved:${c.reset}  ${(stats.savedTokens || 0).toLocaleString()}`);
        log(`  ${c.bold}Loops Blocked:${c.reset} ${stats.blockedLoops || 0}`);

        const activity = stats.recentActivity || [];
        if (activity.length > 0) {
            log(`\n  ${c.bold}Recent Traffic:${c.reset}`);
            activity.slice(0, 8).forEach(a => {
                const sc = a.status.includes('CDN') ? c.green :
                    a.status.includes('Block') ? c.red :
                        a.status.includes('429') ? c.yellow : c.dim;
                log(`  ${c.dim}${a.time}${c.reset}  ${a.model.padEnd(25)} ${a.tokens.padStart(6)}  ${sc}${a.status}${c.reset}`);
            });
        }
        log('');
    } catch (err) {
        s.stop(`${c.red}${icons.fail}${c.reset} Cannot reach proxy: ${err.message}`);
        info('Is the local proxy running? Start with: cd agent-proxy && npm run dev');
    }
}

// ─── Verify Command ─────────────────────────────────────
async function verify() {
    header('Agent Firewall — Verify (Local-First)');
    const ov = process.env.OPENAI_BASE_URL || 'not set';
    const av = process.env.ANTHROPIC_BASE_URL || 'not set';
    const isLocal = (url) => url.includes('localhost') || url.includes('127.0.0.1');
    log(`  OPENAI_BASE_URL:    ${isLocal(ov) ? c.green : c.red}${ov}${c.reset}`);
    log(`  ANTHROPIC_BASE_URL: ${isLocal(av) ? c.green : c.red}${av}${c.reset}\n`);

    // Check ~/.firewall/.env exists
    const envPath = getFirewallEnvPath();
    if (fs.existsSync(envPath)) {
        const envVars = readFirewallEnv();
        const providers = Object.keys(envVars).filter(k => k.includes('API_KEY'));
        ok(`Keys file: ${c.dim}~/.firewall/.env${c.reset} (${providers.length} key${providers.length !== 1 ? 's' : ''})`);
    } else {
        warn(`Keys file: ${c.yellow}~/.firewall/.env not found${c.reset} — run ${c.bold}npx agent-firewall setup${c.reset}`);
    }

    // Check proxy health
    const s = spinner('Testing local proxy');
    try {
        const health = await httpGet(`${PROXY_URL}/health`);
        if (health && health.status === 'ok') {
            s.stop(`${c.green}${icons.ok}${c.reset} Proxy live (mode: ${health.mode}, providers: ${health.providers?.join(', ') || 'none'})`);
        } else {
            s.stop(`${c.green}${icons.ok}${c.reset} Proxy responding`);
        }
    } catch (err) {
        s.stop(`${c.red}${icons.fail}${c.reset} Proxy not running: ${err.message}`);
        info('Start it with: cd agent-proxy && npm run dev');
        return;
    }

    // Check existing provider keys in env
    const existingKeys = detectExistingKeys();
    for (const [provider, info_] of Object.entries(existingKeys)) {
        ok(`${provider}: ${c.dim}${info_.masked}${c.reset}`);
    }

    // Check shell config
    const shell = findShellConfig();
    if (shell && fs.existsSync(shell.path)) {
        const content = fs.readFileSync(shell.path, 'utf-8');
        if (content.includes(MARKER)) {
            ok(`Shell config: ${c.green}${path.basename(shell.path)}${c.reset} has proxy vars`);
        } else {
            warn(`Shell config: ${c.yellow}${path.basename(shell.path)}${c.reset} — no proxy vars found`);
        }
    }
    log('');
}

// ─── Main ───────────────────────────────────────────────
const command = process.argv[2] || '--help';

switch (command) {
    case 'setup': setup().catch(err => fail(err.message)); break;
    case 'scan': scan().catch(err => fail(err.message)); break;
    case 'status': status().catch(err => fail(err.message)); break;
    case 'verify': verify().catch(err => fail(err.message)); break;
    case 'uninstall': uninstall().catch(err => fail(err.message)); break;
    case '--version': case '-v':
        log(`agent-firewall v${VERSION}`);
        break;
    case '--help': case '-h':
        header('Agent Firewall');
        log('  Keep autonomous AI agents under control.\n');
        log(`  ${c.bold}Usage:${c.reset} npx agent-firewall <command>\n`);
        log(`  ${c.bold}Commands:${c.reset}`);
        log(`    ${c.green}setup${c.reset}       Auto-detect agents, patch configs, verify connection`);
        log(`    ${c.green}scan${c.reset}        Scan agent logs for waste (loops, retries, missed caching)`);
        log(`    ${c.green}status${c.reset}      Check live proxy stats (requests, savings, blocked loops)`);
        log(`    ${c.green}verify${c.reset}      Test that routing is working`);
        log(`    ${c.green}uninstall${c.reset}   Remove proxy routing and restore original configs`);
        log('');
        log(`  ${c.bold}Flags:${c.reset}`);
        log(`    ${c.dim}--version${c.reset}   Show version`);
        log(`    ${c.dim}--help${c.reset}      Show this help\n`);
        break;
    default:
        fail(`Unknown command: ${command}`);
        log(`Run ${c.bold}npx agent-firewall --help${c.reset} to see available commands.`);
        process.exitCode = 1;
}
