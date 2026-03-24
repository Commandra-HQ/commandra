import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { parsePagination } from '../utils/pagination.js';

export const auditRoutes = new Hono<{ Variables: { user: AuthUser } }>();

auditRoutes.use('*', requireAuth);

auditRoutes.get('/', async (c) => {
	const user = c.get('user');
	const { limit, offset } = parsePagination(c, { limit: 50 });
	const safetyLevel = c.req.query('safetyLevel');

	const scope = getOrgOrUserScope(user, auditLogs);
	const where = safetyLevel
		? and(scope, eq(auditLogs.safetyLevel, safetyLevel))
		: scope;

	const [totalResult] = await db
		.select({ count: count() })
		.from(auditLogs)
		.where(where);

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
		.where(where)
		.orderBy(desc(auditLogs.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({ logs, total: totalResult?.count ?? 0 });
});
