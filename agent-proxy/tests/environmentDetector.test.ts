import { describe, it, expect } from 'vitest';
import { classifyEnvironment, detectCIFromEnvHints } from '../src/environmentDetector';

describe('Environment Detector', () => {
    describe('classifyEnvironment', () => {
        it('should classify GitHub Actions user-agent as ci', () => {
            expect(classifyEnvironment({}, 'github-actions/2.304.0')).toBe('ci');
        });

        it('should classify GitLab Runner user-agent as ci', () => {
            expect(classifyEnvironment({}, 'gitlab-runner/15.0')).toBe('ci');
        });

        it('should classify Jenkins user-agent as ci', () => {
            expect(classifyEnvironment({}, 'Jenkins/2.401.3')).toBe('ci');
        });

        it('should classify CircleCI user-agent as ci', () => {
            expect(classifyEnvironment({}, 'circleci-agent/1.0')).toBe('ci');
        });

        it('should classify Buildkite user-agent as ci', () => {
            expect(classifyEnvironment({}, 'buildkite-agent/3.0')).toBe('ci');
        });

        it('should classify bot user-agents as bot', () => {
            expect(classifyEnvironment({}, 'Googlebot/2.1')).toBe('bot');
            expect(classifyEnvironment({}, 'Mozilla/5.0 (compatible; bingbot)')).toBe('bot');
        });

        it('should classify headless browsers as bot', () => {
            expect(classifyEnvironment({}, 'HeadlessChrome/120.0')).toBe('bot');
            expect(classifyEnvironment({}, 'puppeteer-agent/1.0')).toBe('bot');
            expect(classifyEnvironment({}, 'selenium-webdriver/4.0')).toBe('bot');
        });

        it('should classify empty user-agent as bot', () => {
            expect(classifyEnvironment({}, '')).toBe('bot');
        });

        it('should classify very short user-agent as bot', () => {
            expect(classifyEnvironment({}, 'ab')).toBe('bot');
        });

        it('should classify curl/wget as bot', () => {
            expect(classifyEnvironment({}, 'curl/7.88.1')).toBe('bot');
            expect(classifyEnvironment({}, 'Wget/1.21')).toBe('bot');
        });

        it('should classify event without platform/arch/node as unknown', () => {
            expect(classifyEnvironment(
                { machineId: 'test', event: 'ping' },
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            )).toBe('unknown');
        });

        it('should classify normal user-agent with full event data as user', () => {
            expect(classifyEnvironment(
                { platform: 'darwin', arch: 'arm64', node: '20.11.0' },
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            )).toBe('user');
        });

        it('should classify node fetch user-agent with full event as user', () => {
            expect(classifyEnvironment(
                { platform: 'linux', arch: 'x64', node: '18.19.0' },
                'node-fetch/2.6.7',
            )).toBe('user');
        });

        it('should handle null event gracefully', () => {
            expect(classifyEnvironment(null, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('user');
        });

        it('should be case-insensitive for user-agent matching', () => {
            expect(classifyEnvironment({}, 'GITHUB-ACTIONS/2.0')).toBe('ci');
            expect(classifyEnvironment({}, 'GoogleBot/2.1')).toBe('bot');
        });

        it('should prioritize CI over bot signals', () => {
            // A CI agent that also looks like a bot
            expect(classifyEnvironment({}, 'github-actions-bot/1.0')).toBe('ci');
        });
    });

    describe('detectCIFromEnvHints', () => {
        it('should detect CI env var', () => {
            expect(detectCIFromEnvHints({ CI: 'true' })).toBe(true);
        });

        it('should detect GITHUB_ACTIONS env var', () => {
            expect(detectCIFromEnvHints({ GITHUB_ACTIONS: 'true' })).toBe(true);
        });

        it('should detect GITLAB_CI env var', () => {
            expect(detectCIFromEnvHints({ GITLAB_CI: 'true' })).toBe(true);
        });

        it('should return false for empty env hints', () => {
            expect(detectCIFromEnvHints({})).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(detectCIFromEnvHints(undefined)).toBe(false);
        });

        it('should ignore empty CI env values', () => {
            expect(detectCIFromEnvHints({ CI: '' })).toBe(false);
        });

        it('should detect multiple CI signals', () => {
            expect(detectCIFromEnvHints({ JENKINS_URL: 'http://jenkins:8080', CI: 'true' })).toBe(true);
        });
    });
});
