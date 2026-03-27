import { normalizeUrlPattern } from '@afe/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { pages, sites } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { buildSitemapFromDB, loadSitemap, updateSitemap } from '../storage/sitemap.js';
import { parsePagination } from '../utils/pagination.js';

export const siteRoutes = new Hono<{ Variables: { user: AuthUser } }>();

siteRoutes.use('*', requireAuth);

// List sites — compute page/element counts live from pages table
siteRoutes.get('/', async (c) => {
	const user = c.get('user');
	const { limit, offset } = parsePagination(c);

	const scope = getOrgOrUserScope(user, sites);

	const [totalResult] = await db.select({ count: count() }).from(sites).where(scope);

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
		.where(scope)
		.limit(limit)
		.offset(offset);

	if (rows.length === 0) return c.json({ sites: [], total: totalResult?.count ?? 0 });

	// Compute live page counts to avoid stale cached values (e.g. interrupted crawls)
	const siteIds = rows.map((r) => r.id);
	const liveCounts = await db
		.select({
			siteId: pages.siteId,
			pageCount: count(pages.id),
		})
		.from(pages)
		.where(
			sql`${pages.siteId} IN (${sql.join(
				siteIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)
		.groupBy(pages.siteId);

	const countMap = new Map(liveCounts.map((r) => [r.siteId, r.pageCount]));

	const enriched = rows.map((site) => ({
		...site,
		totalPages: countMap.get(site.id) ?? 0,
	}));

	return c.json({ sites: enriched, total: totalResult?.count ?? 0 });
});

// Get site with pages (includes elements for each page)
siteRoutes.get('/:domain', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');

	const [site] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);

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

	// Update navigation graph (fire-and-forget)
	updateSitemap(user.id, domain, {
		url: pageIndex.url,
		urlPattern: pageIndex.urlPattern,
		title: pageIndex.title,
		pageType: pageIndex.pageType,
		elements: pageIndex.elements,
		navigationLinks: pageIndex.navigationLinks as { label: string; href: string }[] | undefined,
	}).catch((err) => console.error('[sitemap] Failed to update:', err));

	return c.json({ ok: true });
});

// Build/rebuild sitemap from existing DB pages
siteRoutes.post('/:domain/graph/build', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');

	const result = await buildSitemapFromDB(user.id, domain);
	return c.json(result);
});

// Get site navigation graph
siteRoutes.get('/:domain/graph', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');

	// Verify access
	const [site] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);
	if (!site) return c.json({ error: 'Not found' }, 404);

	const isOwner = site.userId === user.id;
	const isOrgMember = user.orgId && site.orgId === user.orgId;
	if (!isOwner && !isOrgMember) return c.json({ error: 'Not found' }, 404);

	const sitemap = await loadSitemap(user.id, domain);

	// Transform to a dashboard-friendly format
	const nodes = Object.entries(sitemap.nodes).map(([pattern, node]) => ({
		id: pattern,
		...node,
	}));

	const edges = sitemap.edges.map((edge) => ({
		source: edge.from,
		target: edge.to,
		label: edge.label,
		type: edge.type,
		traversals: edge.traversals,
	}));

	return c.json({
		domain: sitemap.domain,
		stats: sitemap.stats,
		lastUpdated: sitemap.lastUpdated,
		nodes,
		edges,
	});
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
	const urlPattern = pageIndex.urlPattern || normalizeUrlPattern(new URL(pageIndex.url).pathname);

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
		const [inserted] = await db
			.insert(pages)
			.values({
				siteId,
				url: pageIndex.url,
				urlPattern,
				title: pageIndex.title || null,
				pageType: pageIndex.pageType || null,
				elements: pageIndex.elements || [],
				navigationLinks: pageIndex.navigationLinks || [],
			})
			.returning({ id: pages.id });
		pageId = inserted.id;
	}

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
