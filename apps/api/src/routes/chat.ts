import type { SSEEvent } from '@afe/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { loadDomainMemory, updateDomainMemory } from '../memory/domain.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId, selectedElements } = body as {
		message: string;
		pageIndex?: unknown;
		conversationId?: string;
		selectedElements?: {
			selector: string;
			fallbackSelectors: string[];
			tag: string;
			label: string;
			type?: string;
			attributes: Record<string, string>;
		}[];
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

	// Load domain memory if we have page context
	const pi = pageIndex as { url?: string } | undefined;
	let domain: string | undefined;
	let domainMem: string | undefined;
	if (pi?.url) {
		try {
			domain = new URL(pi.url).hostname;
			domainMem = (await loadDomainMemory(domain)) ?? undefined;
		} catch {
			// Invalid URL, skip domain memory
		}
	}

	// Get the abort signal from the request (fires when client disconnects)
	const signal = c.req.raw.signal;

	// Stream response as SSE
	return streamSSE(c, async (stream) => {
		let fullResponse = '';

		const onEvent = async (event: SSEEvent) => {
			if (signal.aborted) return;
			await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
		};

		try {
			if (canAct) {
				const result = await runOrchestrator({
					userId: user.id,
					connectionId: connectionId!,
					messages: chatMessages,
					pageIndex,
					selectedElements,
					domainMemory: domainMem,
					onEvent,
					signal,
				});
				fullResponse = result.response;
			} else {
				fullResponse = await runSimpleChat({
					messages: chatMessages,
					pageIndex,
					selectedElements,
					domainMemory: domainMem,
					onEvent,
					signal,
				});
			}

			if (signal.aborted) return;

			// Store assistant response (only actual text, not tool status)
			if (fullResponse.trim()) {
				await db.insert(messages).values({
					conversationId: convId!,
					role: 'assistant',
					content: fullResponse,
				});
			}

			// Update domain memory in the background
			if (domain && fullResponse.length > 50) {
				const transcript = chatMessages
					.slice(-10)
					.map((m) => `${m.role}: ${m.content}`)
					.join('\n\n');
				updateDomainMemory(domain, transcript, getProvider(), getFastModel()).catch((err) =>
					console.warn('[DomainMemory] Update failed:', err),
				);
			}

			// Send done event with conversation ID
			await onEvent({ type: 'done', conversationId: convId! });
		} catch (err) {
			if (signal.aborted) return;
			console.error('Chat error:', err);
			await onEvent({ type: 'error', message: 'Something went wrong. Please try again.' });
		}
	});
});
