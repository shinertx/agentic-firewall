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

const VERSION = '0.5.2';
const PROXY_URL = 'https://api.jockeyvc.com';
const PROXY_API = `${PROXY_URL}/api/stats`;
const HTTP_TIMEOUT_MS = 10_000;

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

// ─── HTTP Helper (with timeout) ─────────────────────────
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
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
    if (type === 'powershell') {
        return `${MARKER}\n$env:OPENAI_BASE_URL = "${PROXY_URL}/v1"\n$env:ANTHROPIC_BASE_URL = "${PROXY_URL}"\n${MARKER_END}`;
    }
    return `${MARKER}\nexport OPENAI_BASE_URL="${PROXY_URL}/v1"\nexport ANTHROPIC_BASE_URL="${PROXY_URL}"\n${MARKER_END}`;
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

    return { agents };
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

// ─── Setup Command ──────────────────────────────────────
async function setup() {
    header('Agent Firewall — Setup');
    log(`${c.dim}Stop runaway agents. Save money. Stay in control.${c.reset}\n`);

    const { agents } = detectAgents();

    if (agents.length === 0) {
        info('No agents detected. Setting up environment variables for any OpenAI/Anthropic SDK.\n');
    } else {
        agents.forEach(a => ok(`Detected ${c.bold}${a.name}${c.reset}`));
        if (agents.some(a => a.type === 'openclaw')) {
            info(`OpenClaw will pick up the proxy via ${c.bold}ANTHROPIC_BASE_URL${c.reset} / ${c.bold}OPENAI_BASE_URL${c.reset} env vars.`);
            info(`${c.dim}No changes to openclaw.json needed.${c.reset}`);
        }
        log('');
    }

    // Shell env vars
    const shell = findShellConfig();
    if (shell) {
        if (fs.existsSync(shell.path)) {
            const content = fs.readFileSync(shell.path, 'utf-8');
            if (content.includes(MARKER)) {
                ok('Shell environment already configured.');
            } else {
                const fileName = path.basename(shell.path);
                const yes = await confirm(`Add proxy env vars to ${fileName}?`);
                if (yes) {
                    fs.appendFileSync(shell.path, `\n${getShellBlock(shell.type)}\n`);
                    ok(`Added to ${c.dim}${fileName}${c.reset}.`);
                    if (shell.type === 'posix') {
                        info(`Run ${c.bold}source ~/${fileName}${c.reset} to activate.`);
                    } else {
                        info(`Restart your PowerShell to activate.`);
                    }
                } else {
                    info('Skipped shell config.');
                    info(`You can manually set:`);
                    if (shell.type === 'powershell') {
                        log(`  ${c.dim}$env:OPENAI_BASE_URL = "${PROXY_URL}/v1"${c.reset}`);
                        log(`  ${c.dim}$env:ANTHROPIC_BASE_URL = "${PROXY_URL}"${c.reset}`);
                    } else {
                        log(`  ${c.dim}export OPENAI_BASE_URL="${PROXY_URL}/v1"${c.reset}`);
                        log(`  ${c.dim}export ANTHROPIC_BASE_URL="${PROXY_URL}"${c.reset}`);
                    }
                }
            }
        } else if (shell.create) {
            const yes = await confirm(`Create ${path.basename(shell.path)} with proxy env vars?`);
            if (yes) {
                fs.mkdirSync(path.dirname(shell.path), { recursive: true });
                fs.writeFileSync(shell.path, `${getShellBlock(shell.type)}\n`);
                ok(`Created ${c.dim}${path.basename(shell.path)}${c.reset} with proxy config.`);
            }
        }
    } else {
        warn('Could not detect shell config file.');
        info('Set these env vars manually:');
        log(`  ${c.dim}OPENAI_BASE_URL=${PROXY_URL}/v1${c.reset}`);
        log(`  ${c.dim}ANTHROPIC_BASE_URL=${PROXY_URL}${c.reset}`);
    }

    // Verify proxy connection
    log('');
    const s = spinner('Verifying proxy connection');
    try {
        const stats = await httpGet(PROXY_API);
        if (stats && typeof stats.totalRequests === 'number') {
            s.stop(`${c.green}${icons.ok}${c.reset} Proxy live! ${stats.totalRequests} requests, $${stats.savedMoney?.toFixed(4) || '0'} saved.`);
        } else {
            s.stop(`${c.yellow}${icons.warn}${c.reset} Proxy responded but data format unexpected.`);
        }
    } catch (err) {
        s.stop(`${c.red}${icons.fail}${c.reset} Cannot reach proxy: ${err.message}`);
        info('Check your internet connection and try again.');
        return;
    }

    header('Setup Complete!');
    log(`${c.dim}• Loop detection: kills stuck agents${c.reset}`);
    log(`${c.dim}• Prompt caching: up to 90% savings${c.reset}`);
    log(`${c.dim}• Budget control: cap spend per session${c.reset}`);
    log('');
    log(`Run ${c.bold}npx agent-firewall scan${c.reset} to see your waste report.`);
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
        info('Is the proxy running? Check https://api.jockeyvc.com/health');
    }
}

// ─── Verify Command ─────────────────────────────────────
async function verify() {
    header('Agent Firewall — Verify');
    const ov = process.env.OPENAI_BASE_URL || 'not set';
    const av = process.env.ANTHROPIC_BASE_URL || 'not set';
    log(`  OPENAI_BASE_URL:    ${ov.includes('jockeyvc') ? c.green : c.red}${ov}${c.reset}`);
    log(`  ANTHROPIC_BASE_URL: ${av.includes('jockeyvc') ? c.green : c.red}${av}${c.reset}\n`);

    const s = spinner('Testing proxy connection');
    try {
        const stats = await httpGet(PROXY_API);
        s.stop(`${c.green}${icons.ok}${c.reset} Proxy live (${stats.totalRequests} requests)`);
    } catch (err) {
        s.stop(`${c.red}${icons.fail}${c.reset} Proxy unreachable: ${err.message}`);
        info('Run npx agent-firewall setup to configure.');
        return;
    }

    // OpenClaw check: it uses env vars, so checking ANTHROPIC_BASE_URL is sufficient
    const ocDir = path.join(os.homedir(), '.openclaw');
    if (fs.existsSync(ocDir)) {
        if (av.includes('jockeyvc') || ov.includes('jockeyvc')) {
            ok(`OpenClaw detected — will use proxy via env vars`);
        } else {
            warn(`OpenClaw detected but env vars not set — run ${c.bold}npx agent-firewall setup${c.reset}`);
        }
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
