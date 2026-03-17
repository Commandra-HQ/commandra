import type { SSEEvent } from '@afe/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';
import { db } from '../db/index.js';
import { conversationEmbeddings, conversations, messages, pages, sites } from '../db/schema.js';
import { embedText, getEmbeddingProvider } from '../llm/embeddings.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import { loadDomainMemory, updateDomainMemory } from '../memory/domain.js';
import { extractAndSaveUserMemory, loadUserMemory } from '../memory/user.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';
import { searchConversations, searchElements } from '../db/vector-search.js';
import { agents } from '../db/schema.js';

/**
 * Detect if a user message clearly requires PARALLEL work across multiple distinct websites.
 * Only triggers when the message contains action verbs targeting 2+ different domains.
 * Single-site mentions (even multiple) don't trigger if the task is sequential.
 */
function detectMultiSiteIntent(message: string): boolean {
	// Look for explicit URLs pointing to different domains
	const urlMatches = message.match(/https?:\/\/[^\s]+/gi) || [];
	const urlDomains = new Set(
		urlMatches.map((u) => {
			try {
				return new URL(u).hostname.replace(/^www\./, '');
			} catch {
				return '';
			}
		}).filter(Boolean),
	);
	if (urlDomains.size >= 2) return true;

	// Look for conjunction patterns that imply parallel tasks on different sites
	// e.g., "check Gmail AND update Jira", "compare Notion and Confluence"
	const parallelPatterns = [
		/\b(and|then|also|plus|while)\b.+\b(gmail|github|linkedin|slack|jira|confluence|notion|trello|outlook|asana)\b/i,
		/\b(gmail|github|linkedin|slack|jira|confluence|notion|trello|outlook|asana)\b.+\b(and|then|also|plus)\b.+\b(gmail|github|linkedin|slack|jira|confluence|notion|trello|outlook|asana)\b/i,
		/\bcompare\b.+\band\b/i,
	];

	for (const pattern of parallelPatterns) {
		if (pattern.test(message)) {
			// Verify 2+ different site names
			const sitePattern = /\b(gmail|github|linkedin|slack|jira|confluence|notion|trello|outlook|asana|salesforce|hubspot|figma)\b/gi;
			const matches = message.match(sitePattern);
			if (matches) {
				const unique = new Set(matches.map((m) => m.toLowerCase()));
				if (unique.size >= 2) return true;
			}
		}
	}

	return false;
}

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

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId, selectedElements, agentId } = body as {
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
		agentId?: string;
	};

	if (!message?.trim()) return c.json({ error: 'Message required' }, 400);

	// Get or create conversation
	let convId = conversationId;
	// Load agent if specified
	let agentInstructions: string | undefined;
	let allowedTools: string[] | undefined;
	if (agentId) {
		const [agent] = await db
			.select({
				instructions: agents.instructions,
				tools: agents.tools,
				safetyRules: agents.safetyRules,
			})
			.from(agents)
			.where(eq(agents.id, agentId))
			.limit(1);
		if (agent) {
			agentInstructions = agent.instructions;
			const agentTools = agent.tools as string[];
			if (agentTools && !agentTools.includes('*')) {
				allowedTools = agentTools;
			}
		}
	}

	if (!convId) {
		const [conv] = await db
			.insert(conversations)
			.values({
				userId: user.id,
				title: message.slice(0, 100),
				...(agentId && { agentId }),
			})
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

	const chatMessages = history.map((m) => {
		// Include tool call summary in assistant messages for multi-turn context
		const td = m.toolData as { tools: { name: string; args: unknown; result: unknown; success: boolean }[] } | null;
		if (m.role === 'assistant' && td?.tools?.length) {
			const toolSummary = td.tools
				.map((t) => `[Tool: ${t.name}${t.success ? ' ✓' : ' ✗'}]`)
				.join(' ');
			return {
				role: m.role as 'user' | 'assistant',
				content: `${m.content}\n\n---\nActions taken: ${toolSummary}`,
			};
		}
		return {
			role: m.role as 'user' | 'assistant',
			content: m.content,
		};
	});

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

	// --- Embedding-powered context enrichment ---
	// Search past conversations, elements, and flows for relevant context
	let priorContext = '';
	if (domain) {
		try {
			const [site] = pi?.sitePages
				? [] // Already have site info
				: await db
						.select({ id: sites.id })
						.from(sites)
						.where(and(eq(sites.domain, domain), getOrgOrUserScope(user, sites)))
						.limit(1);

			const siteId = site?.id;

			// Run all embedding searches in parallel (non-blocking — skip if embeddings not configured)
			const [pastConvos, relevantElements] = await Promise.allSettled([
				searchConversations(message, user.id, 3),
				siteId ? searchElements(message, siteId, 8) : Promise.resolve([]),
			]);

			const contextParts: string[] = [];

			// Past conversations — "have we done this before?"
			if (pastConvos.status === 'fulfilled' && pastConvos.value.length > 0) {
				const relevant = pastConvos.value.filter((c) => c.score > 0.3);
				if (relevant.length > 0) {
					contextParts.push('### Past Related Conversations');
					for (const c of relevant) {
						contextParts.push(
							`- "${c.messageText}" (similarity: ${(c.score * 100).toFixed(0)}%)`,
						);
					}
				}
			}

			// Relevant elements across the site — semantic element lookup
			if (relevantElements.status === 'fulfilled' && relevantElements.value.length > 0) {
				const relevant = relevantElements.value.filter((e) => e.score > 0.3);
				if (relevant.length > 0) {
					contextParts.push('### Relevant Elements on This Site');
					for (const e of relevant) {
						contextParts.push(
							`- ${e.elementType}: "${e.elementLabel}" [${e.selector}] (match: ${(e.score * 100).toFixed(0)}%)`,
						);
					}
				}
			}

			if (contextParts.length > 0) {
				priorContext = contextParts.join('\n');
			}
		} catch (err) {
			console.warn('[Chat] Embedding context enrichment failed:', err);
		}
	}

	// Detect multi-site intent — only for genuinely parallel cross-domain tasks
	const multiSiteDetected = detectMultiSiteIntent(message);
	if (multiSiteDetected) {
		console.log('[Chat] Multi-site parallel intent detected');
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
			let toolData: { tools: { name: string; args: unknown; result: unknown; success: boolean }[] } | undefined;
			if (canAct) {
				const result = await runOrchestrator({
					userId: user.id,
					connectionId: connectionId!,
					messages: chatMessages,
					pageIndex,
					selectedElements,
					domainMemory: domainMem,
					userMemory: userMem,
					priorContext: priorContext || undefined,
					domain,
					onEvent,
					signal,
					agentInstructions,
					allowedTools,
				});
				fullResponse = result.response;
				if (result.toolCalls.length > 0) {
					toolData = { tools: result.toolCalls };
				}
			} else {
				fullResponse = await runSimpleChat({
					messages: chatMessages,
					pageIndex,
					selectedElements,
					domainMemory: domainMem,
					userMemory: userMem,
					priorContext: priorContext || undefined,
					onEvent,
					signal,
				});
			}

			if (signal.aborted) return;

			// Store assistant response with structured tool data
			if (fullResponse.trim()) {
				await db.insert(messages).values({
					conversationId: convId!,
					role: 'assistant',
					content: fullResponse,
					...(toolData && { toolData }),
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
