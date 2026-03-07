/**
 * WebSocket client — connects to the backend WS server.
 * Routes action requests from the agent to content scripts for execution.
 *
 * MV3 service workers get terminated after ~30s of inactivity.
 * We use chrome.alarms to keep the worker alive and reconnect WS if needed.
 */

const WS_URL = 'ws://localhost:3002';
const KEEPALIVE_ALARM = 'ws-keepalive';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionId: string | null = null;

export function connectWebSocket() {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return;
	}

	console.log('[AFE WS] Connecting...');

	try {
		ws = new WebSocket(WS_URL);

		ws.onopen = async () => {
			console.log('[AFE WS] Connected');

			// Authenticate with stored token
			const stored = await chrome.storage.local.get(['authToken']);
			if (stored.authToken) {
				ws?.send(JSON.stringify({ type: 'auth', token: stored.authToken }));
				console.log('[AFE WS] Sent auth token');
			} else {
				console.warn('[AFE WS] No auth token found in storage');
			}

			// Start keepalive alarm to prevent service worker termination
			chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // every 24s
		};

		ws.onmessage = async (event) => {
			try {
				const message = JSON.parse(event.data);
				console.log('[AFE WS] Received:', message.type, message.requestId || '');

				switch (message.type) {
					case 'connected':
						connectionId = message.connectionId;
						console.log(`[AFE WS] Assigned connectionId: ${connectionId}`);
						break;

					case 'auth_result':
						console.log(`[AFE WS] Auth ${message.success ? 'succeeded' : 'FAILED'}`);
						break;

					case 'action_request':
						await handleActionRequest(message);
						break;

					case 'action_status':
						// Forward to side panel
						chrome.runtime.sendMessage({
							type: 'ACTION_STATUS',
							payload: message.payload,
						}).catch(() => {}); // Side panel might not be open
						break;
				}
			} catch (err) {
				console.error('[AFE WS] Failed to handle message:', err);
			}
		};

		ws.onclose = () => {
			console.log('[AFE WS] Disconnected');
			ws = null;
			connectionId = null;
			chrome.alarms.clear(KEEPALIVE_ALARM);
			scheduleReconnect();
		};

		ws.onerror = (err) => {
			console.error('[AFE WS] Error:', err);
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

// Keepalive alarm handler — keeps service worker alive and reconnects WS if needed
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === KEEPALIVE_ALARM) {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			console.log('[AFE WS] Keepalive: reconnecting...');
			connectWebSocket();
		}
	}
});

async function handleActionRequest(message: { requestId: string; payload: Record<string, unknown> }) {
	const { requestId, payload } = message;
	console.log(`[AFE WS] Action request: ${payload.action}`, payload);

	// Get the active tab
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];

	if (!tab?.id) {
		console.error('[AFE WS] No active tab found');
		sendResult(requestId, { success: false, error: 'No active tab found' });
		return;
	}

	console.log(`[AFE WS] Sending to tab ${tab.id}: ${tab.url}`);

	try {
		// Navigate is handled in background (content script can't survive page unload)
		if (payload.action === 'navigate' && payload.url) {
			await chrome.tabs.update(tab.id, { url: payload.url as string });
			await waitForTabLoad(tab.id);
			sendResult(requestId, { success: true, data: { navigatedTo: payload.url } });
			return;
		}

		// All other actions go to content script
		const result = await chrome.tabs.sendMessage(tab.id, {
			type: 'EXECUTE_ACTION',
			payload,
		});

		console.log('[AFE WS] Content script result:', result);
		sendResult(requestId, result);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		console.error('[AFE WS] Action failed:', errorMsg);

		// If content script isn't available, try injecting it
		if (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection')) {
			console.log('[AFE WS] Content script not available, trying to inject...');
			try {
				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					files: ['src/content/index.ts'],
				});
				// Retry after injection
				const result = await chrome.tabs.sendMessage(tab.id, {
					type: 'EXECUTE_ACTION',
					payload,
				});
				console.log('[AFE WS] Retry result:', result);
				sendResult(requestId, result);
				return;
			} catch (retryErr) {
				console.error('[AFE WS] Retry also failed:', retryErr);
			}
		}

		sendResult(requestId, {
			success: false,
			error: `Action failed: ${errorMsg}`,
		});
	}
}

function waitForTabLoad(tabId: number): Promise<void> {
	return new Promise((resolve) => {
		const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
			if (id === tabId && info.status === 'complete') {
				chrome.tabs.onUpdated.removeListener(listener);
				setTimeout(resolve, 500);
			}
		};
		chrome.tabs.onUpdated.addListener(listener);
		setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			resolve();
		}, 8000);
	});
}

function sendResult(requestId: string, result: unknown) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		console.log('[AFE WS] Sending result for', requestId);
		ws.send(JSON.stringify({
			type: 'action_result',
			requestId,
			payload: result,
			timestamp: Date.now(),
		}));
	} else {
		console.error('[AFE WS] Cannot send result — WS not open. State:', ws?.readyState);
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
