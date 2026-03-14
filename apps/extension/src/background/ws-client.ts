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
						chrome.runtime
							.sendMessage({
								type: 'APPROVAL_REQUEST',
								requestId: message.requestId,
								payload: message.payload,
							})
							.catch(() => {
								// Side panel not open — auto-reject
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
					case 'find_element_result': {
						const cb = vectorSearchCallbacks.get(message.requestId);
						if (cb) cb(message.result);
						break;
					}
					case 'flow_step_recorded':
						// Forward recorded step to side panel so the recording UI updates
						chrome.runtime
							.sendMessage({
								type: 'FLOW_STEP_RECORDED',
								step: message.step,
								stepCount: message.stepCount,
							})
							.catch(() => {});
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

async function handleActionRequest(message: {
	requestId: string;
	payload: Record<string, unknown>;
}) {
	const { requestId, payload } = message;
	const action = payload.action as string;
	console.log(`[AFE WS] Action: ${action}`, payload);

	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs[0];

	if (!tab?.id) {
		sendResult(requestId, { success: false, error: 'No active tab found' });
		return;
	}

	// Extract fallback selectors and label for resilient element finding
	const fallbacksStr = Array.isArray(payload.fallbackSelectors)
		? (payload.fallbackSelectors as string[]).join('|||')
		: '';
	const elementLabel = (payload.label as string) || (payload.description as string) || '';
	const elementType = (payload.elementType as string) || '';

	// Helper: retry an action with a vector-searched selector if the first attempt fails with "not found"
	async function withVectorFallback(
		tabId: number,
		action: string,
		firstResult: unknown,
		label: string,
		elementType: string,
	): Promise<unknown> {
		const r = firstResult as { success?: boolean; error?: string } | null;
		if (r?.success || !r?.error?.includes('not found') || !label) return r;

		// Ask backend for vector search match
		const vectorSelector = await requestVectorSearch(label, elementType);
		if (!vectorSelector) return r;

		console.log(`[AFE WS] Vector search found: ${vectorSelector} for "${label}"`);

		if (action === 'click_element') {
			return executeInTab(tabId, clickInPage, [vectorSelector, '', label, elementType]);
		} else if (action === 'type_text') {
			return executeInTab(tabId, typeInPage, [
				vectorSelector,
				message.payload.text as string,
				'',
				label,
			]);
		} else if (action === 'select_option') {
			return executeInTab(tabId, selectInPage, [
				vectorSelector,
				message.payload.value as string,
				'',
				label,
			]);
		}
		return r;
	}

	try {
		let result: unknown;

		if (action === 'navigate') {
			await chrome.tabs.update(tab.id, { url: payload.url as string });
			await waitForTabLoad(tab.id);
			result = { success: true, data: { navigatedTo: payload.url } };
		} else if (action === 'click_element') {
			result = await executeInTab(tab.id, clickInPage, [
				payload.selector as string,
				fallbacksStr,
				elementLabel,
				elementType,
			]);
			result = await withVectorFallback(tab.id, action, result, elementLabel, elementType);
		} else if (action === 'type_text') {
			result = await executeInTab(tab.id, typeInPage, [
				payload.selector as string,
				payload.text as string,
				fallbacksStr,
				elementLabel,
			]);
			result = await withVectorFallback(tab.id, action, result, elementLabel, 'input');
		} else if (action === 'select_option') {
			result = await executeInTab(tab.id, selectInPage, [
				payload.selector as string,
				payload.value as string,
				fallbacksStr,
				elementLabel,
			]);
			result = await withVectorFallback(tab.id, action, result, elementLabel, 'select');
		} else if (action === 'get_page_state') {
			result = await executeInTab(tab.id, getPageStateInPage, []);
		} else if (action === 'screenshot') {
			const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 75 });
			const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
			result = {
				success: true,
				data: { image: base64, format: 'jpeg', url: tab.url, title: tab.title },
			};
		} else if (action === 'scroll') {
			result = await executeInTab(tab.id, scrollInPage, [
				(payload.direction as string) || '',
				(payload.selector as string) || '',
				String(payload.amount ?? 500),
			]);
		} else if (action === 'wait_for_element') {
			result = await executeInTabAsync(tab.id, waitForElementInPage, [
				payload.selector as string,
				(payload.state as string) || 'visible',
				String(Math.min(Number(payload.timeout) || 10000, 30000)),
			]);
		} else if (action === 'read_text') {
			result = await executeInTab(tab.id, readTextInPage, [
				payload.selector as string,
				String(payload.all ?? false),
				String(payload.maxLength ?? 2000),
			]);
		} else if (action === 'read_table') {
			result = await executeInTab(tab.id, readTableInPage, [
				payload.selector as string,
				String(payload.maxRows ?? 100),
				String(payload.includeLinks ?? false),
			]);
		} else if (action === 'go_back') {
			await executeInTab(tab.id, goBackInPage, []);
			await waitForTabLoad(tab.id);
			const tabAfter = await chrome.tabs.get(tab.id);
			result = { success: true, data: { url: tabAfter.url, title: tabAfter.title } };
		} else if (action === 'refresh_page_state') {
			// Full re-index of the current page — sends updated index to backend too
			result = await executeInTab(tab.id, refreshPageStateInPage, []);
			// Also push the fresh index to the backend so embeddings get updated
			const pageResult = result as { success?: boolean; data?: { pageIndex?: unknown } } | null;
			if (pageResult?.success && pageResult.data?.pageIndex) {
				const domain = getDomainFromTab(tab);
				if (domain) {
					sendPageIndexed(domain, pageResult.data.pageIndex);
				}
			}
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
async function executeInTab(
	tabId: number,
	func: (...args: string[]) => unknown,
	args: string[],
): Promise<unknown> {
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			func,
			args,
		});
		const result = results[0]?.result;
		if (result === null || result === undefined) {
			console.warn(
				'[AFE WS] executeInTab returned null/undefined. Function:',
				func.name,
				'Results:',
				JSON.stringify(results),
			);
		}
		return result;
	} catch (err) {
		console.error('[AFE WS] executeInTab error:', err, 'Function:', func.name);
		return {
			success: false,
			error: `Script execution failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Execute an async function in the tab's page context.
 * Used for wait_for_element which needs to poll asynchronously.
 */
async function executeInTabAsync(
	tabId: number,
	func: (...args: string[]) => Promise<unknown>,
	args: string[],
): Promise<unknown> {
	const results = await chrome.scripting.executeScript({
		target: { tabId },
		func,
		args,
	});
	return results[0]?.result;
}

// --- Functions that run IN the page context (injected via executeScript) ---

function clickInPage(selector: string, fallbacks: string, label: string, elementType: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
			select: 'select',
			textarea: 'textarea',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const {
		element: el,
		usedSelector,
		method,
	} = findElement(selector, fallbacks, label, elementType);
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLElement)) return { success: false, error: `Not clickable: ${selector}` };
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	el.click();
	return {
		success: true,
		data: {
			clicked: usedSelector,
			method,
			tag: el.tagName.toLowerCase(),
			text: el.textContent?.trim().slice(0, 100),
		},
	};
}

function typeInPage(selector: string, text: string, fallbacks: string, label: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
			select: 'select',
			textarea: 'textarea',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const { element: el, usedSelector, method } = findElement(selector, fallbacks, label, 'input');
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
	return { success: true, data: { typed: text, selector: usedSelector, method } };
}

function selectInPage(selector: string, value: string, fallbacks: string, label: string) {
	// Inline findElement — chrome.scripting.executeScript can't access outer functions
	function findElement(
		s: string,
		fb: string,
		l: string,
		et: string,
	): { element: Element | null; usedSelector: string; method: string } {
		let el = document.querySelector(s);
		if (el) return { element: el, usedSelector: s, method: 'primary' };
		const fbs = fb ? fb.split('|||') : [];
		for (const f of fbs) {
			if (!f) continue;
			el = document.querySelector(f);
			if (el) return { element: el, usedSelector: f, method: 'fallback' };
		}
		if (!l) return { element: null, usedSelector: s, method: 'none' };
		const ts: Record<string, string> = {
			button: 'button, [role="button"], input[type="submit"], input[type="button"]',
			link: 'a[href], [role="link"]',
			input:
				'input:not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])',
			select: 'select',
			textarea: 'textarea',
			checkbox: 'input[type="checkbox"], [role="checkbox"]',
			radio: 'input[type="radio"], [role="radio"]',
			tab: '[role="tab"]',
		};
		const qs =
			ts[et] || 'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]';
		const candidates = document.querySelectorAll(qs);
		const ll = l.toLowerCase().trim();
		let bestMatch: Element | null = null;
		let bestScore = 0;
		for (const c of candidates) {
			if (!(c instanceof HTMLElement)) continue;
			const r = c.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			const cl = (
				c.getAttribute('aria-label') ||
				c.getAttribute('title') ||
				c.textContent?.trim().slice(0, 100) ||
				c.getAttribute('placeholder') ||
				c.getAttribute('name') ||
				''
			)
				.toLowerCase()
				.trim();
			if (!cl) continue;
			if (cl === ll) return { element: c, usedSelector: 'fuzzy:exact', method: 'fuzzy' };
			let score = 0;
			if (cl.includes(ll) || ll.includes(cl)) {
				score = 0.8;
			} else {
				const lw = ll.split(/\s+/);
				const cw = cl.split(/\s+/);
				score = lw.filter((w) => cw.includes(w)).length / Math.max(lw.length, 1);
			}
			if (score > bestScore && score > 0.4) {
				bestScore = score;
				bestMatch = c;
			}
		}
		if (bestMatch)
			return { element: bestMatch, usedSelector: `fuzzy:${bestScore.toFixed(2)}`, method: 'fuzzy' };
		return { element: null, usedSelector: s, method: 'none' };
	}
	const { element: el, usedSelector, method } = findElement(selector, fallbacks, label, 'select');
	if (!el) return { success: false, error: `Element not found: ${selector}` };
	if (!(el instanceof HTMLSelectElement))
		return { success: false, error: `Not a select: ${selector}` };
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	return { success: true, data: { selected: value, selector: usedSelector, method } };
}

function getPageStateInPage() {
	// Lightweight page indexer — inline version for action context
	const elements: { type: string; label: string; selector: string }[] = [];
	const interactiveSelectors =
		'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]';

	document.querySelectorAll(interactiveSelectors).forEach((el) => {
		if (!(el instanceof HTMLElement)) return;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return;
		if (getComputedStyle(el).display === 'none') return;

		const type = el.tagName.toLowerCase();
		const label =
			el.getAttribute('aria-label') ||
			el.textContent?.trim().slice(0, 60) ||
			el.getAttribute('placeholder') ||
			el.getAttribute('title') ||
			'';

		if (!label) return;

		// Build a selector
		let selector = '';
		if (el.id) selector = `#${el.id}`;
		else if (el.getAttribute('data-testid'))
			selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
		else if (el.getAttribute('name')) selector = `${type}[name="${el.getAttribute('name')}"]`;
		else if (el.className && typeof el.className === 'string')
			selector = `${type}.${el.className.split(' ').filter(Boolean)[0]}`;
		else selector = type;

		elements.push({ type, label, selector });
	});

	return {
		success: true,
		data: {
			url: window.location.href,
			title: document.title,
			elements: elements.slice(0, 200),
		},
	};
}

function scrollInPage(direction: string, selector: string, amountStr: string) {
	const amount = Number(amountStr) || 500;

	// If selector provided, scroll that element into view
	if (selector) {
		const el = document.querySelector(selector);
		if (!el) return { success: false, error: `Element not found: ${selector}` };
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		return {
			success: true,
			data: {
				scrolledTo: selector,
				scrollY: window.scrollY,
				pageHeight: document.documentElement.scrollHeight,
				viewportHeight: window.innerHeight,
			},
		};
	}

	// Directional scroll
	const before = window.scrollY;
	switch (direction) {
		case 'top':
			window.scrollTo({ top: 0, behavior: 'smooth' });
			break;
		case 'bottom':
			window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
			break;
		case 'up':
			window.scrollBy({ top: -amount, behavior: 'smooth' });
			break;
		default:
			window.scrollBy({ top: amount, behavior: 'smooth' });
			break;
	}

	return {
		success: true,
		data: {
			direction: direction || 'down',
			scrolledFrom: before,
			scrollY: window.scrollY,
			pageHeight: document.documentElement.scrollHeight,
			viewportHeight: window.innerHeight,
			hasMoreBelow:
				window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 10,
		},
	};
}

async function waitForElementInPage(
	selector: string,
	state: string,
	timeoutStr: string,
): Promise<unknown> {
	const timeout = Number(timeoutStr) || 10000;
	const interval = 200;
	const start = Date.now();

	return new Promise((resolve) => {
		function check() {
			const el = document.querySelector(selector);
			const elapsed = Date.now() - start;

			if (state === 'visible') {
				if (el instanceof HTMLElement) {
					const rect = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					const isVisible =
						rect.width > 0 &&
						rect.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden';
					if (isVisible) {
						return resolve({
							success: true,
							data: {
								found: true,
								selector,
								elapsed,
								text: el.textContent?.trim().slice(0, 200),
							},
						});
					}
				}
			} else if (state === 'hidden') {
				if (!el) {
					return resolve({
						success: true,
						data: { found: false, selector, elapsed, state: 'removed' },
					});
				}
				if (el instanceof HTMLElement) {
					const style = getComputedStyle(el);
					if (style.display === 'none' || style.visibility === 'hidden') {
						return resolve({
							success: true,
							data: { found: false, selector, elapsed, state: 'hidden' },
						});
					}
				}
			} else if (state === 'attached') {
				if (el) {
					return resolve({
						success: true,
						data: {
							found: true,
							selector,
							elapsed,
							text: (el as HTMLElement).textContent?.trim().slice(0, 200),
						},
					});
				}
			}

			if (elapsed >= timeout) {
				return resolve({
					success: false,
					error: `Timeout after ${timeout}ms waiting for "${selector}" to be ${state}`,
				});
			}

			setTimeout(check, interval);
		}

		check();
	});
}

function readTextInPage(selector: string, allStr: string, maxLengthStr: string) {
	const all = allStr === 'true';
	const maxLength = Number(maxLengthStr) || 2000;

	if (all) {
		const elements = document.querySelectorAll(selector);
		if (elements.length === 0) {
			return { success: false, error: `No elements found matching: ${selector}` };
		}
		const texts = Array.from(elements).map((el) => ({
			text: (el.textContent || '').trim().slice(0, maxLength),
			tag: el.tagName.toLowerCase(),
		}));
		return {
			success: true,
			data: { selector, matchCount: elements.length, texts },
		};
	}

	const el = document.querySelector(selector);
	if (!el) return { success: false, error: `Element not found: ${selector}` };

	return {
		success: true,
		data: {
			selector,
			text: (el.textContent || '').trim().slice(0, maxLength),
			tag: el.tagName.toLowerCase(),
		},
	};
}

function readTableInPage(selector: string, maxRowsStr: string, includeLinksStr: string) {
	const maxRows = Number(maxRowsStr) || 100;
	const includeLinks = includeLinksStr === 'true';

	// Find the table — try direct match first, then look inside a container
	let table = document.querySelector(selector);
	if (table && table.tagName.toLowerCase() !== 'table') {
		const inner = table.querySelector('table');
		if (inner) table = inner;
	}

	// Try role="grid" data grids
	if (table && table.tagName.toLowerCase() !== 'table' && !table.querySelector('table')) {
		return readDataGrid(table, maxRows, includeLinks, selector);
	}

	if (!table || table.tagName.toLowerCase() !== 'table') {
		return { success: false, error: `No table found at: ${selector}` };
	}

	// Extract headers
	const headers: string[] = [];
	const thead = table.querySelector('thead');
	const headerRow = thead ? thead.querySelector('tr') : table.querySelector('tr');

	if (headerRow) {
		for (const cell of headerRow.querySelectorAll('th, td')) {
			headers.push((cell.textContent || '').trim());
		}
	}

	// Extract rows from tbody (or all tr except first if no thead)
	const tbody = table.querySelector('tbody');
	const allRows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr');

	const startIdx = !thead && headerRow ? 1 : 0; // skip header row if no thead
	const rows: Record<string, string>[] = [];
	let totalRows = 0;

	for (let i = startIdx; i < allRows.length; i++) {
		totalRows++;
		if (rows.length >= maxRows) continue; // count but don't extract past limit

		const row = allRows[i];
		const cells = row.querySelectorAll('td, th');
		const rowData: Record<string, string> = {};

		cells.forEach((cell, j) => {
			const header = headers[j] || `column_${j}`;
			let value = (cell.textContent || '').trim();

			if (includeLinks) {
				const link = cell.querySelector('a[href]');
				if (link) {
					const href = link.getAttribute('href') || '';
					value = `${value} [${href}]`;
				}
			}

			rowData[header] = value;
		});

		rows.push(rowData);
	}

	return {
		success: true,
		data: {
			selector,
			headers,
			rows,
			totalRows,
			truncated: totalRows > maxRows,
		},
	};
}

/** Handle div-based data grids (role="grid", role="row", role="cell") */
function readDataGrid(
	container: Element,
	maxRows: number,
	includeLinks: boolean,
	selector: string,
) {
	const gridRows = container.querySelectorAll('[role="row"]');
	if (gridRows.length === 0) {
		return { success: false, error: `No table or data grid found at: ${selector}` };
	}

	// First row is usually headers
	const headers: string[] = [];
	const headerRow = gridRows[0];
	for (const cell of headerRow.querySelectorAll('[role="columnheader"], [role="cell"], th, td')) {
		headers.push((cell.textContent || '').trim());
	}

	const rows: Record<string, string>[] = [];
	let totalRows = 0;

	for (let i = 1; i < gridRows.length; i++) {
		totalRows++;
		if (rows.length >= maxRows) continue;

		const cells = gridRows[i].querySelectorAll('[role="cell"], [role="gridcell"], td');
		const rowData: Record<string, string> = {};

		cells.forEach((cell, j) => {
			const header = headers[j] || `column_${j}`;
			let value = (cell.textContent || '').trim();
			if (includeLinks) {
				const link = cell.querySelector('a[href]');
				if (link) value = `${value} [${link.getAttribute('href') || ''}]`;
			}
			rowData[header] = value;
		});

		rows.push(rowData);
	}

	return {
		success: true,
		data: { selector, headers, rows, totalRows, truncated: totalRows > maxRows },
	};
}

function goBackInPage() {
	window.history.back();
	return { success: true };
}

function getDomainFromTab(tab: chrome.tabs.Tab): string | null {
	try {
		return tab.url ? new URL(tab.url).hostname : null;
	} catch {
		return null;
	}
}

function refreshPageStateInPage() {
	// Full re-index — same as content script indexer but inline for executeScript
	const INTERACTIVE_SELECTORS = [
		'button',
		'a[href]',
		'input',
		'select',
		'textarea',
		'[role="button"]',
		'[role="link"]',
		'[role="checkbox"]',
		'[role="radio"]',
		'[role="tab"]',
		'[role="menuitem"]',
		'[onclick]',
		'table',
		'form',
	];

	type ElemType =
		| 'button'
		| 'link'
		| 'input'
		| 'select'
		| 'textarea'
		| 'checkbox'
		| 'radio'
		| 'table'
		| 'form'
		| 'other';

	function getElemType(el: Element): ElemType {
		const tag = el.tagName.toLowerCase();
		const role = el.getAttribute('role');
		if (tag === 'button' || role === 'button') return 'button';
		if (tag === 'a') return 'link';
		if (tag === 'input') {
			const t = (el as HTMLInputElement).type;
			if (t === 'checkbox') return 'checkbox';
			if (t === 'radio') return 'radio';
			return 'input';
		}
		if (tag === 'select') return 'select';
		if (tag === 'textarea') return 'textarea';
		if (tag === 'table') return 'table';
		if (tag === 'form') return 'form';
		return 'other';
	}

	function getLabel(el: Element): string {
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel) return ariaLabel;
		const id = el.getAttribute('id');
		if (id) {
			const lbl = document.querySelector(`label[for="${id}"]`);
			if (lbl?.textContent?.trim()) return lbl.textContent.trim().slice(0, 100);
		}
		return (
			el.getAttribute('title') ||
			el.textContent?.trim().slice(0, 100) ||
			el.getAttribute('placeholder') ||
			el.getAttribute('name') ||
			el.tagName.toLowerCase()
		);
	}

	function buildSel(el: Element): string {
		const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
		if (testId) return `[data-testid="${testId}"]`;
		if (el.id) return `#${el.id}`;
		const tag = el.tagName.toLowerCase();
		const ariaLabel = el.getAttribute('aria-label');
		if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;
		const name = el.getAttribute('name');
		if (name) return `${tag}[name="${name}"]`;
		const cls = Array.from(el.classList).slice(0, 3).join('.');
		if (cls) {
			const s = `${tag}.${cls}`;
			if (document.querySelectorAll(s).length === 1) return s;
		}
		// nth-child fallback
		const parts: string[] = [];
		let cur: Element | null = el;
		for (let d = 0; d < 3 && cur && cur !== document.body; d++) {
			const parent = cur.parentElement;
			if (!parent) break;
			const idx = Array.from(parent.children).indexOf(cur) + 1;
			parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
			cur = parent;
		}
		return parts.join(' > ');
	}

	const elements: unknown[] = [];
	const seen = new Set<Element>();

	for (const sel of INTERACTIVE_SELECTORS) {
		for (const el of document.querySelectorAll(sel)) {
			if (seen.has(el)) continue;
			seen.add(el);
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			const style = getComputedStyle(el);
			if (style.display === 'none' || style.visibility === 'hidden') continue;

			elements.push({
				id: crypto.randomUUID(),
				type: getElemType(el),
				label: getLabel(el),
				selector: buildSel(el),
				fallbackSelectors: [],
				attributes: {},
				position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				visible: true,
				pageUrl: window.location.href,
			});
		}
	}

	const navLinks = Array.from(document.querySelectorAll('a[href]'))
		.filter((a) => {
			const href = a.getAttribute('href') || '';
			return (
				(href.startsWith('/') || href.startsWith(window.location.origin)) &&
				!href.startsWith('javascript:') &&
				!href.match(/\.(pdf|png|jpg|jpeg|gif|svg|css|js|zip|csv)$/i)
			);
		})
		.map((a) => ({
			label: a.textContent?.trim().slice(0, 80) || '',
			href: new URL(a.getAttribute('href') || '', window.location.origin).pathname,
		}))
		.filter((l, i, arr) => l.href && arr.findIndex((x) => x.href === l.href) === i);

	const path = window.location.pathname;
	let pageType = 'other';
	if (path.includes('settings') || path.includes('preferences')) pageType = 'settings';
	else if (
		document.querySelectorAll('form').length > 0 &&
		document.querySelectorAll('table').length === 0
	)
		pageType = 'form';
	else if (document.querySelectorAll('table').length > 0) pageType = 'table';
	else if (path.match(/\/\d+$/) || path.match(/\/[a-f0-9-]{36}$/)) pageType = 'detail';
	else if (path === '/' || path.includes('dashboard') || path.includes('home'))
		pageType = 'dashboard';

	const pageIndex = {
		url: window.location.href,
		urlPattern: path.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{36}/g, '/:id'),
		title: document.title,
		pageType,
		elements,
		navigationLinks: navLinks,
		timestamp: Date.now(),
	};

	return {
		success: true,
		data: {
			url: window.location.href,
			title: document.title,
			elements: elements.slice(0, 200),
			pageIndex,
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

/**
 * Request vector search from backend — 4th tier of selector resilience.
 * Returns the best matching selector, or null if nothing found.
 */
function requestVectorSearch(label: string, elementType: string): Promise<string | null> {
	return new Promise((resolve) => {
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			resolve(null);
			return;
		}

		// Get current tab domain
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

// Callbacks for pending vector search requests
const vectorSearchCallbacks = new Map<string, (result: { selector: string } | null) => void>();

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
