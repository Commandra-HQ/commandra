import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { pages, sites } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const siteRoutes = new Hono<{ Variables: { user: AuthUser } }>();

siteRoutes.use('*', requireAuth);

// List sites
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
		.where(eq(sites.userId, user.id));

	return c.json({ sites: rows });
});

// Get site with pages
siteRoutes.get('/:domain', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');

	const [site] = await db
		.select()
		.from(sites)
		.where(eq(sites.domain, domain))
		.limit(1);

	if (!site || site.userId !== user.id) {
		return c.json({ error: 'Not found' }, 404);
	}

	const sitePages = await db
		.select({
			id: pages.id,
			url: pages.url,
			urlPattern: pages.urlPattern,
			title: pages.title,
			pageType: pages.pageType,
			lastIndexedAt: pages.lastIndexedAt,
		})
		.from(pages)
		.where(eq(pages.siteId, site.id));

	return c.json({ site, pages: sitePages });
});
