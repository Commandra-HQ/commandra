import { and, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { pages, sites } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { inngest } from '../inngest/client.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const siteRoutes = new Hono<{ Variables: { user: AuthUser } }>();

siteRoutes.use('*', requireAuth);

// List sites — compute page/element counts live from pages table
siteRoutes.get('/', async (c) => {
	const user = c.get('user');

	const rows = await db
		.select({
			id: sites.id,
			domain: sites.domain,
			totalPages: sites.totalPages,
			totalElements: sites.totalElements,
			lastCrawledAt: sites.lastCrawledAt,
			createdAt: sites.createdAt,
		})
		.from(sites)
		.where(getOrgOrUserScope(user, sites));

	if (rows.length === 0) return c.json({ sites: [] });

	// Compute live page counts to avoid stale cached values (e.g. interrupted crawls)
	const siteIds = rows.map((r) => r.id);
	const liveCounts = await db
		.select({
			siteId: pages.siteId,
			pageCount: count(pages.id),
		})
		.from(pages)
		.where(sql`${pages.siteId} IN (${sql.join(siteIds.map((id) => sql`${id}`), sql`, `)})`)
		.groupBy(pages.siteId);

	const countMap = new Map(liveCounts.map((r) => [r.siteId, r.pageCount]));

	const enriched = rows.map((site) => ({
		...site,
		totalPages: countMap.get(site.id) ?? 0,
	}));

	return c.json({ sites: enriched });
});

// Get site with pages (includes elements for each page)
siteRoutes.get('/:domain', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');

	const [site] = await db
		.select()
		.from(sites)
		.where(eq(sites.domain, domain))
		.limit(1);

	if (!site) {
		return c.json({ error: 'Not found' }, 404);
	}

	// User can access if: they own it personally OR it belongs to their org
	const isOwner = site.userId === user.id;
	const isOrgMember = user.orgId && site.orgId === user.orgId;
	if (!isOwner && !isOrgMember) {
		return c.json({ error: 'Not found' }, 404);
	}

	const sitePages = await db
		.select({
			id: pages.id,
			url: pages.url,
			urlPattern: pages.urlPattern,
			title: pages.title,
			pageType: pages.pageType,
			elements: pages.elements,
			navigationLinks: pages.navigationLinks,
			lastIndexedAt: pages.lastIndexedAt,
		})
		.from(pages)
		.where(eq(pages.siteId, site.id));

	return c.json({ site, pages: sitePages });
});

// Upsert a page (called by extension after indexing)
siteRoutes.post('/:domain/pages', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');
	const body = await c.req.json();
	const { pageIndex } = body as { pageIndex: PageIndexPayload };

	if (!pageIndex?.url) return c.json({ error: 'pageIndex required' }, 400);

	// Get or create site
	let [site] = await db
		.select()
		.from(sites)
		.where(and(eq(sites.domain, domain), getOrgOrUserScope(user, sites)))
		.limit(1);

	if (!site) {
		[site] = await db
			.insert(sites)
			.values({ userId: user.id, orgId: user.orgId || null, domain })
			.returning();
	}

	await upsertPage(site.id, pageIndex);
	await updateSiteTotals(site.id);

	return c.json({ ok: true });
});

interface PageIndexPayload {
	url: string;
	urlPattern?: string;
	title?: string;
	pageType?: string;
	elements?: unknown[];
	navigationLinks?: unknown[];
}

/** Upsert a page by siteId + urlPattern. Returns the page ID. */
export async function upsertPage(siteId: string, pageIndex: PageIndexPayload): Promise<string> {
	const urlPattern =
		pageIndex.urlPattern ||
		new URL(pageIndex.url).pathname.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9-]{36}/g, '/:id');

	const [existing] = await db
		.select({ id: pages.id })
		.from(pages)
		.where(and(eq(pages.siteId, siteId), eq(pages.urlPattern, urlPattern)))
		.limit(1);

	let pageId: string;

	if (existing) {
		pageId = existing.id;
		await db
			.update(pages)
			.set({
				url: pageIndex.url,
				title: pageIndex.title || null,
				pageType: pageIndex.pageType || null,
				elements: pageIndex.elements || [],
				navigationLinks: pageIndex.navigationLinks || [],
				lastIndexedAt: new Date(),
			})
			.where(eq(pages.id, existing.id));
	} else {
		const [inserted] = await db.insert(pages).values({
			siteId,
			url: pageIndex.url,
			urlPattern,
			title: pageIndex.title || null,
			pageType: pageIndex.pageType || null,
			elements: pageIndex.elements || [],
			navigationLinks: pageIndex.navigationLinks || [],
		}).returning({ id: pages.id });
		pageId = inserted.id;
	}

	// Fire background embedding job (non-blocking)
	inngest.send({ name: 'page/upserted', data: { pageId } }).catch(() => {});

	return pageId;
}

/** Recalculate site totals from its pages */
export async function updateSiteTotals(siteId: string) {
	const sitePages = await db
		.select({ elements: pages.elements })
		.from(pages)
		.where(eq(pages.siteId, siteId));

	const totalPages = sitePages.length;
	const totalElements = sitePages.reduce(
		(sum, p) => sum + ((p.elements as unknown[])?.length || 0),
		0,
	);

	await db
		.update(sites)
		.set({ totalPages, totalElements, lastCrawledAt: new Date() })
		.where(eq(sites.id, siteId));
}
