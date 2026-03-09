import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('LLM provider registry', () => {
	beforeEach(() => {
		// Reset module cache between tests so getProvider() re-evaluates
		vi.resetModules();
	});

	it('throws when no API key is set', async () => {
		const origLLM = process.env.LLM_API_KEY;
		const origAnthropic = process.env.ANTHROPIC_API_KEY;
		process.env.LLM_API_KEY = '';
		process.env.ANTHROPIC_API_KEY = '';

		try {
			const { getProvider } = await import('./index.js');
			expect(() => getProvider()).toThrow('No API key configured');
		} finally {
			process.env.LLM_API_KEY = origLLM ?? '';
			process.env.ANTHROPIC_API_KEY = origAnthropic ?? '';
		}
	});

	it('throws for unknown provider', async () => {
		const origProvider = process.env.LLM_PROVIDER;
		const origKey = process.env.LLM_API_KEY;
		process.env.LLM_PROVIDER = 'unknown_provider';
		process.env.LLM_API_KEY = 'test-key';

		try {
			const { getProvider } = await import('./index.js');
			expect(() => getProvider()).toThrow('Unknown LLM provider');
		} finally {
			process.env.LLM_PROVIDER = origProvider ?? '';
			process.env.LLM_API_KEY = origKey ?? '';
		}
	});

	it('getStrongModel defaults to sonnet', async () => {
		const origModel = process.env.LLM_MODEL_STRONG;
		process.env.LLM_MODEL_STRONG = '';

		try {
			const { getStrongModel } = await import('./index.js');
			expect(getStrongModel()).toBe('sonnet');
		} finally {
			process.env.LLM_MODEL_STRONG = origModel ?? '';
		}
	});

	it('getStrongModel respects env override', async () => {
		const origModel = process.env.LLM_MODEL_STRONG;
		process.env.LLM_MODEL_STRONG = 'gpt-4o';

		try {
			const { getStrongModel } = await import('./index.js');
			expect(getStrongModel()).toBe('gpt-4o');
		} finally {
			process.env.LLM_MODEL_STRONG = origModel ?? '';
		}
	});

	it('getFastModel defaults to haiku', async () => {
		const origModel = process.env.LLM_MODEL_FAST;
		process.env.LLM_MODEL_FAST = '';

		try {
			const { getFastModel } = await import('./index.js');
			expect(getFastModel()).toBe('haiku');
		} finally {
			process.env.LLM_MODEL_FAST = origModel ?? '';
		}
	});
});
