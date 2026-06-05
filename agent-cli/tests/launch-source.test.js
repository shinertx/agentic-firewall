const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeLaunchSource,
    getLaunchSource,
} = require('../bin/cli.js');

test('normalizes launch source values for telemetry attribution', () => {
    assert.equal(normalizeLaunchSource(' HN '), 'hn');
    assert.equal(normalizeLaunchSource('utm_source=Reddit / r-ClaudeAI'), 'reddit-r-claudeai');
    assert.equal(normalizeLaunchSource('Launch.Source_1'), 'launch.source_1');
    assert.equal(normalizeLaunchSource('---'), '');
});

test('prefers environment launch source over argv source', () => {
    const originalSource = process.env.VIBE_BILLING_SOURCE;
    process.env.VIBE_BILLING_SOURCE = 'LinkedIn';

    try {
        assert.equal(getLaunchSource(['node', 'cli', 'scan', '--source=hn']), 'linkedin');
    } finally {
        if (originalSource === undefined) {
            delete process.env.VIBE_BILLING_SOURCE;
        } else {
            process.env.VIBE_BILLING_SOURCE = originalSource;
        }
    }
});

test('reads launch source from supported CLI flags', () => {
    delete process.env.VIBE_BILLING_SOURCE;
    delete process.env.VIBEBILLING_SOURCE;

    assert.equal(getLaunchSource(['node', 'cli', 'scan', '--source=hn']), 'hn');
    assert.equal(getLaunchSource(['node', 'cli', 'scan', '--utm-source=reddit']), 'reddit');
    assert.equal(getLaunchSource(['node', 'cli', 'scan']), 'direct');
});
