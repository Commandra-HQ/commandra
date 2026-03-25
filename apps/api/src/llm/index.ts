/**
 * LLM provider registry.
 * Returns a configured provider based on environment variables.
 */

import { ANTHROPIC_MODEL_CAPABILITIES, AnthropicProvider } from './providers/anthropic.js';
import { OPENAI_MODEL_CAPABILITIES, OpenAIProvider } from './providers/openai.js';
import type { LLMProvider, ModelCapabilities } from './types.js';
import { DEFAULT_CAPABILITIES } from './types.js';

export type {
	LLMProvider,
	ChatParams,
	StreamEvent,
	ChatResponse,
	Message,
	ContentBlock,
	TextBlock,
	ImageBlock,
	ToolUseBlock,
	ToolResultBlock,
	Tool,
	JsonSchema,
	TokenUsage,
	ModelCapabilities,
} from './types.js';
export { collectStream, emptyTokenUsage, DEFAULT_CAPABILITIES } from './types.js';

/**
 * Get model capabilities for a given provider and model.
 * Looks up by alias (e.g. "sonnet") or full model ID.
 */
export function getModelCapabilities(providerName: string, model: string): ModelCapabilities {
	const capMap = providerName === 'anthropic'
		? ANTHROPIC_MODEL_CAPABILITIES
		: providerName === 'openai'
			? OPENAI_MODEL_CAPABILITIES
			: {};
	return capMap[model] ?? DEFAULT_CAPABILITIES;
}

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
		case 'openai':
			cachedProvider = new OpenAIProvider(apiKey);
			break;
		// Future: case 'google': cachedProvider = new GoogleProvider(apiKey); break;
		default:
			throw new Error(`Unknown LLM provider: ${providerId}. Supported: anthropic, openai`);
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
