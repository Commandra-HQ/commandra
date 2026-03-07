import Dexie, { type EntityTable } from 'dexie';
import type { IndexedElement, PageIndex } from '@afe/shared';

export interface StoredSite {
	domain: string;
	totalPages: number;
	totalElements: number;
	lastIndexedAt: number;
	crawlStatus: 'idle' | 'crawling' | 'complete' | 'stopped';
	/** URLs still in the crawl queue */
	crawlQueue: string[];
	/** URLs already visited */
	crawlVisited: string[];
}

export interface StoredPage {
	id?: number;
	domain: string;
	url: string;
	urlPattern: string;
	title: string;
	pageType: string;
	elements: IndexedElement[];
	navigationLinks: { label: string; href: string }[];
	indexedAt: number;
}

class AfeDatabase extends Dexie {
	sites!: EntityTable<StoredSite, 'domain'>;
	pages!: EntityTable<StoredPage, 'id'>;

	constructor() {
		super('afe-index');
		this.version(1).stores({
			sites: 'domain',
			pages: '++id, domain, url, urlPattern, [domain+urlPattern]',
		});
	}
}

export const db = new AfeDatabase();

/** Get or create a site record */
export async function getOrCreateSite(domain: string): Promise<StoredSite> {
	const existing = await db.sites.get(domain);
	if (existing) return existing;

	const site: StoredSite = {
		domain,
		totalPages: 0,
		totalElements: 0,
		lastIndexedAt: Date.now(),
		crawlStatus: 'idle',
		crawlQueue: [],
		crawlVisited: [],
	};
	await db.sites.put(site);
	return site;
}

/** Store a page index, deduplicating by URL pattern */
export async function storePage(domain: string, pageIndex: PageIndex): Promise<void> {
	const existing = await db.pages
		.where({ domain, urlPattern: pageIndex.urlPattern })
		.first();

	if (existing) {
		await db.pages.update(existing.id!, {
			url: pageIndex.url,
			title: pageIndex.title,
			pageType: pageIndex.pageType,
			elements: pageIndex.elements,
			navigationLinks: pageIndex.navigationLinks,
			indexedAt: Date.now(),
		});
	} else {
		await db.pages.add({
			domain,
			url: pageIndex.url,
			urlPattern: pageIndex.urlPattern,
			title: pageIndex.title,
			pageType: pageIndex.pageType,
			elements: pageIndex.elements,
			navigationLinks: pageIndex.navigationLinks,
			indexedAt: Date.now(),
		});
	}

	// Update site totals
	const allPages = await db.pages.where({ domain }).toArray();
	const totalElements = allPages.reduce((sum, p) => sum + p.elements.length, 0);
	await db.sites.update(domain, {
		totalPages: allPages.length,
		totalElements,
		lastIndexedAt: Date.now(),
	});
}

/** Get all pages for a site */
export async function getSitePages(domain: string): Promise<StoredPage[]> {
	return db.pages.where({ domain }).toArray();
}

/** Clear all data for a site */
export async function clearSite(domain: string): Promise<void> {
	await db.pages.where({ domain }).delete();
	await db.sites.delete(domain);
}
