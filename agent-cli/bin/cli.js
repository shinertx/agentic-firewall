#!/usr/bin/env node

/**
 * agent-firewall CLI
 * Agent Runtime Control — keep autonomous AI agents under control.
 *
 * Usage:
 *   npx agent-firewall setup     — auto-detect agents, patch configs, verify connection
 *   npx agent-firewall status    — check proxy stats (requests, savings, blocked loops)
 *   npx agent-firewall scan      — scan agent logs for waste patterns
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
    white: '\x1b[37m',
};

function log(msg) { console.log(msg); }
function ok(msg) { log(`${c.green}✅${c.reset} ${msg}`); }
function warn(msg) { log(`${c.yellow}⚠️${c.reset}  ${msg}`); }
function fail(msg) { log(`${c.red}❌${c.reset} ${msg}`); }
function info(msg) { log(`${c.cyan}ℹ${c.reset}  ${msg}`); }
function header(msg) { log(`\n${c.bold}${c.magenta}🛡️  ${msg}${c.reset}\n`); }

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

    // OpenClaw
    const openclawConfig = path.join(home, '.openclaw', 'openclaw.json');
    if (fs.existsSync(openclawConfig)) {
        agents.push({ name: 'OpenClaw', configPath: openclawConfig, type: 'openclaw' });
    }

    // Claude Code
    const claudeConfig = path.join(home, '.claude', 'settings.json');
    if (fs.existsSync(claudeConfig)) {
        agents.push({ name: 'Claude Code', configPath: claudeConfig, type: 'claude-code' });
    }

    const hasOpenAIBase = process.env.OPENAI_BASE_URL;
    const hasAnthropicBase = process.env.ANTHROPIC_BASE_URL;

    return { agents, hasOpenAIBase, hasAnthropicBase };
}

// ─── Log Scanner Utilities ──────────────────────────────

/**
 * Find and parse JSONL log files from known agent locations.
 */
function findLogFiles() {
    const home = os.homedir();
    const logPaths = [];

    // OpenClaw logs
    const openclawLogs = path.join(home, '.openclaw', 'logs');
    if (fs.existsSync(openclawLogs)) {
        try {
            const files = fs.readdirSync(openclawLogs)
                .filter(f => f.endsWith('.jsonl') || f.endsWith('.log'))
                .map(f => path.join(openclawLogs, f));
            logPaths.push(...files);
        } catch { /* skip if no permission */ }
    }

    // OpenClaw gateway log (single file)
    const openclawGatewayLog = path.join(home, '.openclaw', 'gateway.log');
    if (fs.existsSync(openclawGatewayLog)) logPaths.push(openclawGatewayLog);

    // Claude Code transcripts
    const claudeDir = path.join(home, '.claude', 'transcripts');
    if (fs.existsSync(claudeDir)) {
        try {
            const walkDir = (dir) => {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) walkDir(full);
                    else if (e.name.endsWith('.jsonl')) logPaths.push(full);
                }
            };
            walkDir(claudeDir);
        } catch { /* skip */ }
    }

    return logPaths;
}

/**
 * Analyze a JSONL log file for waste patterns.
 */
function analyzeLogFile(filepath) {
    const results = {
        file: filepath,
        totalLines: 0,
        totalTokens: 0,
        repeatedPrompts: 0,
        toolFailures: 0,
        retryLoops: 0,
        estimatedWaste: 0,
        models: {},
    };

    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        results.totalLines = lines.length;

        const seenHashes = new Map();
        let lastToolError = null;
        let consecutiveErrors = 0;

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                // Count tokens
                if (entry.usage) {
                    const tokens = (entry.usage.input_tokens || 0) + (entry.usage.output_tokens || 0);
                    results.totalTokens += tokens;
                }

                // Track model usage
                if (entry.model) {
                    results.models[entry.model] = (results.models[entry.model] || 0) + 1;
                }

                // Detect repeated prompts (same content hash)
                if (entry.messages || entry.content) {
                    const sig = JSON.stringify(entry.messages || entry.content).slice(0, 500);
                    const count = seenHashes.get(sig) || 0;
                    seenHashes.set(sig, count + 1);
                    if (count >= 2) results.repeatedPrompts++;
                }

                // Detect tool failures
                if (entry.type === 'tool_result' && entry.is_error) {
                    results.toolFailures++;
                    const errorSig = (entry.content || '').slice(0, 100);
                    if (errorSig === lastToolError) {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 3) results.retryLoops++;
                    } else {
                        consecutiveErrors = 1;
                        lastToolError = errorSig;
                    }
                }

                // Check for PostToolUseFailure (Claude Code hooks)
                if (entry.event === 'PostToolUseFailure') {
                    results.toolFailures++;
                }
            } catch { /* skip non-JSON lines */ }
        }

        // Estimate waste: repeated prompts cost re-sent tokens
        results.estimatedWaste = results.repeatedPrompts * 5000; // ~5k tokens per re-send
        results.estimatedWaste += results.retryLoops * 10000; // retry loops are expensive

    } catch { /* file read error */ }

    return results;
}

// ─── Setup Command ──────────────────────────────────────
async function setup() {
    header('Agent Runtime Control — Setup');
    log(`${c.dim}Stop runaway agents. Save money. Stay in control.${c.reset}\n`);

    // Step 1: Detect agents
    info('Detecting installed agents...');
    const { agents } = detectAgents();

    if (agents.length === 0) {
        warn('No agent config files detected (OpenClaw, Claude Code).');
        info('Setting up environment variables for any OpenAI/Anthropic SDK.\n');
    } else {
        agents.forEach(a => ok(`Found ${c.bold}${a.name}${c.reset} at ${c.dim}${a.configPath}${c.reset}`));
        log('');
    }

    // Step 2: Configure each agent
    for (const agent of agents) {
        if (agent.type === 'openclaw') {
            info(`Configuring ${agent.name}...`);
            try {
                const config = JSON.parse(fs.readFileSync(agent.configPath, 'utf-8'));

                const backupPath = `${agent.configPath}.bak.${Date.now()}`;
                fs.writeFileSync(backupPath, JSON.stringify(config, null, 2));
                ok(`Backup saved to ${c.dim}${backupPath}${c.reset}`);

                config.models = config.models || {};
                config.models.providers = config.models.providers || {};

                const currentBaseUrl = config.models.providers?.openai?.baseUrl || '';
                if (currentBaseUrl.includes('jockeyvc.com')) {
                    ok(`${agent.name} already configured for proxy.`);
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
                    ok(`${agent.name} config patched to route through proxy.`);
                }
            } catch (err) {
                fail(`Failed to configure ${agent.name}: ${err.message}`);
            }
        }
    }

    // Step 3: Shell env vars
    const zshrcPath = path.join(os.homedir(), '.zshrc');
    const bashrcPath = path.join(os.homedir(), '.bashrc');
    const shellConfig = fs.existsSync(zshrcPath) ? zshrcPath : bashrcPath;

    if (shellConfig) {
        const content = fs.readFileSync(shellConfig, 'utf-8');
        const marker = '# agent-firewall proxy routing';

        if (content.includes(marker)) {
            ok('Shell environment already configured.');
        } else {
            info(`Adding proxy env vars to ${c.dim}${shellConfig}${c.reset}...`);
            const block = `\n${marker}\nexport OPENAI_BASE_URL="${PROXY_URL}/v1"\nexport ANTHROPIC_BASE_URL="${PROXY_URL}"\n`;
            fs.appendFileSync(shellConfig, block);
            ok('Shell environment configured. Run `source ~/.zshrc` to activate.');
        }
    }

    // Step 4: Verify proxy
    log('');
    info('Verifying proxy connection...');
    try {
        const stats = await httpGet(PROXY_API);
        if (stats && typeof stats.totalRequests === 'number') {
            ok(`Proxy is live! ${c.bold}${stats.totalRequests}${c.reset} requests proxied, ${c.bold}$${stats.savedMoney?.toFixed(4) || '0.0000'}${c.reset} saved.`);
        } else {
            fail('Proxy responded but returned unexpected data.');
        }
    } catch (err) {
        fail(`Cannot reach proxy at ${PROXY_URL}: ${err.message}`);
        warn('Check your network connection and try again.');
        return;
    }

    // Done
    header('Setup Complete!');
    log(`Your agent traffic is now routed through the Agentic Firewall.`);
    log(`${c.dim}• Loop detection: kills stuck agents before they burn tokens${c.reset}`);
    log(`${c.dim}• Prompt caching: reduces repeat context costs by up to 90%${c.reset}`);
    log(`${c.dim}• Budget control: cap spend per session${c.reset}`);
    log('');
    log(`Run ${c.bold}npx agent-firewall scan${c.reset} to see how much waste your agents generate.`);
    log(`Run ${c.bold}npx agent-firewall status${c.reset} to check live stats.\n`);
}

// ─── Status Command ─────────────────────────────────────
async function status() {
    header('Agent Runtime Control — Status');

    try {
        const stats = await httpGet(PROXY_API);

        log(`  ${c.bold}Total Requests:${c.reset}  ${stats.totalRequests}`);
        log(`  ${c.bold}Money Saved:${c.reset}     $${stats.savedMoney?.toFixed(4) || '0.0000'}`);
        log(`  ${c.bold}Tokens Saved:${c.reset}    ${(stats.savedTokens || 0).toLocaleString()}`);
        log(`  ${c.bold}Blocked Loops:${c.reset}   ${stats.blockedLoops || 0}`);

        const activity = stats.recentActivity || [];
        if (activity.length > 0) {
            log(`\n  ${c.bold}Recent Traffic:${c.reset}`);
            activity.slice(0, 8).forEach(a => {
                const statusColor = a.status.includes('CDN') ? c.green :
                    a.status.includes('Block') ? c.red :
                        a.status.includes('429') ? c.yellow : c.dim;
                log(`  ${c.dim}${a.time}${c.reset}  ${a.model.padEnd(25)} ${a.tokens.padStart(6)}  ${statusColor}${a.status}${c.reset}`);
            });
        }
        log('');
    } catch (err) {
        fail(`Cannot reach proxy: ${err.message}`);
    }
}

// ─── Scan Command ───────────────────────────────────────
async function scan() {
    header('Agent Waste Scanner');
    log(`${c.dim}Scanning local agent logs for waste patterns...${c.reset}\n`);

    const logFiles = findLogFiles();

    if (logFiles.length === 0) {
        warn('No agent log files found.');
        info('Looked in:');
        log(`  ${c.dim}~/.openclaw/logs/*.jsonl${c.reset}`);
        log(`  ${c.dim}~/.openclaw/gateway.log${c.reset}`);
        log(`  ${c.dim}~/.claude/transcripts/**/*.jsonl${c.reset}`);
        log('');

        // Fall back to proxy stats if available
        info('Checking proxy stats instead...');
        try {
            const stats = await httpGet(PROXY_API);
            if (stats && stats.totalRequests > 0) {
                log('');
                log(`  ${c.bold}Proxy Data:${c.reset}`);
                log(`  Total requests proxied:  ${c.bold}${stats.totalRequests}${c.reset}`);
                log(`  Money saved by caching:  ${c.green}$${stats.savedMoney?.toFixed(4) || '0.0000'}${c.reset}`);
                log(`  Tokens saved:            ${c.green}${(stats.savedTokens || 0).toLocaleString()}${c.reset}`);
                log(`  Loops blocked:           ${c.red}${stats.blockedLoops || 0}${c.reset}`);
                log('');

                if (stats.blockedLoops > 0) {
                    const estimatedLoopWaste = stats.blockedLoops * 50000; // ~50k tokens per loop
                    const loopCostEstimate = (estimatedLoopWaste / 1_000_000) * 3.00; // ~$3/M tokens avg
                    log(`  ${c.bgRed}${c.white}${c.bold} 🚨 WASTE DETECTED ${c.reset}`);
                    log(`  ${c.red}${stats.blockedLoops} agent loops${c.reset} were caught and killed.`);
                    log(`  Estimated waste prevented: ${c.yellow}~$${loopCostEstimate.toFixed(2)}${c.reset}`);
                    log('');
                }

                if (stats.savedTokens > 0) {
                    log(`  ${c.green}${c.bold}✓ Prompt caching is active${c.reset}`);
                    log(`  ${c.dim}${(stats.savedTokens || 0).toLocaleString()} tokens served from cache${c.reset}`);
                } else {
                    warn('No cache hits yet — send more requests to build up cache.');
                }
                log('');
            } else {
                info('No proxy data yet. Route some agent traffic through the firewall first.');
                log(`  ${c.dim}Run: npx agent-firewall setup${c.reset}\n`);
            }
        } catch {
            info('Proxy not reachable. Run `npx agent-firewall setup` first.\n');
        }
        return;
    }

    // Analyze each log file
    info(`Found ${c.bold}${logFiles.length}${c.reset} log file(s)\n`);

    let totalTokens = 0;
    let totalRepeats = 0;
    let totalToolFailures = 0;
    let totalLoops = 0;
    let totalWasteTokens = 0;
    const allModels = {};

    for (const file of logFiles) {
        const result = analyzeLogFile(file);
        const basename = path.basename(file);

        log(`  ${c.bold}${basename}${c.reset} ${c.dim}(${result.totalLines} entries)${c.reset}`);

        if (result.repeatedPrompts > 0) {
            log(`    ${c.red}✗${c.reset} ${result.repeatedPrompts} repeated prompts (context re-sends)`);
        }
        if (result.toolFailures > 0) {
            log(`    ${c.red}✗${c.reset} ${result.toolFailures} tool failures`);
        }
        if (result.retryLoops > 0) {
            log(`    ${c.red}✗${c.reset} ${result.retryLoops} retry loops (3+ consecutive identical errors)`);
        }
        if (result.repeatedPrompts === 0 && result.toolFailures === 0) {
            log(`    ${c.green}✓${c.reset} Clean — no waste detected`);
        }

        totalTokens += result.totalTokens;
        totalRepeats += result.repeatedPrompts;
        totalToolFailures += result.toolFailures;
        totalLoops += result.retryLoops;
        totalWasteTokens += result.estimatedWaste;

        for (const [model, count] of Object.entries(result.models)) {
            allModels[model] = (allModels[model] || 0) + count;
        }
    }

    // Summary
    log('');
    log(`  ${c.bold}─── Summary ───${c.reset}`);
    log(`  Total tokens processed:  ${c.bold}${totalTokens.toLocaleString()}${c.reset}`);
    log(`  Repeated prompts:        ${totalRepeats > 0 ? c.red : c.green}${totalRepeats}${c.reset}`);
    log(`  Tool failures:           ${totalToolFailures > 0 ? c.yellow : c.green}${totalToolFailures}${c.reset}`);
    log(`  Retry loops:             ${totalLoops > 0 ? c.red : c.green}${totalLoops}${c.reset}`);

    if (totalWasteTokens > 0) {
        const wasteCost = (totalWasteTokens / 1_000_000) * 3.00;
        log('');
        log(`  ${c.bgRed}${c.white}${c.bold} 🚨 ESTIMATED WASTE: ~${totalWasteTokens.toLocaleString()} tokens (~$${wasteCost.toFixed(2)}) ${c.reset}`);
        log('');
        log(`  ${c.green}✓${c.reset} Install the Agentic Firewall to prevent this automatically.`);
        log(`    ${c.dim}Run: npx agent-firewall setup${c.reset}`);
    } else {
        log('');
        ok('No significant waste detected. Your agents are running efficiently!');
    }

    // Model breakdown
    if (Object.keys(allModels).length > 0) {
        log(`\n  ${c.bold}Models Used:${c.reset}`);
        for (const [model, count] of Object.entries(allModels).sort((a, b) => b[1] - a[1])) {
            log(`    ${model.padEnd(30)} ${c.dim}${count} calls${c.reset}`);
        }
    }

    log('');
}

// ─── Verify Command ─────────────────────────────────────
async function verify() {
    header('Agent Runtime Control — Verify');

    const openaiBase = process.env.OPENAI_BASE_URL || 'not set';
    const anthropicBase = process.env.ANTHROPIC_BASE_URL || 'not set';

    log(`  OPENAI_BASE_URL:    ${openaiBase.includes('jockeyvc') ? c.green : c.red}${openaiBase}${c.reset}`);
    log(`  ANTHROPIC_BASE_URL: ${anthropicBase.includes('jockeyvc') ? c.green : c.red}${anthropicBase}${c.reset}`);
    log('');

    info('Testing proxy connection...');
    try {
        const stats = await httpGet(PROXY_API);
        ok(`Proxy is live (${stats.totalRequests} requests processed)`);
    } catch (err) {
        fail(`Proxy unreachable: ${err.message}`);
        return;
    }

    // Check OpenClaw
    const openclawConfig = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(openclawConfig)) {
        try {
            const config = JSON.parse(fs.readFileSync(openclawConfig, 'utf-8'));
            const baseUrl = config?.models?.providers?.openai?.baseUrl || 'not configured';
            if (baseUrl.includes('jockeyvc')) {
                ok(`OpenClaw: ${c.green}${baseUrl}${c.reset}`);
            } else {
                warn(`OpenClaw: ${c.yellow}${baseUrl}${c.reset} — not routing through proxy`);
            }
        } catch { /* ignore */ }
    }

    // Check Claude Code
    const claudeConfig = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(claudeConfig)) {
        ok(`Claude Code config found at ${c.dim}${claudeConfig}${c.reset}`);
    }

    log('');
}

// ─── Main ───────────────────────────────────────────────
const command = process.argv[2] || 'setup';

switch (command) {
    case 'setup':
        setup().catch(err => fail(err.message));
        break;
    case 'status':
        status().catch(err => fail(err.message));
        break;
    case 'scan':
        scan().catch(err => fail(err.message));
        break;
    case 'verify':
        verify().catch(err => fail(err.message));
        break;
    case '--help':
    case '-h':
        header('Agent Runtime Control');
        log('  Keep autonomous AI agents under control.\n');
        log('  Usage: npx agent-firewall <command>\n');
        log('  Commands:');
        log('    setup     Auto-detect agents, patch configs, verify connection');
        log('    scan      Scan agent logs for waste (loops, retries, re-reads)');
        log('    status    Check live proxy stats (requests, savings, blocked loops)');
        log('    verify    Test that routing is working');
        log('');
        log('  What it does:');
        log('    • Loop detection — kills stuck agents before they burn tokens');
        log('    • Prompt caching — reduces repeat context costs by up to 90%');
        log('    • Budget control — cap spend per session');
        log('    • Waste scanning — find and eliminate hidden agent waste');
        log('');
        break;
    default:
        fail(`Unknown command: ${command}`);
        log(`Run ${c.bold}npx agent-firewall --help${c.reset} to see available commands.`);
}
