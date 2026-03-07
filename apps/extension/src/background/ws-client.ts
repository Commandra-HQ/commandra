/**
 * WebSocket client — connects to the backend WS server.
 * Routes action requests from the agent to the browser for execution.
 *
 * Actions are executed via chrome.scripting.executeScript (inline functions),
 * NOT via content script messaging. This is more reliable because it doesn't
 * depend on the content script being loaded.
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
						await handleActionRequest(message);
						break;
					case 'approval_request':
						// Forward to side panel for user approval
						chrome.runtime.sendMessage({
							type: 'APPROVAL_REQUEST',
							requestId: message.requestId,
							payload: message.payload,
						}).catch(() => {
							// Side panel not open — auto-reject
							sendApproval(message.requestId, false, 'Side panel not open');
						});
						break;
					case 'action_status':
						chrome.runtime.sendMessage({
							type: 'ACTION_STATUS',
							payload: message.payload,
						}).catch(() => {});
						break;
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

async function handleActionRequest(message: { requestId: string; payload: Record<string, unknown> }) {
	const { requestId, payload } = message;
	const action = payload.action as string;
	console.log(`[AFE WS] Action: ${action}`, payload);

	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];

	if (!tab?.id) {
		sendResult(requestId, { success: false, error: 'No active tab found' });
		return;
	}

	try {
		let result: unknown;

		if (action === 'navigate') {
			await chrome.tabs.update(tab.id, { url: payload.url as string });
			await waitForTabLoad(tab.id);
			result = { success: true, data: { navigatedTo: payload.url } };
		} else if (action === 'click_element') {
			result = await executeInTab(tab.id, clickInPage, [payload.selector as string]);
		} else if (action === 'type_text') {
			result = await executeInTab(tab.id, typeInPage, [payload.selector as string, payload.text as string]);
		} else if (action === 'select_option') {
			result = await executeInTab(tab.id, selectInPage, [payload.selector as string, payload.value as string]);
		} else if (action === 'get_page_state') {
			result = await executeInTab(tab.id, getPageStateInPage, []);
		} else {
			result = { success: false, error: `Unknown action: ${action}` };
		}

		console.log('[AFE WS] Action result:', result);
		sendResult(requestId, result);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		console.error('[AFE WS] Action error:', errorMsg);
		sendResult(requestId, { success: false, error: errorMsg });
	}
}

/**
 * Execute a function in the tab's page context via chrome.scripting.executeScript.
 * This works regardless of whether the content script is loaded.
 */
async function executeInTab(tabId: number, func: (...args: string[]) => unknown, args: string[]): Promise<unknown> {
	const results = await chrome.scripting.executeScript({
		target: { tabId },
		func,
		args,
	});
	return results[0]?.result;
}

// --- Functions that run IN the page context (injected via executeScript) ---

function clickInPage(selector: string) {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement)) return { success: false, error: `Not clickable: ${selector}` };
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.click();
	return { success: true, data: { clicked: selector, tag: el.tagName.toLowerCase(), text: el.textContent?.trim().slice(0, 100) } };
}

function typeInPage(selector: string, text: string) {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
		return { success: false, error: `Not a text input: ${selector}` };
	}
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.focus();
	el.value = '';
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.value = text;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return { success: true, data: { typed: text, selector } };
}

function selectInPage(selector: string, value: string) {
	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLSelectElement)) return { success: false, error: `Not a select: ${selector}` };
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return { success: true, data: { selected: value, selector } };
}

function getPageStateInPage() {
	// Lightweight page indexer — inline version for action context
	const elements: { type: string; label: string; selector: string }[] = [];
	const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]';

	document.querySelectorAll(interactiveSelectors).forEach((el) => {
		if (!(el instanceof HTMLElement)) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return;
		if (getComputedStyle(el).display === 'none') return;

		const type = el.tagName.toLowerCase();
		const label = el.getAttribute('aria-label')
			|| el.textContent?.trim().slice(0, 60)
			|| el.getAttribute('placeholder')
			|| el.getAttribute('title')
			|| '';

		if (!label) return;

		// Build a selector
		let selector = '';
		if (el.id) selector = `#${el.id}`;
		else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
		else if (el.getAttribute('name')) selector = `${type}[name="${el.getAttribute('name')}"]`;
		else if (el.className && typeof el.className === 'string') selector = `${type}.${el.className.split(' ').filter(Boolean)[0]}`;
		else selector = type;

		elements.push({ type, label, selector });
	});

	return {
		success: true,
		data: {
			url: window.location.href,
			title: document.title,
			elements: elements.slice(0, 100),
		},
	};
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
		ws.send(JSON.stringify({
			type: 'action_result',
			requestId,
			payload: result,
			timestamp: Date.now(),
		}));
	} else {
		console.error('[AFE WS] Cannot send result — WS not open');
	}
}

export function sendApproval(requestId: string, approved: boolean, reason?: string) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({
			type: 'approval_response',
			requestId,
			approved,
			reason,
			timestamp: Date.now(),
		}));
	}
}

export function sendKill() {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'kill', timestamp: Date.now() }));
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
