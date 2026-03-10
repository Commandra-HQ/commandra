/**
 * SSE event types for the chat streaming protocol.
 * Used by both the API (emitter) and extension (consumer).
 */

import type { FlowStep } from './flows.js';

export type SSEEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'thinking' }
	| { type: 'thinking_delta'; text: string }
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
	| { type: 'error'; message: string }
	| { type: 'flow_step_recorded'; step: FlowStep; stepCount: number }
	| { type: 'recording_started' }
	| { type: 'recording_stopped'; flowId: string; stepCount: number }
	| { type: 'flow_step_start'; stepIndex: number; totalSteps: number; intent: string }
	| { type: 'flow_step_end'; stepIndex: number; success: boolean; error?: string }
	| { type: 'flow_done'; flowRunId: string; success: boolean };
