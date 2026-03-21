/**
 * Action request handler — dispatches browser actions from the agent orchestrator.
 * Receives action requests from WebSocket, executes them in the target tab, and returns results.
 */

import {
	clickInPage,
	typeInPage,
	selectInPage,
	getPageStateInPage,
	scrollInPage,
	waitForElementInPage,
	readTextInPage,
	readTableInPage,
	goBackInPage,
	refreshPageStateInPage,
} from './page-scripts.js';

export interface ActionContext {
	sendResult: (requestId: string, result: unknown) => void;
	sendPageIndexed: (domain: string, pageIndex: unknown) => void;
	requestVectorSearch: (label: string, elementType: string) => Promise<string | null>;
	subAgentTabs: Map<number, string>;
}

export async function handleActionRequest(
	message: { requestId: string; payload: Record<string, unknown> },
	ctx: ActionContext,
) {
	const { requestId, payload } = message;
	const action = payload.action as string;
	console.log(`[AFE WS] Action: ${action}`, payload);

	// Sub-agent tab management — open_tab / close_tab don't need a target tab
	if (action === 'open_tab') {
		try {
			const url = (payload.url as string) || 'about:blank';
			const agentId = (payload.agentId as string) || '';
			const newTab = await chrome.tabs.create({ url, active: false });
			if (newTab.id) {
				ctx.subAgentTabs.set(newTab.id, agentId);
				// Wait for the tab to finish loading
				await new Promise<void>((resolve) => {
					const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
						if (tabId === newTab.id && changeInfo.status === 'complete') {
							chrome.tabs.onUpdated.removeListener(listener);
							resolve();
						}
					};
					chrome.tabs.onUpdated.addListener(listener);
					// Timeout after 15s
					setTimeout(() => {
						chrome.tabs.onUpdated.removeListener(listener);
						resolve();
					}, 15000);
				});
			}
			// Notify side panel about new sub-agent tab
			chrome.runtime
				.sendMessage({
					type: 'SUB_AGENT_TAB_OPENED',
					tabId: newTab.id,
					agentId,
					url,
				})
				.catch(() => {});
			ctx.sendResult(requestId, { success: true, data: { tabId: newTab.id } });
		} catch (err) {
			ctx.sendResult(requestId, {
				success: false,
				error: `Failed to open tab: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
		return;
	}

	if (action === 'close_tab') {
		try {
			const tabId = payload.tabId as number;
			if (tabId) {
				ctx.subAgentTabs.delete(tabId);
				await chrome.tabs.remove(tabId);
				chrome.runtime.sendMessage({ type: 'SUB_AGENT_TAB_CLOSED', tabId }).catch(() => {});
			}
			ctx.sendResult(requestId, { success: true });
		} catch (err) {
			ctx.sendResult(requestId, { success: true }); // Don't fail if tab already closed
		}
		return;
	}

	// Determine target tab: use explicit targetTabId/tabId for pinned conversations + sub-agents, else active tab
	let tab: chrome.tabs.Tab | undefined;
	const explicitTabId = (payload.targetTabId || payload.tabId) as number | undefined;
	if (explicitTabId) {
		try {
			tab = await chrome.tabs.get(explicitTabId);
		} catch {
			// Tab might have been closed — fall back to active tab
			console.warn(`[AFE WS] Target tab ${explicitTabId} not found, falling back to active tab`);
			const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
			tab = tabs[0];
		}
	} else {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		tab = tabs[0];
	}

	if (!tab?.id) {
		ctx.sendResult(requestId, { success: false, error: 'No target tab found' });
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
		const vectorSelector = await ctx.requestVectorSearch(label, elementType);
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

	// Helper: retry an action once after a short delay if element not found
	async function withRetry(fn: () => Promise<unknown>): Promise<unknown> {
		const first = await fn();
		const r = first as { success?: boolean; error?: string } | null;
		if (r?.success || !r?.error?.includes('not found')) return first;
		// Wait 1.5s for DOM to settle (SPA renders, overlays appearing)
		await new Promise((resolve) => setTimeout(resolve, 1500));
		console.log(`[AFE WS] Retrying after element not found...`);
		return fn();
	}

	try {
		let result: unknown;

		if (action === 'navigate') {
			await chrome.tabs.update(tab.id, { url: payload.url as string });
			await waitForTabLoad(tab.id);
			result = { success: true, data: { navigatedTo: payload.url } };
		} else if (action === 'click_element') {
			result = await withRetry(() =>
				executeInTab(tab.id!, clickInPage, [
					payload.selector as string,
					fallbacksStr,
					elementLabel,
					elementType,
				]),
			);
			result = await withVectorFallback(tab.id, action, result, elementLabel, elementType);
		} else if (action === 'type_text') {
			result = await withRetry(() =>
				executeInTab(tab.id!, typeInPage, [
					payload.selector as string,
					payload.text as string,
					fallbacksStr,
					elementLabel,
				]),
			);
			result = await withVectorFallback(tab.id, action, result, elementLabel, 'input');
		} else if (action === 'select_option') {
			result = await withRetry(() =>
				executeInTab(tab.id!, selectInPage, [
					payload.selector as string,
					payload.value as string,
					fallbacksStr,
					elementLabel,
				]),
			);
			result = await withVectorFallback(tab.id, action, result, elementLabel, 'select');
		} else if (action === 'get_page_state') {
			result = await executeInTab(tab.id, getPageStateInPage, []);
		} else if (action === 'screenshot') {
			// captureVisibleTab() captures whatever tab is currently visible.
			// If the agent is pinned to a specific tab (targetTabId) and the user
			// switched away, we need to briefly activate the target tab to capture it.
			const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
			const activeTabId = activeTabs[0]?.id;
			const needsTabSwitch = tab.id !== activeTabId;
			let previousTabId: number | undefined;

			if (needsTabSwitch && tab.id) {
				previousTabId = activeTabId;
				await chrome.tabs.update(tab.id, { active: true });
				// Wait for the tab to become visible
				await new Promise((resolve) => setTimeout(resolve, 300));
			}

			// Capture at moderate quality, then resize via offscreen canvas for smaller context
			const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 40 });
			// Resize to max 1280px wide using offscreen document or direct encoding
			let finalBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
			try {
				// Use createImageBitmap + OffscreenCanvas to resize
				const response = await fetch(dataUrl);
				const blob = await response.blob();
				const bitmap = await createImageBitmap(blob);
				const maxWidth = 1280;
				const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
				const w = Math.round(bitmap.width * scale);
				const h = Math.round(bitmap.height * scale);
				const canvas = new OffscreenCanvas(w, h);
				const canvasCtx = canvas.getContext('2d');
				if (canvasCtx) {
					canvasCtx.drawImage(bitmap, 0, 0, w, h);
					const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.35 });
					const arrayBuffer = await resizedBlob.arrayBuffer();
					const bytes = new Uint8Array(arrayBuffer);
					let binary = '';
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]);
					}
					finalBase64 = btoa(binary);
				}
				bitmap.close();
			} catch (resizeErr) {
				console.warn('[AFE WS] Screenshot resize failed, using original:', resizeErr);
			}
			// Switch back to user's original tab
			if (needsTabSwitch && previousTabId) {
				await chrome.tabs.update(previousTabId, { active: true });
			}

			result = {
				success: true,
				data: { image: finalBase64, format: 'jpeg', url: tab.url, title: tab.title },
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
					ctx.sendPageIndexed(domain, pageResult.data.pageIndex);
				}
			}
		} else {
			result = { success: false, error: `Unknown action: ${action}` };
		}

		console.log('[AFE WS] Action result:', result);
		ctx.sendResult(requestId, result);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		console.error('[AFE WS] Action error:', errorMsg);
		ctx.sendResult(requestId, { success: false, error: errorMsg });
	}
}

/**
 * Execute a function in the tab's page context via chrome.scripting.executeScript.
 * This works regardless of whether the content script is loaded.
 */
export async function executeInTab(
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
export async function executeInTabAsync(
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

export function getDomainFromTab(tab: chrome.tabs.Tab): string | null {
	try {
		return tab.url ? new URL(tab.url).hostname : null;
	} catch {
		return null;
	}
}

export function waitForTabLoad(tabId: number): Promise<void> {
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
