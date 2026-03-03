"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pricing_1 = require("../src/pricing");
(0, vitest_1.describe)('Pricing Module', () => {
    // === GPT-5 series ===
    (0, vitest_1.it)('should return GPT-5.2 Pro pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-5.2-pro')).toBe(21.00);
    });
    (0, vitest_1.it)('should return GPT-5.2 pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-5.2')).toBe(1.75);
    });
    (0, vitest_1.it)('should return GPT-5 mini pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-5-mini')).toBe(0.25);
    });
    (0, vitest_1.it)('should return generic GPT-5 pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-5')).toBe(1.75);
    });
    // === Claude 4 series ===
    (0, vitest_1.it)('should return Claude Sonnet pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('claude-sonnet-4-6')).toBe(3.00);
    });
    (0, vitest_1.it)('should return Claude Haiku pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('claude-haiku-4-5')).toBe(1.00);
    });
    (0, vitest_1.it)('should return Claude Opus pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('claude-opus-4-6')).toBe(5.00);
    });
    // === GPT-4 series (legacy) ===
    (0, vitest_1.it)('should return GPT-4o-mini pricing (budget, not GPT-4o)', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-4o-mini')).toBe(0.15);
    });
    (0, vitest_1.it)('should return GPT-4o pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('gpt-4o')).toBe(2.50);
    });
    // === Reasoning models ===
    (0, vitest_1.it)('should return o3-mini pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('o3-mini')).toBe(1.10);
    });
    (0, vitest_1.it)('should return o3 pricing', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('o3')).toBe(10.00);
    });
    // === Edge cases ===
    (0, vitest_1.it)('should return default cost for unknown models', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('totally-unknown-model-xyz')).toBe(pricing_1.DEFAULT_COST_PER_MILLION_TOKENS);
    });
    (0, vitest_1.it)('should be case-insensitive', () => {
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('GPT-5.2')).toBe(1.75);
        (0, vitest_1.expect)((0, pricing_1.getInputCost)('CLAUDE-SONNET-4-6')).toBe(3.00);
    });
    // === Constants ===
    (0, vitest_1.it)('should export CACHE_SAVINGS_RATE as 0.90', () => {
        (0, vitest_1.expect)(pricing_1.CACHE_SAVINGS_RATE).toBe(0.90);
    });
});
