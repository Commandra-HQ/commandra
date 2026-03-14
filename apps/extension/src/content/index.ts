import { type ActionPayload, executeAction } from './actions.js';
import { indexPage } from './indexer.js';

/**
 * Content script — runs on every page.
 * Indexes interactive elements, executes agent actions, responds to messages.
 */

let cachedIndex = indexPage();
let lastElementCount = cachedIndex.elements.length;
console.log(`[AFE] Indexed ${cachedIndex.elements.length} elements on ${window.location.href}`);

// Push initial index to backend
pushIndexToBackend(cachedIndex);

// Re-index when the page changes (SPA navigation)
let lastUrl = window.location.href;
let reindexTimer: ReturnType<typeof setTimeout> | null = null;

function reindexAndPush() {
	cachedIndex = indexPage();
	lastElementCount = cachedIndex.elements.length;
	console.log(
		`[AFE] Re-indexed ${cachedIndex.elements.length} elements on ${window.location.href}`,
	);
	pushIndexToBackend(cachedIndex);
}

function pushIndexToBackend(pageIndex: unknown) {
	try {
		const domain = new URL(window.location.href).hostname;
		chrome.runtime.sendMessage({
			type: 'PAGE_INDEXED',
			domain,
			pageIndex,
		});
	} catch {}
}

const observer = new MutationObserver(() => {
	// URL change = SPA navigation → re-index immediately
	if (window.location.href !== lastUrl) {
		lastUrl = window.location.href;
		reindexAndPush();
		return;
	}

	// Significant DOM change → debounced re-index
	if (reindexTimer) return;
	reindexTimer = setTimeout(() => {
		reindexTimer = null;
		const testIndex = indexPage();
		const countDiff = Math.abs(testIndex.elements.length - lastElementCount);
		const threshold = Math.max(lastElementCount * 0.2, 3);
		if (countDiff >= threshold) {
			cachedIndex = testIndex;
			lastElementCount = cachedIndex.elements.length;
			console.log(`[AFE] DOM changed significantly (${countDiff} elements), re-indexed`);
			pushIndexToBackend(cachedIndex);
		}
	}, 5000);
});

observer.observe(document.body, { childList: true, subtree: true });

// Also catch popstate (back/forward navigation)
window.addEventListener('popstate', () => {
	reindexAndPush();
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'INDEX_PAGE':
			cachedIndex = indexPage();
			sendResponse({ pageIndex: cachedIndex });
			break;
		case 'get_page_state':
			sendResponse({ pageIndex: cachedIndex });
			break;
		case 'EXECUTE_ACTION': {
			const payload = message.payload as ActionPayload;
			console.log(`[AFE] Executing action: ${payload.action}`, payload);
			const result = executeAction(payload);
			console.log(`[AFE] Action result:`, result);
			sendResponse(result);
			break;
		}
	}
	return true;
});

// Kill switch — Escape key halts all agent activity
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		chrome.runtime.sendMessage({ type: 'kill' });
	}
});

// Bridge for manual recording — page context posts messages, we forward to background
window.addEventListener('message', (e) => {
	if (e.source !== window) return;
	if (e.data?.type === '__AFE_RECORDED_ACTION') {
		chrome.runtime.sendMessage({
			type: 'RECORDED_ACTION',
			action: e.data.action,
			args: e.data.args,
			url: e.data.url,
		});
	}
});
