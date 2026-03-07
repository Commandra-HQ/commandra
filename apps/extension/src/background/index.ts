import { startCrawl, stopCrawl, indexCurrentPage } from './crawler.js';
import { db, getOrCreateSite, storePage } from '../storage/db.js';

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
	console.log('Agents for Everyone extension installed');
});

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

		case 'GET_CRAWL_STATUS': {
			const { domain } = message.payload as { domain: string };
			db.sites.get(domain).then((site) => {
				sendResponse({
					status: site?.crawlStatus ?? 'idle',
					totalPages: site?.totalPages ?? 0,
					totalElements: site?.totalElements ?? 0,
				});
			});
			return true; // async
		}

		case 'GET_SITE_DATA': {
			const { domain } = message.payload as { domain: string };
			handleGetSiteData(domain).then(sendResponse);
			return true; // async
		}

		case 'CLEAR_SITE': {
			const { domain } = message.payload as { domain: string };
			import('../storage/db.js').then(({ clearSite }) => {
				clearSite(domain).then(() => sendResponse({ ok: true }));
			});
			return true; // async
		}

		case 'kill': {
			stopCrawl();
			sendResponse({ ok: true });
			break;
		}
	}

	return true;
});

async function handleIndexSingle(tabId: number) {
	try {
		// Send INDEX_PAGE to the content script on that tab
		const response = await chrome.tabs.sendMessage(tabId, { type: 'INDEX_PAGE' });
		const pageIndex = response?.pageIndex;
		if (pageIndex) {
			const domain = new URL(pageIndex.url).hostname;
			await getOrCreateSite(domain);
			await storePage(domain, pageIndex);
			return { ok: true, pageIndex };
		}
		return { ok: false, error: 'No page index returned' };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

async function handleGetSiteData(domain: string) {
	const site = await db.sites.get(domain);
	if (!site) return { site: null, pages: [] };
	const pages = await db.pages.where({ domain }).toArray();
	return { site, pages };
}
