import { indexPage } from './indexer.js';

/**
 * Content script — runs on every page.
 * 1. Indexes the page (extracts interactive elements)
 * 2. Listens for action requests from the backend (via background script)
 * 3. Executes actions on the DOM
 */

// Auto-index on page load
const pageIndex = indexPage();
console.log(`[AFE] Indexed ${pageIndex.elements.length} elements on ${window.location.href}`);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'get_page_state':
			sendResponse({ pageIndex });
			break;
		case 'action_request':
			// TODO: Execute action on DOM
			sendResponse({ status: 'not_implemented' });
			break;
	}
	return true; // Keep message channel open for async response
});

// Kill switch — Escape key halts all agent activity
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape') {
		chrome.runtime.sendMessage({ type: 'kill' });
	}
});
