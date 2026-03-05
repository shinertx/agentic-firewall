import { describe, it, expect } from 'vitest';
import { getInputCost, getOutputCost, DEFAULT_COST_PER_MILLION_TOKENS, DEFAULT_OUTPUT_COST_PER_MILLION_TOKENS, CACHE_SAVINGS_RATE, CACHE_READ_DISCOUNT, CACHE_CREATION_SURCHARGE } from '../src/pricing';

describe('Pricing Module', () => {

    // === GPT-5 series ===
    it('should return GPT-5.2 Pro pricing', () => {
        expect(getInputCost('gpt-5.2-pro')).toBe(21.00);
    });

    it('should return GPT-5.2 pricing', () => {
        expect(getInputCost('gpt-5.2')).toBe(1.75);
    });

    it('should return GPT-5 mini pricing', () => {
        expect(getInputCost('gpt-5-mini')).toBe(0.25);
    });

    it('should return generic GPT-5 pricing', () => {
        expect(getInputCost('gpt-5')).toBe(1.75);
    });

    // === Claude 4 series ===
    it('should return Claude Sonnet pricing', () => {
        expect(getInputCost('claude-sonnet-4-6')).toBe(3.00);
    });

    it('should return Claude Haiku pricing', () => {
        expect(getInputCost('claude-haiku-4-5')).toBe(0.80);
    });

    it('should return Claude Opus pricing', () => {
        expect(getInputCost('claude-opus-4-6')).toBe(15.00);
    });

    // === GPT-4 series (legacy) ===
    it('should return GPT-4o-mini pricing (budget, not GPT-4o)', () => {
        expect(getInputCost('gpt-4o-mini')).toBe(0.15);
    });

    it('should return GPT-4o pricing', () => {
        expect(getInputCost('gpt-4o')).toBe(2.50);
    });

    // === Reasoning models ===
    it('should return o3-mini pricing', () => {
        expect(getInputCost('o3-mini')).toBe(1.10);
    });

    it('should return o3 pricing', () => {
        expect(getInputCost('o3')).toBe(10.00);
    });

    // === Edge cases ===
    it('should return default cost for unknown models', () => {
        expect(getInputCost('totally-unknown-model-xyz')).toBe(DEFAULT_COST_PER_MILLION_TOKENS);
    });

    it('should be case-insensitive', () => {
        expect(getInputCost('GPT-5.2')).toBe(1.75);
        expect(getInputCost('CLAUDE-SONNET-4-6')).toBe(3.00);
    });

    // === Output pricing ===
    it('should return Claude Opus output pricing ($75/M)', () => {
        expect(getOutputCost('claude-opus-4-6')).toBe(75.00);
    });

    it('should return Claude Sonnet output pricing ($15/M)', () => {
        expect(getOutputCost('claude-sonnet-4-6')).toBe(15.00);
    });

    it('should return GPT-4o output pricing ($10/M)', () => {
        expect(getOutputCost('gpt-4o')).toBe(10.00);
    });

    it('should return default output cost for unknown models', () => {
        expect(getOutputCost('totally-unknown-model-xyz')).toBe(DEFAULT_OUTPUT_COST_PER_MILLION_TOKENS);
    });

    it('output cost should be higher than input cost for all major models', () => {
        const models = ['claude-opus-4-6', 'claude-sonnet-4-6', 'gpt-4o', 'gpt-5.2', 'gemini-2.5-pro'];
        for (const model of models) {
            expect(getOutputCost(model)).toBeGreaterThan(getInputCost(model));
        }
    });

    // === Constants ===
    it('should export CACHE_SAVINGS_RATE as 0.90', () => {
        expect(CACHE_SAVINGS_RATE).toBe(0.90);
    });

    it('should export cache pricing constants', () => {
        expect(CACHE_READ_DISCOUNT).toBe(0.90);
        expect(CACHE_CREATION_SURCHARGE).toBe(0.25);
    });
});
