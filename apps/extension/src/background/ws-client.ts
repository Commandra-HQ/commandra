/**
 * WebSocket client — connects to the backend WS server.
 * Routes action requests from the agent to content scripts for execution.
 */

const WS_URL = 'ws://localhost:3002';
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionId: string | null = null;

export function connectWebSocket() {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return;
	}

	try {
		ws = new WebSocket(WS_URL);

		ws.onopen = async () => {
			console.log('[AFE WS] Connected');

			// Authenticate with stored token
			const stored = await chrome.storage.local.get(['authToken']);
			if (stored.authToken) {
				ws?.send(JSON.stringify({ type: 'auth', token: stored.authToken }));
			}
		};

		ws.onmessage = async (event) => {
			try {
				const message = JSON.parse(event.data);

				switch (message.type) {
					case 'connected':
						connectionId = message.connectionId;
						console.log(`[AFE WS] Assigned connectionId: ${connectionId}`);
						break;

					case 'auth_result':
						console.log(`[AFE WS] Auth ${message.success ? 'succeeded' : 'failed'}`);
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
			connectionId = null;
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

async function handleActionRequest(message: { requestId: string; payload: Record<string, unknown> }) {
	const { requestId, payload } = message;

	// Get the active tab
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];

	if (!tab?.id) {
		sendResult(requestId, { success: false, error: 'No active tab found' });
		return;
	}

	try {
		// Navigate is handled in background (content script can't survive page unload)
		if (payload.action === 'navigate' && payload.url) {
			await chrome.tabs.update(tab.id, { url: payload.url as string });
			// Wait for page to load before responding
			await waitForTabLoad(tab.id);
			sendResult(requestId, { success: true, data: { navigatedTo: payload.url } });
			return;
		}

		// All other actions go to content script
		const result = await chrome.tabs.sendMessage(tab.id, {
			type: 'EXECUTE_ACTION',
			payload,
		});

		sendResult(requestId, result);
	} catch (err) {
		console.error('[AFE WS] Action failed:', err);
		sendResult(requestId, {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

function waitForTabLoad(tabId: number): Promise<void> {
	return new Promise((resolve) => {
		const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
			if (id === tabId && info.status === 'complete') {
				chrome.tabs.onUpdated.removeListener(listener);
				// Small delay for content script to initialize
				setTimeout(resolve, 500);
			}
		};
		chrome.tabs.onUpdated.addListener(listener);
		// Safety timeout — don't wait forever
		setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			resolve();
		}, 8000);
	});
}

function sendResult(requestId: string, result: unknown) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({
			type: 'action_result',
			requestId,
			payload: result,
			timestamp: Date.now(),
		}));
	}
}

export function disconnectWebSocket() {
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
