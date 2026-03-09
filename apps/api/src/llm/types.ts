/**
 * Provider-agnostic LLM types.
 * No vendor imports. All provider adapters translate to/from these types.
 */

export interface LLMProvider {
	id: string;
	chat(params: ChatParams): AsyncIterable<StreamEvent>;
	supportsVision: boolean;
	supportsToolUse: boolean;
}

export interface ChatParams {
	model: string;
	system: string;
	messages: Message[];
	tools?: Tool[];
	maxTokens?: number;
	signal?: AbortSignal;
}

// --- Messages ---

export type MessageRole = 'user' | 'assistant';

export interface Message {
	role: MessageRole;
	content: ContentBlock[] | string;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
	type: 'text';
	text: string;
}

export interface ImageBlock {
	type: 'image';
	data: string; // base64
	mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultBlock {
	type: 'tool_result';
	toolUseId: string;
	content: string | (TextBlock | ImageBlock)[];
	isError?: boolean;
}

// --- Tools ---

export interface Tool {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export interface JsonSchema {
	type: 'object';
	properties: Record<string, unknown>;
	required?: string[];
}

// --- Streaming ---

export type StreamEvent =
	| { type: 'text'; text: string }
	| { type: 'tool_use_start'; id: string; name: string }
	| { type: 'tool_use_delta'; id: string; partialJson: string }
	| { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
	| { type: 'message_end'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' };

// --- Response (non-streaming convenience) ---

export interface ChatResponse {
	content: ContentBlock[];
	stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

/**
 * Collect a streaming response into a ChatResponse.
 */
export async function collectStream(stream: AsyncIterable<StreamEvent>): Promise<ChatResponse> {
	const content: ContentBlock[] = [];
	let currentToolUse: { id: string; name: string; json: string } | null = null;
	let stopReason: ChatResponse['stopReason'] = 'end_turn';

	for await (const event of stream) {
		switch (event.type) {
			case 'text':
				// Merge consecutive text blocks
				if (content.length > 0 && content[content.length - 1].type === 'text') {
					(content[content.length - 1] as TextBlock).text += event.text;
				} else {
					content.push({ type: 'text', text: event.text });
				}
				break;
			case 'tool_use_start':
				currentToolUse = { id: event.id, name: event.name, json: '' };
				break;
			case 'tool_use_delta':
				if (currentToolUse) currentToolUse.json += event.partialJson;
				break;
			case 'tool_use_end':
				content.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
				currentToolUse = null;
				break;
			case 'message_end':
				stopReason = event.stopReason;
				break;
		}
	}

	return { content, stopReason };
}
