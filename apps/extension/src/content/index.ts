import { indexPage } from './indexer.js';
import { executeAction, type ActionPayload } from './actions.js';
import { startSelector, stopSelector } from './selector.js';

/**
 * Content script — runs on every page.
 * Indexes interactive elements, executes agent actions, responds to messages.
 */

let cachedIndex = indexPage();
console.log(`[AFE] Indexed ${cachedIndex.elements.length} elements on ${window.location.href}`);

// Re-index when the page changes (SPA navigation)
let lastUrl = window.location.href;

const observer = new MutationObserver(() => {
	if (window.location.href !== lastUrl) {
		lastUrl = window.location.href;
		cachedIndex = indexPage();
		console.log(`[AFE] Re-indexed ${cachedIndex.elements.length} elements on ${lastUrl}`);
	}
});

observer.observe(document.body, { childList: true, subtree: true });

// Also catch popstate (back/forward navigation)
window.addEventListener('popstate', () => {
	cachedIndex = indexPage();
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
		case 'SELECTOR_START':
			startSelector();
			sendResponse({ ok: true });
			break;
		case 'SELECTOR_STOP':
			stopSelector();
			sendResponse({ ok: true });
			break;
	}
	return true;
});

// Kill switch — Escape key halts all agent activity
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		chrome.runtime.sendMessage({ type: 'kill' });
	}
});
