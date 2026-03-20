/**
 * WebSocket client — connects to the backend WS server.
 * Routes action requests from the agent to the browser for execution.
 *
 * Actions are executed via chrome.scripting.executeScript (inline functions),
 * NOT via content script messaging. This is more reliable because it doesn't
 * depend on the content script being loaded.
 */

import { handleActionRequest } from './action-handler.js';

// Injected at build time by Vite define (see vite.config.ts)
const WS_URL = process.env.WS_URL ?? 'ws://localhost:3002';
const KEEPALIVE_ALARM = 'ws-keepalive';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionId: string | null = null;

// Track sub-agent tabs so we can clean them up
const subAgentTabs = new Map<number, string>(); // tabId → agentId

// Callbacks for pending vector search requests
const vectorSearchCallbacks = new Map<string, (result: { selector: string } | null) => void>();

// --- Action context for the handler ---

const actionContext = {
	sendResult,
	sendPageIndexed,
	requestVectorSearch,
	subAgentTabs,
};

// --- Connection management ---

export function connectWebSocket() {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return;
	}

	console.log('[AFE WS] Connecting...');

	try {
		ws = new WebSocket(WS_URL);

		ws.onopen = async () => {
			console.log('[AFE WS] Connected');
			const stored = await chrome.storage.local.get(['authToken']);
			if (stored.authToken) {
				ws?.send(JSON.stringify({ type: 'auth', token: stored.authToken }));
			} else {
				console.warn('[AFE WS] No auth token found');
			}
			chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
		};

		ws.onmessage = async (event) => {
			try {
				const message = JSON.parse(event.data);
				console.log('[AFE WS] Received:', message.type, message.requestId || '');

				switch (message.type) {
					case 'connected':
						connectionId = message.connectionId;
						break;
					case 'auth_result':
						console.log(`[AFE WS] Auth ${message.success ? 'OK' : 'FAILED'}`);
						break;
					case 'action_request':
						await handleActionRequest(message, actionContext);
						break;
					case 'approval_request':
						chrome.runtime
							.sendMessage({
								type: 'APPROVAL_REQUEST',
								requestId: message.requestId,
								payload: message.payload,
							})
							.catch(() => {
								sendApproval(message.requestId, false, 'Side panel not open');
							});
						break;
					case 'action_status':
						chrome.runtime
							.sendMessage({
								type: 'ACTION_STATUS',
								payload: message.payload,
							})
							.catch(() => {});
						break;
					case 'scheduled_agent_start':
						chrome.runtime
							.sendMessage({
								type: 'SCHEDULED_AGENT_START',
								payload: message.payload,
							})
							.catch(() => {});
						break;
					case 'scheduled_agent_end':
						chrome.runtime
							.sendMessage({
								type: 'SCHEDULED_AGENT_END',
								payload: message.payload,
							})
							.catch(() => {});
						break;
					case 'find_element_result': {
						const cb = vectorSearchCallbacks.get(message.requestId);
						if (cb) cb(message.result);
						break;
					}
				}
			} catch (err) {
				console.error('[AFE WS] Message handler error:', err);
			}
		};

		ws.onclose = () => {
			console.log('[AFE WS] Disconnected');
			ws = null;
			connectionId = null;
			chrome.alarms.clear(KEEPALIVE_ALARM);
			scheduleReconnect();
		};

		ws.onerror = () => {
			console.error('[AFE WS] Connection error');
		};
	} catch (err) {
		console.error('[AFE WS] Failed to connect:', err);
		scheduleReconnect();
	}
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectWebSocket();
	}, 3000);
}

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === KEEPALIVE_ALARM) {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			connectWebSocket();
		}
	}
});

// --- WS send helpers ---

function sendResult(requestId: string, result: unknown) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(
			JSON.stringify({
				type: 'action_result',
				requestId,
				payload: result,
				timestamp: Date.now(),
			}),
		);
	} else {
		console.error('[AFE WS] Cannot send result — WS not open');
	}
}

export function sendApproval(requestId: string, approved: boolean, reason?: string) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(
			JSON.stringify({
				type: 'approval_response',
				requestId,
				approved,
				reason,
				timestamp: Date.now(),
			}),
		);
	}
}

export function sendKill() {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'kill', timestamp: Date.now() }));
	}
}

export function sendPageIndexed(domain: string, pageIndex: unknown) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(
			JSON.stringify({
				type: 'page_indexed',
				domain,
				pageIndex,
				timestamp: Date.now(),
			}),
		);
	}
}

function requestVectorSearch(label: string, elementType: string): Promise<string | null> {
	return new Promise((resolve) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			resolve(null);
			return;
		}

		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (!tab?.url) {
				resolve(null);
				return;
			}

			let domain: string;
			try {
				domain = new URL(tab.url).hostname;
			} catch {
				resolve(null);
				return;
			}

			const requestId = `vs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

			const timeout = setTimeout(() => {
				vectorSearchCallbacks.delete(requestId);
				resolve(null);
			}, 5000);

			vectorSearchCallbacks.set(requestId, (result) => {
				clearTimeout(timeout);
				vectorSearchCallbacks.delete(requestId);
				resolve(result?.selector || null);
			});

			ws!.send(
				JSON.stringify({
					type: 'find_element',
					label,
					elementType,
					domain,
					requestId,
					timestamp: Date.now(),
				}),
			);
		});
	});
}

export function sendManualAction(action: string, args: Record<string, unknown>, url: string) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(
			JSON.stringify({
				type: 'manual_action',
				action,
				args,
				url,
				timestamp: Date.now(),
			}),
		);
	}
}

export function disconnectWebSocket() {
	chrome.alarms.clear(KEEPALIVE_ALARM);
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (ws) {
		ws.close();
		ws = null;
	}
}

export function isConnected(): boolean {
	return ws !== null && ws.readyState === WebSocket.OPEN;
}
