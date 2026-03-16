const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    getOpenClawBaseUrlOverrides,
    summarizeOpenClawBaseUrlOverrides,
    getProviderBaseUrl,
} = require('../bin/cli.js');

function writeAuthProfiles(homeDir, agentId, profiles) {
    const authProfilePath = path.join(homeDir, '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json');
    fs.mkdirSync(path.dirname(authProfilePath), { recursive: true });
    fs.writeFileSync(authProfilePath, JSON.stringify(profiles, null, 2));
}

test('finds custom OpenClaw baseURL overrides from auth profiles', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-billing-oc-'));

    writeAuthProfiles(homeDir, 'main', {
        anthropic: { apiKey: 'test-anthropic-key', baseURL: 'http://127.0.0.1:4000' },
    });
    writeAuthProfiles(homeDir, 'openai-smoke', {
        openai: { apiKey: 'test-openai-key', baseURL: getProviderBaseUrl('openai') },
    });

    const overrides = getOpenClawBaseUrlOverrides(null, homeDir);
    assert.equal(overrides.length, 2);

    assert.deepEqual(
        overrides.map((override) => ({
            agentId: override.agentId,
            provider: override.provider,
            baseUrl: override.baseUrl,
            matchesExpected: override.matchesExpected,
        })),
        [
            {
                agentId: 'main',
                provider: 'anthropic',
                baseUrl: 'http://127.0.0.1:4000',
                matchesExpected: false,
            },
            {
                agentId: 'openai-smoke',
                provider: 'openai',
                baseUrl: getProviderBaseUrl('openai'),
                matchesExpected: true,
            },
        ],
    );
});

test('summarizes OpenClaw baseURL overrides for doctor and uninstall messages', () => {
    const summary = summarizeOpenClawBaseUrlOverrides([
        { provider: 'anthropic', agentId: 'main', baseUrl: 'http://127.0.0.1:4000' },
        { provider: 'openai', agentId: 'openai-smoke', baseUrl: 'https://api.jockeyvc.com/v1' },
        { provider: 'openai', agentId: 'secondary', baseUrl: 'https://example.com/v1' },
    ]);

    assert.equal(
        summary,
        'anthropic/main -> http://127.0.0.1:4000; openai/openai-smoke -> https://api.jockeyvc.com/v1 (+1 more)',
    );
});
