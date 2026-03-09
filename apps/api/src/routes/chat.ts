import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { requireAuth, type AuthUser } from '../middleware/auth.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId, selectedElements } = body as {
		message: string;
		pageIndex?: unknown;
		conversationId?: string;
		selectedElements?: { selector: string; fallbackSelectors: string[]; tag: string; label: string; type?: string; attributes: Record<string, string> }[];
	};

	if (!message?.trim()) return c.json({ error: 'Message required' }, 400);

	// Get or create conversation
	let convId = conversationId;
	if (!convId) {
		const [conv] = await db
			.insert(conversations)
			.values({ userId: user.id, title: message.slice(0, 100) })
			.returning();
		convId = conv.id;
	}

	// Store user message
	await db.insert(messages).values({
		conversationId: convId,
		role: 'user',
		content: message,
	});

	// Load conversation history
	const history = await db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, convId))
		.orderBy(asc(messages.createdAt));

	const chatMessages = history.map((m) => ({
		role: m.role as 'user' | 'assistant',
		content: m.content,
	}));

	// Check if extension is connected
	const connectionId = getConnectionByUser(user.id);
	const canAct = !!connectionId;
	if (connectionId) resetKill(connectionId);

	// Stream response
	return stream(c, async (s) => {
		let fullResponse = '';

		try {
			if (canAct) {
				const result = await runOrchestrator({
					userId: user.id,
					connectionId: connectionId!,
					messages: chatMessages,
					pageIndex,
					selectedElements,
					onText: async (text) => { await s.write(text); },
				});
				fullResponse = result.response;
			} else {
				fullResponse = await runSimpleChat({
					messages: chatMessages,
					pageIndex,
					selectedElements,
					onText: async (text) => { await s.write(text); },
				});
			}

			// Store assistant response
			await db.insert(messages).values({
				conversationId: convId!,
				role: 'assistant',
				content: fullResponse,
			});

			// Send conversation ID as final metadata
			await s.write(`\n\n<!--conv:${convId}-->`);
		} catch (err) {
			console.error('Chat error:', err);
			await s.write('\n\nSorry, something went wrong. Please try again.');
		}
	});
});
