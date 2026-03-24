import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agents, conversations, messages } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { loadPlan } from '../storage/plan-files.js';
import { parsePagination } from '../utils/pagination.js';

export const conversationRoutes = new Hono<{ Variables: { user: AuthUser } }>();

conversationRoutes.use('*', requireAuth);

// List conversations
conversationRoutes.get('/', async (c) => {
	const user = c.get('user');
	const { limit, offset } = parsePagination(c);

	const scope = getOrgOrUserScope(user, conversations);

	const [totalResult] = await db
		.select({ count: count() })
		.from(conversations)
		.where(scope);

	// Message count subquery
	const msgCount = db
		.select({
			conversationId: messages.conversationId,
			count: count().as('msg_count'),
		})
		.from(messages)
		.groupBy(messages.conversationId)
		.as('msg_counts');

	const rows = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			outcome: conversations.outcome,
			agentId: conversations.agentId,
			agentName: agents.name,
			planStatus: conversations.planStatus,
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
			messageCount: sql<number>`COALESCE(${msgCount.count}, 0)`.as('messageCount'),
		})
		.from(conversations)
		.leftJoin(agents, eq(conversations.agentId, agents.id))
		.leftJoin(msgCount, eq(conversations.id, msgCount.conversationId))
		.where(scope)
		.orderBy(desc(conversations.updatedAt))
		.limit(limit)
		.offset(offset);

	return c.json({ conversations: rows, total: totalResult?.count ?? 0 });
});

// Get conversation with messages
conversationRoutes.get('/:id', async (c) => {
	const user = c.get('user');
	const convId = c.req.param('id');

	const [conv] = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.id, convId), getOrgOrUserScope(user, conversations)))
		.limit(1);

	if (!conv) {
		return c.json({ error: 'Not found' }, 404);
	}

	const [msgs, plan] = await Promise.all([
		db
			.select({
				id: messages.id,
				role: messages.role,
				content: messages.content,
				toolData: messages.toolData,
				createdAt: messages.createdAt,
			})
			.from(messages)
			.where(eq(messages.conversationId, convId))
			.orderBy(messages.createdAt),
		loadPlan(user.id, convId).catch(() => null),
	]);

	return c.json({ conversation: conv, messages: msgs, plan });
});

// Rate conversation outcome (thumbs up/down)
conversationRoutes.post('/:id/outcome', async (c) => {
	const user = c.get('user');
	const convId = c.req.param('id');
	const body = await c.req.json();
	const { outcome } = body as { outcome: 'success' | 'failure' | 'partial' };

	if (!['success', 'failure', 'partial'].includes(outcome)) {
		return c.json({ error: 'outcome must be success, failure, or partial' }, 400);
	}

	const [conv] = await db
		.select({
			id: conversations.id,
			userId: conversations.userId,
			orgId: conversations.orgId,
			createdAt: conversations.createdAt,
		})
		.from(conversations)
		.where(and(eq(conversations.id, convId), getOrgOrUserScope(user, conversations)))
		.limit(1);

	if (!conv) {
		return c.json({ error: 'Not found' }, 404);
	}

	await db
		.update(conversations)
		.set({ outcome, updatedAt: new Date() })
		.where(eq(conversations.id, convId));

	// Outcome is stored on the conversation record.
	// Memory reinforcement is handled by the S3-backed memory system —
	// the agent reinforces its own memories via save_memory/save_knowledge tools.

	return c.json({ ok: true, outcome });
});
