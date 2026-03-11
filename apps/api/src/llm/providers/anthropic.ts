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
	StreamEvent,
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

export class AnthropicProvider implements LLMProvider {
	id = 'anthropic';
	supportsVision = true;
	supportsToolUse = true;

	private client: Anthropic;

	constructor(apiKey: string) {
		this.client = new Anthropic({ apiKey });
	}

	async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
		// Build create params — conditionally add thinking
		const createParams: Record<string, unknown> = {
			model: resolveModel(params.model),
			max_tokens: params.maxTokens ?? 4096,
			system: params.system,
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

		for await (const event of response) {
			if (event.type === 'content_block_start') {
				const block = event.content_block as { type: string; id?: string; name?: string };
				currentBlockType = block.type;
				if (block.type === 'tool_use') {
					currentToolId = block.id || '';
					currentToolName = block.name || '';
					toolJson = '';
					yield { type: 'tool_use_start', id: currentToolId, name: currentToolName };
				}
			} else if (event.type === 'content_block_delta') {
				const delta = event.delta as { type: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
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
			}
		}
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
			return { type: 'thinking', thinking: block.thinking, signature: block.signature } as unknown as Anthropic.ContentBlockParam;
		case 'image':
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
