/**
 * LLM provider registry.
 * Returns a configured provider based on environment variables.
 */

import type { LLMProvider } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';

export type { LLMProvider, ChatParams, StreamEvent, ChatResponse, Message, ContentBlock, TextBlock, ImageBlock, ToolUseBlock, ToolResultBlock, Tool, JsonSchema } from './types.js';
export { collectStream } from './types.js';

let cachedProvider: LLMProvider | null = null;

/**
 * Get the configured LLM provider. Cached after first call.
 */
export function getProvider(): LLMProvider {
	if (cachedProvider) return cachedProvider;

	const providerId = process.env.LLM_PROVIDER || 'anthropic';
	const apiKey = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;

	if (!apiKey) {
		throw new Error(`No API key configured. Set LLM_API_KEY or ANTHROPIC_API_KEY.`);
	}

	switch (providerId) {
		case 'anthropic':
			cachedProvider = new AnthropicProvider(apiKey);
			break;
		// Future: case 'openai': cachedProvider = new OpenAIProvider(apiKey); break;
		// Future: case 'google': cachedProvider = new GoogleProvider(apiKey); break;
		default:
			throw new Error(`Unknown LLM provider: ${providerId}. Supported: anthropic`);
	}

	return cachedProvider;
}

/**
 * Get the model alias for "strong" tasks (planning, complex reasoning).
 */
export function getStrongModel(): string {
	return process.env.LLM_MODEL_STRONG || 'sonnet';
}

/**
 * Get the model alias for "fast" tasks (data reads, navigation).
 */
export function getFastModel(): string {
	return process.env.LLM_MODEL_FAST || 'haiku';
}
