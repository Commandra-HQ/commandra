/**
 * SSE event types for the chat streaming protocol.
 * Used by both the API (emitter) and extension (consumer).
 */

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
	| {
			type: 'plan_submitted';
			planId: string;
			steps: { label: string; status: string }[];
			description: string;
	  }
	| { type: 'plan_approved'; planId: string }
	| { type: 'plan_rejected'; planId: string; reason?: string }
	| {
			type: 'plan_step_updated';
			planId: string;
			stepIndex: number;
			status: 'in_progress' | 'completed' | 'failed';
			error?: string;
	  }
	| { type: 'context_status'; used: number; limit: number; percent: number }
	| { type: 'compaction'; summary: string; path: string; messageCount: number }
	| {
			type: 'approval_inline';
			requestId: string;
			action: string;
			label?: string;
			reason: string;
			approvalType: 'tool' | 'plan' | 'agent';
			planSteps?: string[];
			agentPreview?: {
				slug: string;
				name: string;
				description: string;
				soul: string;
				domains?: string[];
				cron?: string;
			};
	  }
	| {
			type: 'plan_state';
			plan: {
				description: string;
				steps: { label: string; status: string }[];
			} | null;
	  }
	| { type: 'done'; conversationId: string }
	| { type: 'error'; message: string }
	| { type: 'sub_agent_start'; agentId: string; task: string; targetUrl: string }
	| {
			type: 'sub_agent_action';
			agentId: string;
			toolName: string;
			label: string;
			success: boolean;
			args?: Record<string, unknown>;
			result?: unknown;
			error?: string;
			screenshot?: string;
	  }
	| {
			type: 'sub_agent_end';
			agentId: string;
			success: boolean;
			summary: string;
			actionsPerformed: string[];
	  };
