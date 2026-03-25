/**
 * Usage API routes — token usage and cost tracking.
 * Phase 26c: provides per-user, per-agent, and per-conversation usage data.
 */

import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agentRuns, agents } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const usageRoutes = new Hono<{ Variables: { user: AuthUser } }>();

usageRoutes.use('*', requireAuth);

/**
 * GET /api/usage/summary — total tokens + cost for current user.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), agentId (uuid)
 */
usageRoutes.get('/summary', async (c) => {
	const user = c.get('user');
	const from = c.req.query('from');
	const to = c.req.query('to');
	const agentId = c.req.query('agentId');

	const conditions = [eq(agentRuns.userId, user.id)];
	if (from) conditions.push(gte(agentRuns.createdAt, new Date(from)));
	if (to) conditions.push(lte(agentRuns.createdAt, new Date(to)));
	if (agentId) conditions.push(eq(agentRuns.agentId, agentId));

	const [result] = await db
		.select({
			totalRuns: sql<number>`count(*)::int`,
			totalInputTokens: sql<number>`coalesce(sum(${agentRuns.inputTokens}), 0)::int`,
			totalOutputTokens: sql<number>`coalesce(sum(${agentRuns.outputTokens}), 0)::int`,
			totalCacheReadTokens: sql<number>`coalesce(sum(${agentRuns.cacheReadTokens}), 0)::int`,
			totalCacheWriteTokens: sql<number>`coalesce(sum(${agentRuns.cacheWriteTokens}), 0)::int`,
			totalThinkingTokens: sql<number>`coalesce(sum(${agentRuns.thinkingTokens}), 0)::int`,
			totalTokensUsed: sql<number>`coalesce(sum(${agentRuns.tokensUsed}), 0)::int`,
			totalCostUsd: sql<string>`coalesce(sum(${agentRuns.estimatedCostUsd}), 0)::numeric(10,6)::text`,
		})
		.from(agentRuns)
		.where(and(...conditions));

	return c.json({ data: result });
});

/**
 * GET /api/usage/by-agent — token breakdown per agent.
 */
usageRoutes.get('/by-agent', async (c) => {
	const user = c.get('user');
	const from = c.req.query('from');
	const to = c.req.query('to');

	const conditions = [eq(agentRuns.userId, user.id)];
	if (from) conditions.push(gte(agentRuns.createdAt, new Date(from)));
	if (to) conditions.push(lte(agentRuns.createdAt, new Date(to)));

	const results = await db
		.select({
			agentId: agentRuns.agentId,
			agentName: sql<string>`coalesce(${agents.name}, 'Coordinator')`,
			totalRuns: sql<number>`count(*)::int`,
			totalInputTokens: sql<number>`coalesce(sum(${agentRuns.inputTokens}), 0)::int`,
			totalOutputTokens: sql<number>`coalesce(sum(${agentRuns.outputTokens}), 0)::int`,
			totalTokensUsed: sql<number>`coalesce(sum(${agentRuns.tokensUsed}), 0)::int`,
			totalCostUsd: sql<string>`coalesce(sum(${agentRuns.estimatedCostUsd}), 0)::numeric(10,6)::text`,
			lastRunAt: sql<string>`max(${agentRuns.createdAt})::text`,
		})
		.from(agentRuns)
		.leftJoin(agents, eq(agentRuns.agentId, agents.id))
		.where(and(...conditions))
		.groupBy(agentRuns.agentId, agents.name)
		.orderBy(desc(sql`sum(${agentRuns.tokensUsed})`));

	return c.json({ data: results });
});

/**
 * GET /api/usage/by-conversation/:id — per-conversation detail.
 */
usageRoutes.get('/by-conversation/:id', async (c) => {
	const user = c.get('user');
	const conversationId = c.req.param('id');

	const results = await db
		.select({
			id: agentRuns.id,
			agentId: agentRuns.agentId,
			status: agentRuns.status,
			inputTokens: agentRuns.inputTokens,
			outputTokens: agentRuns.outputTokens,
			cacheReadTokens: agentRuns.cacheReadTokens,
			cacheWriteTokens: agentRuns.cacheWriteTokens,
			thinkingTokens: agentRuns.thinkingTokens,
			tokensUsed: agentRuns.tokensUsed,
			estimatedCostUsd: agentRuns.estimatedCostUsd,
			model: agentRuns.model,
			provider: agentRuns.provider,
			toolCalls: agentRuns.toolCalls,
			durationMs: agentRuns.durationMs,
			createdAt: agentRuns.createdAt,
		})
		.from(agentRuns)
		.where(
			and(
				eq(agentRuns.userId, user.id),
				eq(agentRuns.conversationId, conversationId),
			),
		)
		.orderBy(desc(agentRuns.createdAt));

	return c.json({ data: results });
});
