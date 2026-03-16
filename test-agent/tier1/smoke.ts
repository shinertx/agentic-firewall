import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type Status = 'PASS' | 'FAIL' | 'SKIP';

type CheckResult = {
    name: string;
    status: Status;
    detail: string;
    durationMs?: number;
};

type FirewallStats = {
    totalRequests?: number;
};

const FIREWALL_BASE_URL = stripTrailingSlash(process.env.FIREWALL_BASE_URL || 'http://127.0.0.1:4000');
const FIREWALL_OPENAI_BASE_URL = stripTrailingSlash(process.env.FIREWALL_OPENAI_BASE_URL || `${FIREWALL_BASE_URL}/v1`);
const OPENCLAW_ANTHROPIC_AGENT = process.env.OPENCLAW_ANTHROPIC_AGENT || 'main';
const OPENCLAW_OPENAI_AGENT = process.env.OPENCLAW_OPENAI_AGENT || 'openai-smoke';

function stripTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function formatResult(result: CheckResult): string {
    const duration = result.durationMs === undefined ? '' : ` (${result.durationMs}ms)`;
    return `${result.status.padEnd(4)} ${result.name}${duration}: ${result.detail}`;
}

function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    return !['0', 'false', 'no'].includes(value.toLowerCase());
}

async function getFirewallStats(): Promise<FirewallStats> {
    const response = await fetch(`${FIREWALL_BASE_URL}/api/stats`);
    if (!response.ok) {
        throw new Error(`stats returned ${response.status}`);
    }
    return response.json() as Promise<FirewallStats>;
}

async function withProxyRequestDelta(fn: () => Promise<string>): Promise<string> {
    const before = await getFirewallStats();
    const detail = await fn();
    const after = await getFirewallStats();
    const requestDelta = (after.totalRequests || 0) - (before.totalRequests || 0);

    if (requestDelta < 1) {
        throw new Error('proxy request count did not increase');
    }

    return `${detail} (+${requestDelta} proxied request${requestDelta === 1 ? '' : 's'})`;
}

async function timeCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
        const detail = await fn();
        return { name, status: 'PASS', detail, durationMs: Date.now() - startedAt };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { name, status: 'FAIL', detail: message, durationMs: Date.now() - startedAt };
    }
}

async function checkProxyHealth(): Promise<CheckResult> {
    return timeCheck('proxy-health', async () => {
        const response = await fetch(`${FIREWALL_BASE_URL}/health`);
        if (!response.ok) {
            throw new Error(`health returned ${response.status}`);
        }
        const body = await response.text();
        return body.trim() || 'healthy';
    });
}

async function checkAnthropicSdk(): Promise<CheckResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return { name: 'anthropic-sdk', status: 'SKIP', detail: 'ANTHROPIC_API_KEY not set' };
    }

    return timeCheck('anthropic-sdk', async () => {
        return withProxyRequestDelta(async () => {
            const client = new Anthropic({
                apiKey,
                baseURL: FIREWALL_BASE_URL,
            });

            const response = await client.messages.create({
                model: process.env.TIER1_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
                max_tokens: 24,
                messages: [{ role: 'user', content: 'Reply with the single word ok' }],
            });

            const text = response.content[0]?.type === 'text' ? response.content[0].text : '(non-text response)';
            return `${response.model} -> ${JSON.stringify(text)}`;
        });
    });
}

async function checkOpenAIChat(): Promise<CheckResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { name: 'openai-chat', status: 'SKIP', detail: 'OPENAI_API_KEY not set' };
    }

    return timeCheck('openai-chat', async () => {
        return withProxyRequestDelta(async () => {
            const client = new OpenAI({
                apiKey,
                baseURL: FIREWALL_OPENAI_BASE_URL,
            });

            const response = await client.chat.completions.create({
                model: process.env.TIER1_OPENAI_MODEL || 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Reply with the single word ok' }],
                max_completion_tokens: 24,
            });

            const text = response.choices[0]?.message?.content || '(empty response)';
            return `${response.model} -> ${JSON.stringify(text)}`;
        });
    });
}

async function checkOpenAIResponses(): Promise<CheckResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { name: 'openai-responses', status: 'SKIP', detail: 'OPENAI_API_KEY not set' };
    }

    return timeCheck('openai-responses', async () => {
        return withProxyRequestDelta(async () => {
            const client = new OpenAI({
                apiKey,
                baseURL: FIREWALL_OPENAI_BASE_URL,
            });

            const response = await client.responses.create({
                model: process.env.TIER1_OPENAI_MODEL || 'gpt-4o-mini',
                input: 'Reply with the single word ok',
                max_output_tokens: 24,
            });

            return `${response.model} -> ${JSON.stringify(response.output_text || '(empty response)')}`;
        });
    });
}

function getOpenClawCommand(): { command: string; args: string[] } | null {
    const explicit = process.env.OPENCLAW_BIN;
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            throw new Error(`OPENCLAW_BIN does not exist: ${explicit}`);
        }
        if (explicit.endsWith('.js')) {
            return { command: process.execPath, args: [explicit] };
        }
        return { command: explicit, args: [] };
    }

    try {
        const { stdout } = requireCommand('which', ['openclaw']);
        const resolved = stdout.trim();
        if (resolved) {
            return { command: resolved, args: [] };
        }
    } catch {
        // Fall through to the npm cache lookup.
    }

    const npxRoot = path.join(os.homedir(), '.npm', '_npx');
    if (!fs.existsSync(npxRoot)) return null;

    const candidates = fs.readdirSync(npxRoot)
        .map(entry => path.join(npxRoot, entry, 'node_modules', 'openclaw', 'dist', 'index.js'))
        .filter(candidate => fs.existsSync(candidate))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (candidates.length === 0) return null;
    return { command: process.execPath, args: [candidates[0]] };
}

function requireCommand(command: string, args: string[]): { stdout: string; stderr: string } {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || `${command} exited with ${result.status}`);
    }

    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

async function runOpenClawAgent(agentId: string, env: NodeJS.ProcessEnv): Promise<any> {
    const openclaw = getOpenClawCommand();
    if (!openclaw) {
        throw new Error('OpenClaw binary not found');
    }

    const { stdout } = await execFileAsync(openclaw.command, [
        ...openclaw.args,
        'agent',
        '--local',
        '--agent',
        agentId,
        '--message',
        'Reply with the single word ok',
        '--json',
    ], {
        env,
        maxBuffer: 10 * 1024 * 1024,
    });

    return JSON.parse(stdout);
}

async function listOpenClawAgents(): Promise<string[]> {
    const openclaw = getOpenClawCommand();
    if (!openclaw) return [];

    const { stdout } = await execFileAsync(openclaw.command, [
        ...openclaw.args,
        'agents',
        'list',
        '--json',
    ], {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
    });

    const parsed = JSON.parse(stdout) as Array<{ id?: string }> | { agents?: { list?: Array<{ id?: string }> } };
    const agents = Array.isArray(parsed) ? parsed : parsed.agents?.list || [];
    return agents.map(agent => agent.id).filter((value): value is string => Boolean(value));
}

async function checkOpenClawAnthropic(): Promise<CheckResult> {
    if (!isTruthy(process.env.TIER1_RUN_OPENCLAW ?? '1')) {
        return { name: 'openclaw-anthropic', status: 'SKIP', detail: 'TIER1_RUN_OPENCLAW disabled' };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return { name: 'openclaw-anthropic', status: 'SKIP', detail: 'ANTHROPIC_API_KEY not set' };
    }
    const agents = await listOpenClawAgents();
    if (!agents.includes(OPENCLAW_ANTHROPIC_AGENT)) {
        return { name: 'openclaw-anthropic', status: 'SKIP', detail: `agent ${OPENCLAW_ANTHROPIC_AGENT} not found` };
    }

    return timeCheck('openclaw-anthropic', async () => {
        return withProxyRequestDelta(async () => {
            const payload = await runOpenClawAgent(OPENCLAW_ANTHROPIC_AGENT, {
                ...process.env,
                ANTHROPIC_API_KEY: apiKey,
                ANTHROPIC_BASE_URL: FIREWALL_BASE_URL,
                OPENAI_BASE_URL: FIREWALL_OPENAI_BASE_URL,
            });

            const text = payload.payloads?.[0]?.text || '(empty response)';
            const model = payload.meta?.agentMeta?.model || 'unknown-model';
            return `${model} -> ${JSON.stringify(text)}`;
        });
    });
}

async function checkOpenClawOpenAI(): Promise<CheckResult> {
    if (!isTruthy(process.env.TIER1_RUN_OPENCLAW ?? '1')) {
        return { name: 'openclaw-openai', status: 'SKIP', detail: 'TIER1_RUN_OPENCLAW disabled' };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { name: 'openclaw-openai', status: 'SKIP', detail: 'OPENAI_API_KEY not set' };
    }
    const agents = await listOpenClawAgents();
    if (!agents.includes(OPENCLAW_OPENAI_AGENT)) {
        return {
            name: 'openclaw-openai',
            status: 'SKIP',
            detail: `agent ${OPENCLAW_OPENAI_AGENT} not found (set OPENCLAW_OPENAI_AGENT to an OpenAI-backed agent)`,
        };
    }

    return timeCheck('openclaw-openai', async () => {
        return withProxyRequestDelta(async () => {
            const payload = await runOpenClawAgent(OPENCLAW_OPENAI_AGENT, {
                ...process.env,
                OPENAI_API_KEY: apiKey,
                OPENAI_BASE_URL: FIREWALL_OPENAI_BASE_URL,
                ANTHROPIC_BASE_URL: FIREWALL_BASE_URL,
            });

            const text = payload.payloads?.[0]?.text || '(empty response)';
            const model = payload.meta?.agentMeta?.model || 'unknown-model';
            return `${model} -> ${JSON.stringify(text)}`;
        });
    });
}

async function main() {
    const results = [
        await checkProxyHealth(),
        await checkAnthropicSdk(),
        await checkOpenAIChat(),
        await checkOpenAIResponses(),
        await checkOpenClawAnthropic(),
        await checkOpenClawOpenAI(),
    ];

    console.log('');
    console.log('Tier 1 compatibility results');
    console.log(`Proxy: ${FIREWALL_BASE_URL}`);
    for (const result of results) {
        console.log(formatResult(result));
    }

    const failures = results.filter(result => result.status === 'FAIL');
    if (failures.length > 0) {
        process.exit(1);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
