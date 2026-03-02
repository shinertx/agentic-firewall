#!/usr/bin/env node

/**
 * agent-firewall CLI v0.3.0
 * Agent Runtime Control — keep autonomous AI agents under control.
 *
 * Usage:
 *   npx agent-firewall setup     — auto-detect agents, patch configs, verify connection
 *   npx agent-firewall scan      — scan agent logs for waste (with real $ numbers)
 *   npx agent-firewall status    — check proxy stats (requests, savings, blocked loops)
 *   npx agent-firewall verify    — test that traffic is routing through the firewall
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROXY_URL = 'https://api.jockeyvc.com';
const PROXY_API = `${PROXY_URL}/api/stats`;

// ─── Colors ─────────────────────────────────────────────
const c = {
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
};

function log(msg) { console.log(msg); }
function ok(msg) { log(`${c.green}✅${c.reset} ${msg}`); }
function warn(msg) { log(`${c.yellow}⚠️${c.reset}  ${msg}`); }
function fail(msg) { log(`${c.red}❌${c.reset} ${msg}`); }
function info(msg) { log(`${c.cyan}ℹ${c.reset}  ${msg}`); }
function header(msg) { log(`\n${c.bold}${c.magenta}🛡️  ${msg}${c.reset}\n`); }

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
    // Default to mid-range pricing
    return { input: 3.00, output: 15.00, cached: 0.30 };
}

function tokenCost(tokens, pricePerMillion) {
    return (tokens / 1_000_000) * pricePerMillion;
}

// ─── HTTP Helper ────────────────────────────────────────
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        }).on('error', reject);
    });
}

// ─── Agent Detection ────────────────────────────────────
function detectAgents() {
    const agents = [];
    const home = os.homedir();

    const openclawConfig = path.join(home, '.openclaw', 'openclaw.json');
    if (fs.existsSync(openclawConfig)) {
        agents.push({ name: 'OpenClaw', configPath: openclawConfig, type: 'openclaw' });
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

    // Claude Code: ~/.claude/projects/*/sessions/*.jsonl and subagents/*.jsonl
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

    // OpenClaw: ~/.openclaw/agents/main/sessions/*.jsonl
    const openclawSessions = path.join(home, '.openclaw', 'agents', 'main', 'sessions');
    if (fs.existsSync(openclawSessions)) {
        try {
            fs.readdirSync(openclawSessions)
                .filter(f => f.endsWith('.jsonl'))
                .forEach(f => logs.openClaw.push(path.join(openclawSessions, f)));
        } catch { /* skip */ }
    }

    return logs;
}

// ─── Claude Code Transcript Analyzer ────────────────────
function analyzeClaudeTranscript(filepath) {
    const result = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        toolErrors: 0,
        retryLoops: 0,
        requests: 0,
        models: {},
        wastedTokens: 0,
        sessions: 0,
    };

    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        let lastToolError = '';
        let consecutiveErrors = 0;

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                // Count API responses with usage data
                if (entry.message?.usage) {
                    const u = entry.message.usage;
                    result.totalInputTokens += (u.input_tokens || 0);
                    result.totalOutputTokens += (u.output_tokens || 0);
                    result.cacheCreationTokens += (u.cache_creation_input_tokens || 0);
                    result.cacheReadTokens += (u.cache_read_input_tokens || 0);
                    result.requests++;

                    // Track model usage
                    const model = entry.message.model || 'unknown';
                    result.models[model] = (result.models[model] || 0) + 1;
                }

                // Track tool errors
                if (entry.message?.content) {
                    const content = entry.message.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
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

                // Track session starts
                if (entry.type === 'user' && entry.parentUuid === null) {
                    result.sessions++;
                }
            } catch { /* skip non-JSON lines */ }
        }

        // Calculate wasted tokens: tokens that COULD have been cached but weren't
        // If cacheCreation > 0 but cacheRead is low relative to total input, that's waste
        const totalCacheable = result.cacheCreationTokens;
        if (totalCacheable > 0 && result.requests > 1) {
            // Every request after the first could have read from cache
            const couldHaveCached = totalCacheable * (result.requests - 1);
            result.wastedTokens = Math.max(0, couldHaveCached - result.cacheReadTokens);
        }

    } catch { /* file read error */ }

    return result;
}

// ─── OpenClaw Session Analyzer ──────────────────────────
function analyzeOpenClawSession(filepath) {
    const result = {
        messages: 0,
        provider: 'unknown',
        modelId: 'unknown',
        toolCalls: 0,
        toolErrors: 0,
    };

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

        // Fall back to proxy stats
        try {
            const stats = await httpGet(PROXY_API);
            if (stats && stats.totalRequests > 0) {
                info('Using proxy data instead...\n');
                showProxyWaste(stats);
            } else {
                info('Route some traffic through the firewall first: npx agent-firewall setup\n');
            }
        } catch {
            info('Run `npx agent-firewall setup` to get started.\n');
        }
        return;
    }

    // ─── Analyze Claude Code ────────────────────────────
    let grandTotalInput = 0;
    let grandTotalOutput = 0;
    let grandCacheCreation = 0;
    let grandCacheRead = 0;
    let grandToolErrors = 0;
    let grandRetryLoops = 0;
    let grandRequests = 0;
    let grandWastedTokens = 0;
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

    // ─── Analyze OpenClaw ───────────────────────────────
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

    // ─── Cost Calculations ──────────────────────────────
    // Use weighted average pricing based on models found
    let totalInputCost = 0;
    let totalOutputCost = 0;
    let totalCacheSavings = 0;
    let potentialCacheSavings = 0;

    for (const [model, count] of Object.entries(grandModels)) {
        const pricing = getModelPricing(model);
        // Rough allocation: distribute tokens proportionally by request count
        const pct = count / Math.max(grandRequests, 1);
        const modelInputTokens = grandTotalInput * pct;
        const modelOutputTokens = grandTotalOutput * pct;
        const modelCacheRead = grandCacheRead * pct;

        totalInputCost += tokenCost(modelInputTokens, pricing.input);
        totalOutputCost += tokenCost(modelOutputTokens, pricing.output);

        // Savings from cache reads
        const savedPerToken = pricing.input - pricing.cached;
        totalCacheSavings += tokenCost(modelCacheRead, savedPerToken);

        // Potential savings: tokens that could have been cached but weren't
        const modelWasted = grandWastedTokens * pct;
        potentialCacheSavings += tokenCost(modelWasted, savedPerToken);
    }

    const totalSpend = totalInputCost + totalOutputCost;

    // ─── Results ────────────────────────────────────────
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

    // The money shot — what they WOULD save
    if (potentialCacheSavings > 0.01) {
        log('');
        log(`  ${c.bgRed}${c.white}${c.bold} 🚨 MISSED SAVINGS: $${potentialCacheSavings.toFixed(2)} ${c.reset}`);
        log(`  ${c.dim}${grandWastedTokens.toLocaleString()} tokens were re-sent instead of cached.${c.reset}`);
        log(`  ${c.dim}The Agentic Firewall would have cached these automatically.${c.reset}`);
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

    // Model breakdown
    if (Object.keys(grandModels).length > 0) {
        log(`\n  ${c.bold}Models Used:${c.reset}`);
        for (const [model, count] of Object.entries(grandModels).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
            log(`    ${model.padEnd(32)} ${c.dim}${count} calls${c.reset}`);
        }
    }

    // CTA
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
    header('Agent Runtime Control — Setup');
    log(`${c.dim}Stop runaway agents. Save money. Stay in control.${c.reset}\n`);

    const { agents } = detectAgents();

    if (agents.length === 0) {
        warn('No agent config files detected (OpenClaw, Claude Code).');
        info('Setting up environment variables for any OpenAI/Anthropic SDK.\n');
    } else {
        agents.forEach(a => ok(`Found ${c.bold}${a.name}${c.reset} at ${c.dim}${a.configPath}${c.reset}`));
        log('');
    }

    for (const agent of agents) {
        if (agent.type === 'openclaw') {
            info(`Configuring ${agent.name}...`);
            try {
                const config = JSON.parse(fs.readFileSync(agent.configPath, 'utf-8'));
                const backupPath = `${agent.configPath}.bak.${Date.now()}`;
                fs.writeFileSync(backupPath, JSON.stringify(config, null, 2));
                ok(`Backup: ${c.dim}${backupPath}${c.reset}`);

                config.models = config.models || {};
                config.models.providers = config.models.providers || {};

                const currentBaseUrl = config.models.providers?.openai?.baseUrl || '';
                if (currentBaseUrl.includes('jockeyvc.com')) {
                    ok(`${agent.name} already configured.`);
                } else {
                    config.models.providers.openai = {
                        ...config.models.providers.openai,
                        baseUrl: `${PROXY_URL}/v1`,
                        models: config.models.providers?.openai?.models || [{ id: 'gpt-4o', name: 'GPT-4o' }]
                    };
                    config.models.providers.anthropic = {
                        ...config.models.providers.anthropic,
                        baseUrl: PROXY_URL,
                        models: config.models.providers?.anthropic?.models || [{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' }]
                    };
                    fs.writeFileSync(agent.configPath, JSON.stringify(config, null, 2));
                    ok(`${agent.name} config patched.`);
                }
            } catch (err) {
                fail(`Failed: ${err.message}`);
            }
        }
    }

    // Shell env vars
    const shellConfig = fs.existsSync(path.join(os.homedir(), '.zshrc'))
        ? path.join(os.homedir(), '.zshrc')
        : path.join(os.homedir(), '.bashrc');

    if (shellConfig && fs.existsSync(shellConfig)) {
        const content = fs.readFileSync(shellConfig, 'utf-8');
        const marker = '# agent-firewall proxy routing';
        if (content.includes(marker)) {
            ok('Shell environment already configured.');
        } else {
            info(`Adding env vars to ${c.dim}${path.basename(shellConfig)}${c.reset}...`);
            fs.appendFileSync(shellConfig, `\n${marker}\nexport OPENAI_BASE_URL="${PROXY_URL}/v1"\nexport ANTHROPIC_BASE_URL="${PROXY_URL}"\n`);
            ok('Shell configured. Run `source ~/.zshrc` to activate.');
        }
    }

    // Verify
    log('');
    info('Verifying proxy...');
    try {
        const stats = await httpGet(PROXY_API);
        if (stats && typeof stats.totalRequests === 'number') {
            ok(`Proxy live! ${stats.totalRequests} requests, $${stats.savedMoney?.toFixed(4) || '0'} saved.`);
        }
    } catch (err) {
        fail(`Cannot reach proxy: ${err.message}`);
        return;
    }

    header('Setup Complete!');
    log(`${c.dim}• Loop detection: kills stuck agents${c.reset}`);
    log(`${c.dim}• Prompt caching: up to 90% savings${c.reset}`);
    log(`${c.dim}• Budget control: cap spend per session${c.reset}`);
    log('');
    log(`Run ${c.bold}npx agent-firewall scan${c.reset} to see your waste report.\n`);
}

// ─── Status Command ─────────────────────────────────────
async function status() {
    header('Agent Runtime Control — Status');
    try {
        const stats = await httpGet(PROXY_API);
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
        fail(`Cannot reach proxy: ${err.message}`);
    }
}

// ─── Verify Command ─────────────────────────────────────
async function verify() {
    header('Agent Runtime Control — Verify');
    const ov = process.env.OPENAI_BASE_URL || 'not set';
    const av = process.env.ANTHROPIC_BASE_URL || 'not set';
    log(`  OPENAI_BASE_URL:    ${ov.includes('jockeyvc') ? c.green : c.red}${ov}${c.reset}`);
    log(`  ANTHROPIC_BASE_URL: ${av.includes('jockeyvc') ? c.green : c.red}${av}${c.reset}\n`);

    try {
        const stats = await httpGet(PROXY_API);
        ok(`Proxy live (${stats.totalRequests} requests)`);
    } catch (err) {
        fail(`Proxy unreachable: ${err.message}`);
        return;
    }

    const oc = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(oc)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(oc, 'utf-8'));
            const bu = cfg?.models?.providers?.openai?.baseUrl || 'not set';
            if (bu.includes('jockeyvc')) ok(`OpenClaw: ${c.green}${bu}${c.reset}`);
            else warn(`OpenClaw: ${c.yellow}${bu}${c.reset} — not proxied`);
        } catch { /* ignore */ }
    }
    log('');
}

// ─── Main ───────────────────────────────────────────────
const command = process.argv[2] || 'setup';

switch (command) {
    case 'setup': setup().catch(err => fail(err.message)); break;
    case 'scan': scan().catch(err => fail(err.message)); break;
    case 'status': status().catch(err => fail(err.message)); break;
    case 'verify': verify().catch(err => fail(err.message)); break;
    case '--help': case '-h':
        header('Agent Runtime Control');
        log('  Keep autonomous AI agents under control.\n');
        log('  Usage: npx agent-firewall <command>\n');
        log('  Commands:');
        log('    setup     Auto-detect agents, patch configs, verify connection');
        log('    scan      Scan agent logs for waste (loops, retries, missed caching)');
        log('    status    Check live proxy stats (requests, savings, blocked loops)');
        log('    verify    Test that routing is working\n');
        break;
    default:
        fail(`Unknown command: ${command}`);
        log(`Run ${c.bold}npx agent-firewall --help${c.reset} to see commands.`);
}
