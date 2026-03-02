import { describe, it, expect } from 'vitest';
import { getInputCost, CACHE_SAVINGS_RATE, DEFAULT_COST_PER_MILLION_TOKENS } from '../src/pricing';

describe('Pricing Module', () => {

    it('should return correct cost for Claude Sonnet', () => {
        expect(getInputCost('claude-sonnet-4-6')).toBe(3.00);
    });

    it('should return correct cost for Claude Haiku', () => {
        expect(getInputCost('claude-haiku-4-5')).toBe(0.80);
    });

    it('should return correct cost for Claude Opus', () => {
        expect(getInputCost('claude-opus-4-6')).toBe(15.00);
    });

    it('should return correct cost for GPT-4o', () => {
        expect(getInputCost('gpt-4o')).toBe(2.50);
    });

    it('should return correct cost for GPT-4o Mini', () => {
        expect(getInputCost('gpt-4o-mini')).toBe(0.15);
    });

    it('should return correct cost for GPT-4 (original, expensive)', () => {
        expect(getInputCost('gpt-4-0613')).toBe(30.00);
    });

    it('should NOT match gpt-4o to the gpt-4 legacy tier', () => {
        expect(getInputCost('gpt-4o')).toBe(2.50);
        expect(getInputCost('gpt-4o')).not.toBe(30.00);
    });

    it('should return correct cost for OpenAI o1', () => {
        expect(getInputCost('o1-preview')).toBe(15.00);
    });

    it('should return correct cost for OpenAI o3', () => {
        expect(getInputCost('o3-mini')).toBe(15.00);
    });

    it('should return default cost for unknown models', () => {
        expect(getInputCost('some-unknown-model')).toBe(DEFAULT_COST_PER_MILLION_TOKENS);
    });

    it('should have CACHE_SAVINGS_RATE at 90%', () => {
        expect(CACHE_SAVINGS_RATE).toBe(0.90);
    });

    it('should be case-insensitive', () => {
        expect(getInputCost('Claude-Sonnet-4-6')).toBe(3.00);
        expect(getInputCost('GPT-4O')).toBe(2.50);
    });
});
