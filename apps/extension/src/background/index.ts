import { startSelectorInPage, stopSelectorInPage } from '../content/selector.js';
import { startCrawl, stopCrawl } from './crawler.js';
import {
	connectWebSocket,
	isConnected,
	sendApproval,
	sendKill,
	sendPageIndexed,
} from './ws-client.js';

// Injected at build time by Vite define (see vite.config.ts)
const API_URL = process.env.API_URL ?? 'http://localhost:3001';

// Open side panel when extension icon is clicked
chrome.sidePanel
	.setPanelBehavior({ openPanelOnActionClick: true })
	.catch((err: unknown) => console.error('Failed to set panel behavior:', err));

chrome.action.onClicked.addListener(async (tab) => {
	if (tab.id) {
		await chrome.sidePanel.open({ tabId: tab.id });
	}
});

chrome.runtime.onInstalled.addListener(() => {
	console.log('Commandra extension installed');
	connectWebSocket();
});

// Also connect on startup (extension reload, browser restart)
connectWebSocket();

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	switch (message.type) {
		case 'CRAWL_START': {
			const { tabId, maxPages } = message.payload as { tabId: number; maxPages?: number };
			startCrawl(tabId, maxPages);
			sendResponse({ ok: true });
			break;
		}

		case 'CRAWL_STOP': {
			stopCrawl();
			sendResponse({ ok: true });
			break;
		}

		case 'INDEX_PAGE_SINGLE': {
			const { tabId } = message.payload as { tabId: number };
			handleIndexSingle(tabId).then(sendResponse);
			return true; // async
		}

		case 'GET_SITE_DATA': {
			const { domain } = message.payload as { domain: string };
			handleGetSiteData(domain).then(sendResponse);
			return true; // async
		}

		case 'PAGE_INDEXED': {
			// Content script re-indexed a page (SPA nav or DOM change) — forward to backend
			const { domain: pageDomain, pageIndex: pi } = message as {
				domain: string;
				pageIndex: unknown;
			};
			if (pageDomain && pi) {
				sendPageIndexed(pageDomain, pi);
			}
			sendResponse({ ok: true });
			break;
		}

		case 'GET_WS_STATUS': {
			sendResponse({ connected: isConnected() });
			break;
		}

		case 'APPROVAL_RESPONSE': {
			const { requestId, approved, reason } = message as {
				requestId: string;
				approved: boolean;
				reason?: string;
			};
			sendApproval(requestId, approved, reason);
			sendResponse({ ok: true });
			break;
		}

		case 'SELECTOR_START': {
			const { tabId } = message.payload as { tabId: number };
			chrome.scripting
				.executeScript({
					target: { tabId },
					func: startSelectorInPage,
				})
				.then(() => sendResponse({ ok: true }))
				.catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
			return true; // async
		}

		case 'SELECTOR_STOP': {
			const { tabId } = message.payload as { tabId: number };
			chrome.scripting
				.executeScript({
					target: { tabId },
					func: stopSelectorInPage,
				})
				.then(() => sendResponse({ ok: true }))
				.catch(() => sendResponse({ ok: false }));
			return true; // async
		}

		case 'kill': {
			stopCrawl();
			sendKill();
			sendResponse({ ok: true });
			break;
		}
	}

	return true;
});

async function handleIndexSingle(tabId: number) {
	try {
		const response = await chrome.tabs.sendMessage(tabId, { type: 'INDEX_PAGE' });
		const pageIndex = response?.pageIndex;
		if (pageIndex) {
			const domain = new URL(pageIndex.url).hostname;
			// Push to backend via WS
			sendPageIndexed(domain, pageIndex);
			return { ok: true, pageIndex };
		}
		return { ok: false, error: 'No page index returned' };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

async function handleGetSiteData(domain: string) {
	try {
		const stored = await chrome.storage.local.get(['authToken']);
		const token = stored.authToken;
		if (!token) return { site: null, pages: [] };

		const res = await fetch(`${API_URL}/api/sites/${encodeURIComponent(domain)}`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!res.ok) return { site: null, pages: [] };

		const data = await res.json();
		// Map backend format to what ChatTab expects
		const site = data.site
			? {
					domain: data.site.domain,
					totalPages: data.site.totalPages || 0,
					totalElements: data.site.totalElements || 0,
					lastIndexedAt: data.site.lastCrawledAt ? new Date(data.site.lastCrawledAt).getTime() : 0,
					crawlStatus: 'idle' as const,
				}
			: null;

		const pages = (data.pages || []).map(
			(p: {
				url: string;
				urlPattern: string;
				title: string;
				pageType: string;
				elements: unknown[];
				navigationLinks: { label: string; href: string }[];
				lastIndexedAt: string;
			}) => ({
				domain,
				url: p.url,
				urlPattern: p.urlPattern || '',
				title: p.title || '',
				pageType: p.pageType || 'other',
				elements: p.elements || [],
				navigationLinks: p.navigationLinks || [],
				indexedAt: p.lastIndexedAt ? new Date(p.lastIndexedAt).getTime() : 0,
			}),
		);

		return { site, pages };
	} catch (err) {
		console.error('[Commandra] Failed to fetch site data from backend:', err);
		return { site: null, pages: [] };
	}
}
