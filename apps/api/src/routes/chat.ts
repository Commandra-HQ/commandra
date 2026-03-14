import type { SSEEvent } from '@afe/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';
import { cancelRecording, isRecording, startRecording, stopRecording } from '../agent/recorder.js';
import { db } from '../db/index.js';
import { conversationEmbeddings, conversations, messages, pages, sites } from '../db/schema.js';
import { embedText, getEmbeddingProvider } from '../llm/embeddings.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import { loadDomainMemory, updateDomainMemory } from '../memory/domain.js';
import { extractAndSaveUserMemory, loadUserMemory } from '../memory/user.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';

async function embedUserMessage(conversationId: string, messageText: string): Promise<void> {
	// Get the message ID we just inserted
	const [msg] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'user')))
		.orderBy(desc(messages.createdAt))
		.limit(1);
	if (!msg) return;

	try {
		const vector = await embedText(messageText);
		await db.insert(conversationEmbeddings).values({
			conversationId,
			messageId: msg.id,
			messageText: messageText.slice(0, 500), // Cap stored text
			embeddingModel: getEmbeddingProvider().id,
			embedding: vector,
		});
	} catch {
		// Embedding may not be configured — that's fine, skip silently
	}
}

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

// Start recording mode
chatRoutes.post('/record/start', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { domain } = body as { domain: string };

	if (!domain?.trim()) return c.json({ error: 'Domain required' }, 400);

	const connectionId = getConnectionByUser(user.id);
	if (!connectionId) return c.json({ error: 'Extension not connected' }, 400);

	if (isRecording(connectionId)) {
		return c.json({ error: 'Already recording' }, 400);
	}

	startRecording(connectionId, user.id, domain);

	return c.json({ ok: true, recording: true });
});

// Stop recording and save flow
chatRoutes.post('/record/stop', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { name, description } = body as { name: string; description?: string };

	if (!name?.trim()) return c.json({ error: 'Flow name required' }, 400);

	const connectionId = getConnectionByUser(user.id);
	if (!connectionId) return c.json({ error: 'Extension not connected' }, 400);

	if (!isRecording(connectionId)) {
		return c.json({ error: 'Not recording' }, 400);
	}

	const flowId = await stopRecording(connectionId, name, description);
	if (!flowId) {
		return c.json({ error: 'No steps recorded' }, 400);
	}

	return c.json({ ok: true, flowId });
});

// Cancel recording without saving
chatRoutes.post('/record/cancel', async (c) => {
	const user = c.get('user');
	const connectionId = getConnectionByUser(user.id);
	if (connectionId) cancelRecording(connectionId);
	return c.json({ ok: true });
});

// Check recording status
chatRoutes.get('/record/status', async (c) => {
	const user = c.get('user');
	const connectionId = getConnectionByUser(user.id);
	const recording = connectionId ? isRecording(connectionId) : false;
	return c.json({ recording });
});

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

	// Background: embed user message for conversational recall
	embedUserMessage(convId!, message).catch((err) =>
		console.warn('[Embeddings] User message embed failed:', err),
	);

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

	// Load domain memory, user memory, and site pages context
	const pi = pageIndex as
		| { url?: string; urlPattern?: string; sitePages?: unknown; lastIndexedAt?: unknown }
		| undefined;
	let domain: string | undefined;
	let domainMem: string | undefined;
	let userMem: string | undefined;
	if (pi?.url) {
		try {
			domain = new URL(pi.url).hostname;
			const [dm, um] = await Promise.all([
				loadDomainMemory(domain),
				loadUserMemory(user.id, domain),
			]);
			domainMem = dm ?? undefined;
			userMem = um ?? undefined;

			// Enrich pageIndex with all indexed pages for this site so the agent
			// knows the full site structure (what pages exist, their purpose, key elements)
			if (!pi.sitePages) {
				const [site] = await db
					.select({ id: sites.id })
					.from(sites)
					.where(and(eq(sites.domain, domain), getOrgOrUserScope(user, sites)))
					.limit(1);

				if (site) {
					const sitePages = await db
						.select({
							url: pages.url,
							urlPattern: pages.urlPattern,
							title: pages.title,
							pageType: pages.pageType,
							elements: pages.elements,
							navigationLinks: pages.navigationLinks,
							lastIndexedAt: pages.lastIndexedAt,
						})
						.from(pages)
						.where(eq(pages.siteId, site.id));

					// Attach site pages context — exclude the current page (already in pageIndex)
					const currentPattern = pi.urlPattern;
					pi.sitePages = sitePages
						.filter((p) => p.urlPattern !== currentPattern)
						.map((p) => {
							const elements =
								(p.elements as { type: string; label: string; selector: string }[]) || [];
							return {
								url: p.url,
								urlPattern: p.urlPattern || '',
								title: p.title || '',
								pageType: p.pageType || 'other',
								elementCount: elements.length,
								lastIndexedAt: p.lastIndexedAt,
								keyElements: elements.slice(0, 10).map((el) => ({
									type: el.type,
									label: el.label,
									selector: el.selector,
								})),
								navigationLinks: (
									(p.navigationLinks as { label: string; href: string }[]) || []
								).slice(0, 10),
							};
						});

					// Also set lastIndexedAt for the current page from DB if not set
					if (!pi.lastIndexedAt) {
						const currentPage = sitePages.find((p) => p.urlPattern === currentPattern);
						if (currentPage?.lastIndexedAt) {
							pi.lastIndexedAt = currentPage.lastIndexedAt;
						}
					}
				}
			}
		} catch {
			// Invalid URL, skip memory
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
					userMemory: userMem,
					domain,
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
					userMemory: userMem,
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

			// Update domain memory and user memory in the background
			if (domain && fullResponse.length > 20) {
				const transcript = [
					...chatMessages.slice(-10).map((m) => `${m.role}: ${m.content}`),
					`assistant: ${fullResponse}`,
				].join('\n\n');
				updateDomainMemory(domain, transcript, getProvider(), getFastModel()).catch((err) =>
					console.warn('[DomainMemory] Update failed:', err),
				);
				extractAndSaveUserMemory(
					user.id,
					domain,
					transcript,
					getProvider(),
					getFastModel(),
					getStrongModel(),
				).catch((err) => console.warn('[UserMemory] Extraction failed:', err));
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
