import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
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
			createdAt: conversations.createdAt,
			updatedAt: conversations.updatedAt,
		})
		.from(conversations)
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

	const [conv] = await db
		.select()
		.from(conversations)
		.where(eq(conversations.id, convId))
		.limit(1);

	if (!conv || (user.orgId ? conv.orgId !== user.orgId : conv.userId !== user.id)) {
		return c.json({ error: 'Not found' }, 404);
	}

	const msgs = await db
		.select({
			id: messages.id,
			role: messages.role,
			content: messages.content,
			createdAt: messages.createdAt,
		})
		.from(messages)
		.where(eq(messages.conversationId, convId))
		.orderBy(messages.createdAt);

	return c.json({ conversation: conv, messages: msgs });
});
