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

/** Messages sent between content script, background, and side panel */
export type ExtMessageType =
	| 'INDEX_PAGE'
	| 'INDEX_PAGE_RESULT'
	| 'CRAWL_START'
	| 'CRAWL_PROGRESS'
	| 'CRAWL_COMPLETE'
	| 'CRAWL_STOP'
	| 'GET_CRAWL_STATUS'
	| 'get_page_state'
	| 'action_request'
	| 'kill';

export interface CrawlProgress {
	domain: string;
	pagesIndexed: number;
	pagesDiscovered: number;
	currentUrl: string | null;
	status: 'idle' | 'crawling' | 'complete' | 'stopped';
}

export interface ExtMessage {
	type: ExtMessageType;
	payload?: unknown;
}
