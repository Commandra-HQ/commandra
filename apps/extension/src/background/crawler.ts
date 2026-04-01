import type { PageIndex } from '@commandra/shared';
import type { CrawlProgress } from '@commandra/shared';
import { sendPageIndexed } from './ws-client.js';

const CRAWL_DELAY_MS = 1500;
const MAX_PAGES_DEFAULT = 25;
const MAX_DEPTH_DEFAULT = 2;

let crawlTabId: number | null = null;
let isCrawling = false;

function getDomain(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

function normalizeUrl(href: string, origin: string): string | null {
	try {
		const url = new URL(href, origin);
		// Same origin only
		if (url.origin !== new URL(origin).origin) return null;
		// Skip non-page resources
		if (url.pathname.match(/\.(pdf|png|jpg|jpeg|gif|svg|css|js|zip|csv|woff|woff2|ttf|ico)$/i))
			return null;
		// Skip fragments and javascript:
		if (href.startsWith('javascript:') || href === '#') return null;
		// Return without hash/search for dedup
		return `${url.origin}${url.pathname}`;
	} catch {
		return null;
	}
}

function toUrlPattern(pathname: string): string {
	return pathname.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{36}/g, '/:id');
}

function broadcastProgress(progress: CrawlProgress) {
	chrome.runtime.sendMessage({ type: 'CRAWL_PROGRESS', payload: progress }).catch(() => {
		// Side panel might not be open, that's fine
	});
}

async function indexTabPage(tabId: number): Promise<PageIndex | null> {
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId },
			func: () => {
				// This runs in the page context — we need to re-import the indexer logic inline
				// since we can't import modules in executeScript
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
					return (
						el.getAttribute('aria-label') ||
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
					const name = el.getAttribute('name');
					if (name) return `${tag}[name="${name}"]`;
					const cls = Array.from(el.classList).slice(0, 3).join('.');
					if (cls) return `${tag}.${cls}`;
					return tag;
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

				return {
					url: window.location.href,
					urlPattern: path.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{36}/g, '/:id'),
					title: document.title,
					pageType,
					elements,
					navigationLinks: navLinks,
					timestamp: Date.now(),
				};
			},
		});

		return results?.[0]?.result as PageIndex | null;
	} catch (err) {
		console.error('[Commandra Crawler] Failed to index tab:', err);
		return null;
	}
}

export async function indexCurrentPage(tabId: number): Promise<PageIndex | null> {
	try {
		const [result] = await chrome.scripting.executeScript({
			target: { tabId },
			files: ['src/content/index.ts'],
		});
		// Request index via messaging
		return new Promise((resolve) => {
			chrome.tabs.sendMessage(tabId, { type: 'INDEX_PAGE' }, (response) => {
				resolve(response?.pageIndex ?? null);
			});
		});
	} catch {
		// Content script might already be injected, just message it
		return new Promise((resolve) => {
			chrome.tabs.sendMessage(tabId, { type: 'INDEX_PAGE' }, (response) => {
				if (chrome.runtime.lastError) {
					resolve(null);
					return;
				}
				resolve(response?.pageIndex ?? null);
			});
		});
	}
}

/**
 * Compute the path prefix scope for crawling.
 * e.g. /org/app/settings → /org/app
 * For root paths (/ or /dashboard), scope is just /
 */
function getPathScope(pathname: string): string {
	const segments = pathname.split('/').filter(Boolean);
	// If 2+ segments, use first 2 as scope (covers org/repo, app/section patterns)
	if (segments.length >= 2) return `/${segments[0]}/${segments[1]}`;
	// If 1 segment, use it
	if (segments.length === 1) return `/${segments[0]}`;
	// Root
	return '/';
}

function isInScope(url: string, origin: string, pathScope: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.origin !== new URL(origin).origin) return false;
		// Root scope means everything on this domain is in scope
		if (pathScope === '/') return true;
		return parsed.pathname === pathScope || parsed.pathname.startsWith(`${pathScope}/`);
	} catch {
		return false;
	}
}

interface QueueEntry {
	url: string;
	depth: number;
}

export async function startCrawl(
	startTabId: number,
	maxPages = MAX_PAGES_DEFAULT,
	maxDepth = MAX_DEPTH_DEFAULT,
) {
	const tab = await chrome.tabs.get(startTabId);
	if (!tab.url) return;

	const origin = new URL(tab.url).origin;
	const domain = getDomain(tab.url);
	const startPath = new URL(tab.url).pathname;
	const pathScope = getPathScope(startPath);

	if (isCrawling) {
		console.log('[Commandra Crawler] Already crawling, ignoring');
		return;
	}

	isCrawling = true;
	console.log(
		`[Commandra Crawler] Starting crawl of ${domain} scoped to ${pathScope} (max ${maxPages} pages, depth ${maxDepth})`,
	);

	const visitedPatterns = new Set<string>();
	const visited = new Set<string>();
	const queue: QueueEntry[] = [{ url: tab.url, depth: 0 }];

	// Crawl state is in-memory only — no IndexedDB

	broadcastProgress({
		domain,
		pagesIndexed: 0,
		pagesDiscovered: 1,
		currentUrl: null,
		status: 'crawling',
	});

	// Create a background tab for crawling
	const crawlTab = await chrome.tabs.create({ url: 'about:blank', active: false });
	crawlTabId = crawlTab.id!;

	try {
		while (queue.length > 0 && visited.size < maxPages && isCrawling) {
			const entry = queue.shift()!;
			const { url, depth } = entry;

			if (visited.has(url)) continue;

			// Check scope
			if (!isInScope(url, origin, pathScope)) {
				visited.add(url);
				continue;
			}

			const pattern = toUrlPattern(new URL(url).pathname);
			if (visitedPatterns.has(pattern)) {
				visited.add(url);
				continue;
			}

			visited.add(url);
			visitedPatterns.add(pattern);

			broadcastProgress({
				domain,
				pagesIndexed: visited.size,
				pagesDiscovered: queue.length + visited.size,
				currentUrl: url,
				status: 'crawling',
			});

			// Navigate the background tab
			try {
				await chrome.tabs.update(crawlTabId, { url });
				await waitForTabLoad(crawlTabId);
				await sleep(500);

				const pageIndex = await indexTabPage(crawlTabId);

				if (pageIndex) {
					// Push to backend via WS
					sendPageIndexed(domain, pageIndex);

					// Only follow links if we haven't hit depth limit
					if (depth < maxDepth) {
						for (const link of pageIndex.navigationLinks) {
							const normalized = normalizeUrl(link.href, origin);
							if (
								normalized &&
								!visited.has(normalized) &&
								isInScope(normalized, origin, pathScope)
							) {
								queue.push({ url: normalized, depth: depth + 1 });
							}
						}
					}
				}
			} catch (err) {
				console.error(`[Commandra Crawler] Error crawling ${url}:`, err);
			}

			await sleep(CRAWL_DELAY_MS);
		}
	} finally {
		if (crawlTabId) {
			try {
				await chrome.tabs.remove(crawlTabId);
			} catch {}
			crawlTabId = null;
		}

		const finalStatus = isCrawling ? 'complete' : 'stopped';
		isCrawling = false;

		broadcastProgress({
			domain,
			pagesIndexed: visited.size,
			pagesDiscovered: visited.size,
			currentUrl: null,
			status: finalStatus,
		});

		console.log(
			`[Commandra Crawler] Finished: ${visited.size} pages indexed within scope ${pathScope}`,
		);
	}
}

export function stopCrawl() {
	isCrawling = false;
}

function waitForTabLoad(tabId: number): Promise<void> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			resolve();
		}, 10000); // 10s timeout

		function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
			if (updatedTabId === tabId && changeInfo.status === 'complete') {
				clearTimeout(timeout);
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		}

		chrome.tabs.onUpdated.addListener(listener);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
