export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	timestamp: number;
}

/** Messages sent over WebSocket between extension and backend */
export type WsMessageType =
	| 'action_request'
	| 'action_result'
	| 'page_state'
	| 'chat_message'
	| 'agent_status'
	| 'kill';

export interface WsMessage {
	type: WsMessageType;
	payload: unknown;
	connectionId: string;
	timestamp: number;
}

export type AgentStatus = 'idle' | 'planning' | 'executing' | 'waiting_approval' | 'error';
