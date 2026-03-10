/**
 * SSE event types for the chat streaming protocol.
 * Used by both the API (emitter) and extension (consumer).
 */

export type SSEEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'thinking' }
	| { type: 'tool_start'; toolName: string; label?: string; args?: Record<string, unknown> }
	| {
			type: 'tool_end';
			toolName: string;
			success: boolean;
			error?: string;
			result?: unknown;
			screenshot?: string;
	  }
	| { type: 'blocked'; toolName: string; reason: string }
	| { type: 'plan'; steps: string[]; description?: string }
	| { type: 'done'; conversationId: string }
	| { type: 'error'; message: string };
