import { describe, expect, it } from 'vitest';
import type {
	ActionRequest,
	ActionResultPayload,
	ActionStatusUpdate,
	AgentStatus,
	ChatMessage,
	CrawlProgress,
	SelectedElement,
	WsMessage,
	WsMessageType,
} from './messages.js';

describe('message types', () => {
	it('can create a valid ChatMessage', () => {
		const msg: ChatMessage = {
			id: '123',
			role: 'user',
			content: 'Hello',
			timestamp: Date.now(),
		};
		expect(msg.role).toBe('user');
		expect(msg.content).toBe('Hello');
	});

	it('can create a valid WsMessage', () => {
		const msg: WsMessage = {
			type: 'auth',
			payload: { token: 'abc' },
			timestamp: Date.now(),
		};
		expect(msg.type).toBe('auth');
	});

	it('can create a valid ActionRequest', () => {
		const req: ActionRequest = {
			requestId: 'req-1',
			action: 'click',
			selector: '#btn',
		};
		expect(req.action).toBe('click');
		expect(req.selector).toBe('#btn');
	});

	it('can create a valid ActionResultPayload', () => {
		const result: ActionResultPayload = {
			requestId: 'req-1',
			success: true,
			data: { text: 'clicked' },
		};
		expect(result.success).toBe(true);
	});

	it('can create a valid ActionStatusUpdate', () => {
		const status: ActionStatusUpdate = {
			requestId: 'req-1',
			action: 'click',
			status: 'executing',
			timestamp: Date.now(),
		};
		expect(status.status).toBe('executing');
	});

	it('can create a valid SelectedElement', () => {
		const el: SelectedElement = {
			selector: '#test',
			fallbackSelectors: ['.test'],
			tag: 'button',
			label: 'Test',
			attributes: {},
			rect: { x: 0, y: 0, width: 100, height: 50 },
		};
		expect(el.tag).toBe('button');
	});

	it('can create a valid CrawlProgress', () => {
		const progress: CrawlProgress = {
			domain: 'example.com',
			pagesIndexed: 5,
			pagesDiscovered: 10,
			currentUrl: 'https://example.com/page',
			status: 'crawling',
		};
		expect(progress.status).toBe('crawling');
	});

	it('supports all WsMessageType values', () => {
		const types: WsMessageType[] = [
			'connected',
			'auth',
			'auth_result',
			'action_request',
			'action_result',
			'action_status',
			'page_state',
			'chat_message',
			'agent_status',
			'kill',
		];
		expect(types).toHaveLength(10);
	});

	it('supports all AgentStatus values', () => {
		const statuses: AgentStatus[] = ['idle', 'planning', 'executing', 'waiting_approval', 'error'];
		expect(statuses).toHaveLength(5);
	});
});
