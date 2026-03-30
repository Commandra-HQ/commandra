/**
 * Anthropic provider adapter.
 * Translates our generic types ↔ Anthropic SDK types.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
	ChatParams,
	ContentBlock,
	LLMProvider,
	Message,
	ModelCapabilities,
	StreamEvent,
	TokenUsage,
	Tool,
} from '../types.js';

// Model aliases → actual Anthropic model IDs
const MODEL_MAP: Record<string, string> = {
	sonnet: 'claude-sonnet-4-20250514',
	haiku: 'claude-haiku-4-5-20251001',
	opus: 'claude-opus-4-20250514',
};

function resolveModel(model: string): string {
	return MODEL_MAP[model] || model;
}

export const ANTHROPIC_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
	haiku: {
		contextWindow: 200_000, maxOutputTokens: 8_192,
		defaultOutputBudget: 2_000, supportsThinking: true, defaultThinkingBudget: 1_000,
		costPer1kInput: 0.0008, costPer1kOutput: 0.004, charsPerToken: 4.2,
	},
	'claude-haiku-4-5-20251001': {
		contextWindow: 200_000, maxOutputTokens: 8_192,
		defaultOutputBudget: 2_000, supportsThinking: true, defaultThinkingBudget: 1_000,
		costPer1kInput: 0.0008, costPer1kOutput: 0.004, charsPerToken: 4.2,
	},
	sonnet: {
		contextWindow: 200_000, maxOutputTokens: 16_000,
		defaultOutputBudget: 8_000, supportsThinking: true, defaultThinkingBudget: 4_000,
		costPer1kInput: 0.003, costPer1kOutput: 0.015, charsPerToken: 4.2,
	},
	'claude-sonnet-4-20250514': {
		contextWindow: 200_000, maxOutputTokens: 16_000,
		defaultOutputBudget: 8_000, supportsThinking: true, defaultThinkingBudget: 4_000,
		costPer1kInput: 0.003, costPer1kOutput: 0.015, charsPerToken: 4.2,
	},
	opus: {
		contextWindow: 200_000, maxOutputTokens: 32_000,
		defaultOutputBudget: 16_000, supportsThinking: true, defaultThinkingBudget: 10_000,
		costPer1kInput: 0.015, costPer1kOutput: 0.075, charsPerToken: 4.2,
	},
	'claude-opus-4-20250514': {
		contextWindow: 200_000, maxOutputTokens: 32_000,
		defaultOutputBudget: 16_000, supportsThinking: true, defaultThinkingBudget: 10_000,
		costPer1kInput: 0.015, costPer1kOutput: 0.075, charsPerToken: 4.2,
	},
};

export class AnthropicProvider implements LLMProvider {
	id = 'anthropic';
	supportsVision = true;
	supportsToolUse = true;

	private client: Anthropic;

	constructor(apiKey: string) {
		this.client = new Anthropic({
			apiKey,
			defaultHeaders: {
				'anthropic-beta': 'files-api-2025-04-14',
			},
		});
	}

	async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
		// Build create params — conditionally add thinking
		// Use prompt caching for system prompt (static per domain session)
		const systemContent: Anthropic.TextBlockParam[] = [
			{
				type: 'text',
				text: params.system,
				cache_control: { type: 'ephemeral' },
			} as Anthropic.TextBlockParam,
		];

		const createParams: Record<string, unknown> = {
			model: resolveModel(params.model),
			max_tokens: params.maxTokens ?? 4096,
			system: systemContent,
			messages: toAnthropicMessages(params.messages),
			tools: params.tools ? toAnthropicTools(params.tools) : undefined,
			stream: true,
		};

		if (params.thinking) {
			createParams.thinking = {
				type: 'enabled',
				budget_tokens: params.thinking.budgetTokens,
			};
		}

		const response = await this.client.messages.create(
			createParams as unknown as Anthropic.MessageCreateParamsStreaming,
			params.signal ? { signal: params.signal } : undefined,
		);

		let currentBlockType: string | null = null;
		let currentToolId = '';
		let currentToolName = '';
		let toolJson = '';

		// Track usage across message_start (input) and message_delta (output)
		const usage: TokenUsage = {
			inputTokens: 0, outputTokens: 0,
			cacheReadTokens: 0, cacheWriteTokens: 0, thinkingTokens: 0,
		};

		for await (const event of response) {
			if (event.type === 'message_start') {
				const msg = (event as unknown as { message?: { usage?: Record<string, number> } }).message;
				if (msg?.usage) {
					usage.inputTokens = msg.usage.input_tokens ?? 0;
					usage.cacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
					usage.cacheWriteTokens = msg.usage.cache_creation_input_tokens ?? 0;
				}
			} else if (event.type === 'content_block_start') {
				const block = event.content_block as { type: string; id?: string; name?: string };
				console.log(`[Anthropic] content_block_start: type=${block.type}`);
				currentBlockType = block.type;
				if (block.type === 'tool_use') {
					currentToolId = block.id || '';
					currentToolName = block.name || '';
					toolJson = '';
					yield { type: 'tool_use_start', id: currentToolId, name: currentToolName };
				}
			} else if (event.type === 'content_block_delta') {
				const delta = event.delta as {
					type: string;
					text?: string;
					partial_json?: string;
					thinking?: string;
					signature?: string;
				};
				if (delta.type === 'text_delta') {
					yield { type: 'text', text: delta.text || '' };
				} else if (delta.type === 'input_json_delta') {
					toolJson += delta.partial_json || '';
					yield {
						type: 'tool_use_delta',
						id: currentToolId,
						partialJson: delta.partial_json || '',
					};
				} else if (delta.type === 'thinking_delta') {
					yield { type: 'thinking_delta', text: delta.thinking || '' };
				} else if (delta.type === 'signature_delta') {
					yield { type: 'thinking_signature', signature: delta.signature || '' };
				}
			} else if (event.type === 'content_block_stop') {
				if (currentBlockType === 'tool_use' && currentToolId) {
					let input: Record<string, unknown> = {};
					try {
						input = JSON.parse(toolJson || '{}');
					} catch {
						/* empty */
					}
					yield { type: 'tool_use_end', id: currentToolId, name: currentToolName, input };
					currentToolId = '';
					currentToolName = '';
					toolJson = '';
				}
				currentBlockType = null;
			} else if (event.type === 'message_delta') {
				// Capture final output token count from message_delta usage
				const deltaUsage = (event as unknown as { usage?: Record<string, number> }).usage;
				if (deltaUsage) {
					usage.outputTokens = deltaUsage.output_tokens ?? 0;
				}
				const reason = (event.delta as { stop_reason?: string }).stop_reason;
				yield {
					type: 'message_end',
					stopReason:
						reason === 'tool_use'
							? 'tool_use'
							: reason === 'max_tokens'
								? 'max_tokens'
								: 'end_turn',
				};
				// Emit real usage data after message_end
				yield { type: 'usage', usage };
			}
		}
	}
	/**
	 * Free token counting via Anthropic's /v1/messages/count_tokens endpoint.
	 * Use for pre-flight budget checks when context is >60%.
	 */
	async countTokens(params: {
		model: string;
		system: string;
		messages: import('../types.js').Message[];
		tools?: import('../types.js').Tool[];
	}): Promise<number> {
		const result = await this.client.messages.countTokens({
			model: resolveModel(params.model),
			system: [{ type: 'text', text: params.system }],
			messages: toAnthropicMessages(params.messages),
			tools: params.tools ? toAnthropicTools(params.tools) : undefined,
		});
		return result.input_tokens;
	}
}

// --- Translators ---

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
	return messages.map((m) => ({
		role: m.role,
		content: typeof m.content === 'string' ? m.content : m.content.map(toAnthropicBlock),
	}));
}

function toAnthropicBlock(block: ContentBlock): Anthropic.ContentBlockParam {
	switch (block.type) {
		case 'text':
			return { type: 'text', text: block.text };
		case 'thinking':
			// Pass thinking blocks back for multi-turn with extended thinking (signature required)
			return {
				type: 'thinking',
				thinking: block.thinking,
				signature: block.signature,
			} as unknown as Anthropic.ContentBlockParam;
		case 'image':
			// Priority: file_id > URL > base64
			// file_id is best — uploaded once to Anthropic Files API, zero base64 in context
			if (block.fileId) {
				return {
					type: 'image',
					source: {
						type: 'file',
						file_id: block.fileId,
					},
				} as unknown as Anthropic.ContentBlockParam;
			}
			if (block.url) {
				return {
					type: 'image',
					source: {
						type: 'url',
						url: block.url,
					},
				} as unknown as Anthropic.ContentBlockParam;
			}
			return {
				type: 'image',
				source: {
					type: 'base64',
					media_type: block.mediaType,
					data: block.data,
				},
			};
		case 'tool_use':
			return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
		case 'tool_result':
			return {
				type: 'tool_result',
				tool_use_id: block.toolUseId,
				content: Array.isArray(block.content)
					? (block.content.map(toAnthropicBlock) as Anthropic.ToolResultBlockParam['content'])
					: block.content,
				is_error: block.isError,
			};
	}
}

function toAnthropicTools(tools: Tool[]): Anthropic.Tool[] {
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: {
			type: 'object' as const,
			properties: t.parameters.properties,
			required: t.parameters.required,
		},
	}));
}
