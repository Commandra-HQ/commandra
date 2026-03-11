/**
 * OpenAI provider adapter.
 * Translates our generic types ↔ OpenAI SDK types.
 */

import OpenAI from 'openai';
import type {
	ChatParams,
	ContentBlock,
	LLMProvider,
	Message,
	StreamEvent,
	Tool,
} from '../types.js';

// Model aliases → actual OpenAI model IDs
const MODEL_MAP: Record<string, string> = {
	'gpt-4o': 'gpt-4o',
	'gpt-4o-mini': 'gpt-4o-mini',
	'gpt-4.1': 'gpt-4.1',
	'gpt-4.1-mini': 'gpt-4.1-mini',
	'gpt-4.1-nano': 'gpt-4.1-nano',
	'o3-mini': 'o3-mini',
};

function resolveModel(model: string): string {
	return MODEL_MAP[model] || model;
}

export class OpenAIProvider implements LLMProvider {
	id = 'openai';
	supportsVision = true;
	supportsToolUse = true;

	private client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({ apiKey });
	}

	async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
		const messages = toOpenAIMessages(params.system, params.messages);

		const response = await this.client.chat.completions.create(
			{
				model: resolveModel(params.model),
				max_completion_tokens: params.maxTokens ?? 4096,
				messages,
				tools: params.tools ? toOpenAITools(params.tools) : undefined,
				stream: true,
			},
			params.signal ? { signal: params.signal } : undefined,
		);

		// Track tool calls being built from deltas
		const toolCalls = new Map<number, { id: string; name: string; json: string }>();

		for await (const chunk of response) {
			const delta = chunk.choices[0]?.delta;
			if (!delta) continue;

			// Text content
			if (delta.content) {
				yield { type: 'text', text: delta.content };
			}

			// Tool call deltas
			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					const idx = tc.index;

					if (tc.id) {
						// Start of a new tool call
						toolCalls.set(idx, { id: tc.id, name: tc.function?.name || '', json: '' });
						yield { type: 'tool_use_start', id: tc.id, name: tc.function?.name || '' };
					}

					if (tc.function?.arguments) {
						const existing = toolCalls.get(idx);
						if (existing) {
							existing.json += tc.function.arguments;
							yield {
								type: 'tool_use_delta',
								id: existing.id,
								partialJson: tc.function.arguments,
							};
						}
					}
				}
			}

			// Finish reason
			const finish = chunk.choices[0]?.finish_reason;
			if (finish) {
				// Emit tool_use_end for any accumulated tool calls
				for (const [, tc] of toolCalls) {
					let input: Record<string, unknown> = {};
					try {
						input = JSON.parse(tc.json || '{}');
					} catch {
						/* empty */
					}
					yield { type: 'tool_use_end', id: tc.id, name: tc.name, input };
				}
				toolCalls.clear();

				yield {
					type: 'message_end',
					stopReason:
						finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
				};
			}
		}
	}
}

// --- Translators ---

function toOpenAIMessages(
	system: string,
	messages: Message[],
): OpenAI.ChatCompletionMessageParam[] {
	const result: OpenAI.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];

	for (const m of messages) {
		if (typeof m.content === 'string') {
			result.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
		} else {
			// Content blocks — need to handle tool_use, tool_result, images
			const blocks = m.content as ContentBlock[];

			if (m.role === 'assistant') {
				// Assistant message with potential tool calls (strip thinking blocks — OpenAI doesn't use them)
				const textParts = blocks.filter((b) => b.type === 'text');
				const toolParts = blocks.filter((b) => b.type === 'tool_use');

				const msg: OpenAI.ChatCompletionAssistantMessageParam = {
					role: 'assistant',
					content:
						textParts.length > 0
							? textParts.map((b) => (b as { text: string }).text).join('')
							: null,
				};

				if (toolParts.length > 0) {
					msg.tool_calls = toolParts.map((b) => {
						const tu = b as { id: string; name: string; input: Record<string, unknown> };
						return {
							id: tu.id,
							type: 'function' as const,
							function: { name: tu.name, arguments: JSON.stringify(tu.input) },
						};
					});
				}

				result.push(msg);
			} else {
				// User message — could be tool results or content with images
				const toolResults = blocks.filter((b) => b.type === 'tool_result');
				const otherBlocks = blocks.filter((b) => b.type !== 'tool_result');

				// Tool results become separate tool messages
				for (const tr of toolResults) {
					const toolResult = tr as { toolUseId: string; content: string | unknown[] };
					const content =
						typeof toolResult.content === 'string'
							? toolResult.content
							: JSON.stringify(toolResult.content);
					result.push({
						role: 'tool',
						tool_call_id: toolResult.toolUseId,
						content,
					});
				}

				// Other blocks (text, images) become a user message
				if (otherBlocks.length > 0) {
					const parts: OpenAI.ChatCompletionContentPart[] = [];
					for (const block of otherBlocks) {
						if (block.type === 'text') {
							parts.push({ type: 'text', text: block.text });
						} else if (block.type === 'image') {
							parts.push({
								type: 'image_url',
								image_url: {
									url: `data:${block.mediaType};base64,${block.data}`,
								},
							});
						}
					}
					if (parts.length > 0) {
						result.push({ role: 'user', content: parts });
					}
				}
			}
		}
	}

	return result;
}

function toOpenAITools(tools: Tool[]): OpenAI.ChatCompletionTool[] {
	return tools.map((t) => ({
		type: 'function' as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: {
				type: 'object',
				properties: t.parameters.properties,
				required: t.parameters.required || [],
			},
		},
	}));
}
