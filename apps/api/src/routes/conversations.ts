import { and, count, desc, eq, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agents, conversations, messages, userMemory } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const conversationRoutes = new Hono<{ Variables: { user: AuthUser } }>();

conversationRoutes.use('*', requireAuth);

// List conversations
conversationRoutes.get('/', async (c) => {
	const user = c.get('user');

	const rows = await db
		.select({
			id: conversations.id,
			title: conversations.title,
			agentId: conversations.agentId,
			agentName: agents.name,
			planStatus: conversations.planStatus,
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
		})
		.from(conversations)
		.leftJoin(agents, eq(conversations.agentId, agents.id))
		.where(getOrgOrUserScope(user, conversations))
		.orderBy(desc(conversations.updatedAt))
		.limit(50);

	// Get message counts
	const withCounts = await Promise.all(
		rows.map(async (conv) => {
			const [result] = await db
				.select({ count: count() })
				.from(messages)
				.where(eq(messages.conversationId, conv.id));
			return { ...conv, messageCount: result?.count ?? 0 };
		}),
	);

	return c.json({ conversations: withCounts });
});

// Get conversation with messages
conversationRoutes.get('/:id', async (c) => {
	const user = c.get('user');
	const convId = c.req.param('id');

	const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);

	if (!conv || (user.orgId ? conv.orgId !== user.orgId : conv.userId !== user.id)) {
		return c.json({ error: 'Not found' }, 404);
	}

	const msgs = await db
		.select({
			id: messages.id,
			role: messages.role,
			content: messages.content,
			toolData: messages.toolData,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(eq(messages.conversationId, convId))
		.orderBy(messages.createdAt);

	return c.json({ conversation: conv, messages: msgs });
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
		.where(eq(conversations.id, convId))
		.limit(1);

	if (!conv || (user.orgId ? conv.orgId !== user.orgId : conv.userId !== user.id)) {
		return c.json({ error: 'Not found' }, 404);
	}

	await db
		.update(conversations)
		.set({ outcome, updatedAt: new Date() })
		.where(eq(conversations.id, convId));

	// Reinforce or flag memories based on outcome
	if (outcome === 'success') {
		// Reinforce memories used during this conversation
		await db
			.update(userMemory)
			.set({
				timesReinforced: sql`${userMemory.timesReinforced} + 1`,
				confidence: sql`LEAST(${userMemory.confidence} + 1, 5)`,
				updatedAt: new Date(),
			})
			.where(and(eq(userMemory.userId, user.id), gte(userMemory.lastUsedAt, conv.createdAt)));
	} else if (outcome === 'failure') {
		// Reduce confidence of auto-memories used during this conversation
		await db
			.update(userMemory)
			.set({
				confidence: sql`GREATEST(${userMemory.confidence} - 1, 0)`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(userMemory.userId, user.id),
					eq(userMemory.source, 'auto'),
					gte(userMemory.lastUsedAt, conv.createdAt),
				),
			);
	}

	return c.json({ ok: true, outcome });
});
