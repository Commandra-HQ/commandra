import { type ActionPayload, executeAction } from './actions.js';
import { indexPage } from './indexer.js';

/**
 * Content script — runs on every page.
 * Indexes interactive elements on-demand, executes agent actions, responds to messages.
 * Indexing only happens when explicitly requested (INDEX_PAGE, get_page_state).
 */

let cachedIndex = indexPage();
console.log(`[AFE] Indexed ${cachedIndex.elements.length} elements on ${window.location.href}`);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'INDEX_PAGE':
			cachedIndex = indexPage();
			sendResponse({ pageIndex: cachedIndex });
			break;
		case 'get_page_state':
			cachedIndex = indexPage();
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
