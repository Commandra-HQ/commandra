import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const auditRoutes = new Hono<{ Variables: { user: AuthUser } }>();

auditRoutes.use('*', requireAuth);

auditRoutes.get('/', async (c) => {
	const user = c.get('user');

	const logs = await db
		.select({
			id: auditLogs.id,
			action: auditLogs.action,
			safetyLevel: auditLogs.safetyLevel,
			approved: auditLogs.approved,
			metadata: auditLogs.metadata,
			createdAt: auditLogs.createdAt,
		})
		.from(auditLogs)
		.where(eq(auditLogs.userId, user.id))
		.orderBy(desc(auditLogs.createdAt))
		.limit(200);

	return c.json({ logs });
});
