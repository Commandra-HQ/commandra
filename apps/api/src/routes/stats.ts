import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agentRuns, agents, auditLogs, conversations, sites } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const statsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

statsRoutes.use('*', requireAuth);

statsRoutes.get('/', async (c) => {
	const user = c.get('user');
	const daysBack = 14;
	const since = new Date();
	since.setDate(since.getDate() - daysBack);

	// Totals
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

	// Daily activity (conversations per day, last 14 days)
	const dailyConversations = await db
		.select({
			date: sql<string>`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`,
			count: count(),
		})
		.from(conversations)
		.where(and(eq(conversations.userId, user.id), gte(conversations.createdAt, since)))
		.groupBy(sql`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`)
		.orderBy(sql`to_char(${conversations.createdAt}, 'YYYY-MM-DD')`);

	// Daily actions (audit logs per day, last 14 days)
	const dailyActions = await db
		.select({
			date: sql<string>`to_char(${auditLogs.createdAt}, 'YYYY-MM-DD')`,
			count: count(),
		})
		.from(auditLogs)
		.where(and(eq(auditLogs.userId, user.id), gte(auditLogs.createdAt, since)))
		.groupBy(sql`to_char(${auditLogs.createdAt}, 'YYYY-MM-DD')`)
		.orderBy(sql`to_char(${auditLogs.createdAt}, 'YYYY-MM-DD')`);

	// Recent conversations (last 10)
	const recentConversations = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			outcome: conversations.outcome,
			createdAt: conversations.createdAt,
		})
		.from(conversations)
		.where(eq(conversations.userId, user.id))
		.orderBy(desc(conversations.createdAt))
		.limit(10);

	// Agent stats
	const [agentCount] = await db
		.select({ count: count() })
		.from(agents)
		.where(eq(agents.userId, user.id));

	const agentRunStats = await db
		.select({
			status: agentRuns.status,
			count: count(),
		})
		.from(agentRuns)
		.where(eq(agentRuns.userId, user.id))
		.groupBy(agentRuns.status);

	// Action breakdown by safety level
	const actionBreakdown = await db
		.select({
			safetyLevel: auditLogs.safetyLevel,
			count: count(),
		})
		.from(auditLogs)
		.where(eq(auditLogs.userId, user.id))
		.groupBy(auditLogs.safetyLevel);

	// Outcome breakdown
	const outcomeBreakdown = await db
		.select({
			outcome: conversations.outcome,
			count: count(),
		})
		.from(conversations)
		.where(and(eq(conversations.userId, user.id), sql`${conversations.outcome} IS NOT NULL`))
		.groupBy(conversations.outcome);

	return c.json({
		conversations: convCount?.count ?? 0,
		actions: actionCount?.count ?? 0,
		sites: siteCount?.count ?? 0,
		agents: agentCount?.count ?? 0,
		dailyConversations,
		dailyActions,
		recentConversations,
		agentRunStats,
		actionBreakdown,
		outcomeBreakdown,
	});
});
