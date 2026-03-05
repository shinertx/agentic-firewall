/**
 * Environment Detector — classifies install/telemetry sources as
 * real users, CI/CD pipelines, bots, or unknown.
 */

import type { TelemetryEvent } from './installTracker';

export type EnvironmentType = 'user' | 'ci' | 'bot' | 'unknown';

const CI_UA_PATTERNS = [
    'github-actions', 'gitlab-runner', 'jenkins', 'circleci',
    'buildkite', 'drone', 'travis', 'teamcity', 'azure-pipelines',
    'bitbucket-pipelines', 'codebuild',
];

const BOT_UA_PATTERNS = [
    'bot', 'crawler', 'spider', 'headless', 'puppeteer',
    'selenium', 'playwright', 'phantomjs', 'wget', 'curl/',
];

// CI environment variables that indicate the event came from a CI system
const CI_ENV_SIGNALS = [
    'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'CIRCLECI',
    'BUILDKITE', 'DRONE', 'TRAVIS', 'TEAMCITY_VERSION', 'TF_BUILD',
    'BITBUCKET_PIPELINE_UUID', 'CODEBUILD_BUILD_ID',
];

/**
 * Classify the source environment of a telemetry event.
 *
 * Priority: CI > Bot > Unknown > User (default)
 */
export function classifyEnvironment(
    event: Partial<TelemetryEvent> | null,
    userAgent: string = '',
): EnvironmentType {
    const ua = userAgent.toLowerCase();

    // 1. Check User-Agent for CI patterns
    if (CI_UA_PATTERNS.some(p => ua.includes(p))) return 'ci';

    // 2. Check User-Agent for bot patterns
    if (BOT_UA_PATTERNS.some(p => ua.includes(p))) return 'bot';

    // 3. Empty or very short User-Agent = likely bot
    if (!ua || ua.length < 5) return 'bot';

    // 4. If event has no platform/arch/node metadata, it's likely not a real CLI install
    if (event) {
        const hasPlatform = !!event.platform;
        const hasArch = !!event.arch;
        const hasNode = !!event.node;
        if (!hasPlatform && !hasArch && !hasNode) return 'unknown';
    }

    // 5. Default: real user
    return 'user';
}

/**
 * Server-side detection: checks if common CI env vars are present in the
 * telemetry payload's extra fields. The CLI can optionally send these.
 */
export function detectCIFromEnvHints(envHints: Record<string, string> | undefined): boolean {
    if (!envHints) return false;
    return CI_ENV_SIGNALS.some(key => key in envHints && envHints[key] !== '');
}
