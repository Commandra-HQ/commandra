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
		const response = await this.client.messages.create({
			model: resolveModel(params.model),
			max_tokens: params.maxTokens ?? 4096,
			system: params.system,
			messages: toAnthropicMessages(params.messages),
			tools: params.tools ? toAnthropicTools(params.tools) : undefined,
			stream: true,
		});

		let currentToolId = '';
		let currentToolName = '';
		let toolJson = '';

		for await (const event of response) {
			if (event.type === 'content_block_start') {
				if (event.content_block.type === 'tool_use') {
					currentToolId = event.content_block.id;
					currentToolName = event.content_block.name;
					toolJson = '';
					yield { type: 'tool_use_start', id: currentToolId, name: currentToolName };
				}
			} else if (event.type === 'content_block_delta') {
				if (event.delta.type === 'text_delta') {
					yield { type: 'text', text: event.delta.text };
				} else if (event.delta.type === 'input_json_delta') {
					toolJson += event.delta.partial_json;
					yield {
						type: 'tool_use_delta',
						id: currentToolId,
						partialJson: event.delta.partial_json,
					};
				}
			} else if (event.type === 'content_block_stop') {
				if (currentToolId) {
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
			} else if (event.type === 'message_delta') {
				const reason = event.delta.stop_reason;
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
					? block.content.map(toAnthropicBlock) as Anthropic.ToolResultBlockParam['content']
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
