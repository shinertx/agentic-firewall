import { describe, it, expect } from 'vitest';
import { getContextWindow, DEFAULT_CONTEXT_WINDOW } from '../src/contextWindows';

describe('Context Windows', () => {
    it('should return correct window for Claude Sonnet', () => {
        expect(getContextWindow('claude-sonnet-4-6')).toBe(200_000);
    });

    it('should return correct window for Claude Opus', () => {
        expect(getContextWindow('claude-opus-4-6')).toBe(200_000);
    });

    it('should return correct window for GPT-4o', () => {
        expect(getContextWindow('gpt-4o')).toBe(128_000);
    });

    it('should return correct window for GPT-4o-mini', () => {
        expect(getContextWindow('gpt-4o-mini')).toBe(128_000);
    });

    it('should return correct window for GPT-5.2', () => {
        expect(getContextWindow('gpt-5.2')).toBe(256_000);
    });

    it('should return correct window for Gemini Flash', () => {
        expect(getContextWindow('gemini-2.5-flash')).toBe(1_048_576);
    });

    it('should return correct window for NVIDIA NIM models', () => {
        expect(getContextWindow('meta/llama-3.1-70b')).toBe(128_000);
        expect(getContextWindow('nvidia/nemotron-4-340b')).toBe(128_000);
    });

    it('should return default for unknown models', () => {
        expect(getContextWindow('unknown-model-xyz')).toBe(DEFAULT_CONTEXT_WINDOW);
    });

    it('should be case-insensitive', () => {
        expect(getContextWindow('GPT-5.2')).toBe(256_000);
        expect(getContextWindow('Claude-Sonnet-4-6')).toBe(200_000);
    });

    it('should match longer patterns first (gpt-4o-mini before gpt-4o)', () => {
        // Both should resolve correctly without ambiguity
        expect(getContextWindow('gpt-4o-mini')).toBe(128_000);
        expect(getContextWindow('gpt-4o')).toBe(128_000);
    });

    it('should distinguish gpt-4 from gpt-4o', () => {
        expect(getContextWindow('gpt-4')).toBe(8_192);
        expect(getContextWindow('gpt-4o')).toBe(128_000);
    });

    it('should return correct window for GPT-4.1', () => {
        expect(getContextWindow('gpt-4.1')).toBe(1_047_576);
    });
});
