import { indexPage } from './indexer.js';

/**
 * Content script — runs on every page.
 * Indexes interactive elements and responds to messages from background/side panel.
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
		case 'action_request':
			sendResponse({ status: 'not_implemented' });
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
