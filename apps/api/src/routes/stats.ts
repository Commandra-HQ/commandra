import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { auditLogs, conversations, sites } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const statsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

statsRoutes.use('*', requireAuth);

statsRoutes.get('/', async (c) => {
	const user = c.get('user');

	const [convCount] = await db
		.select({ count: count() })
		.from(conversations)
		.where(eq(conversations.userId, user.id));

	const [actionCount] = await db
		.select({ count: count() })
		.from(auditLogs)
		.where(eq(auditLogs.userId, user.id));

	const [siteCount] = await db
		.select({ count: count() })
		.from(sites)
		.where(eq(sites.userId, user.id));

	return c.json({
		conversations: convCount?.count ?? 0,
		actions: actionCount?.count ?? 0,
		sites: siteCount?.count ?? 0,
	});
});
