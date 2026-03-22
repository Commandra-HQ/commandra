import type { SSEEvent } from '@afe/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { resolveAgent } from '../agent/agent-registry.js';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';
import { analyzeAndImprove, recordAgentRun } from '../agent/self-improve.js';
import { db } from '../db/index.js';
import { conversations, messages, pages, sites } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { loadDomainKnowledgeFromS3, loadDomainMemory } from '../memory/domain.js';
import { loadUserMemory } from '../memory/user.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { loadPlan } from '../storage/plan-files.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';

/**
 * Detect if a user message clearly requires PARALLEL work across multiple distinct websites.
 * Only triggers when the message contains action verbs targeting 2+ different domains.
 * Single-site mentions (even multiple) don't trigger if the task is sequential.
 */
function detectMultiSiteIntent(message: string): boolean {
	// Look for explicit URLs pointing to different domains
	const urlMatches = message.match(/https?:\/\/[^\s]+/gi) || [];
	const urlDomains = new Set(
		urlMatches
			.map((u) => {
				try {
					return new URL(u).hostname.replace(/^www\./, '');
				} catch {
					return '';
				}
			})
			.filter(Boolean),
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
			const sitePattern =
				/\b(gmail|github|linkedin|slack|jira|confluence|notion|trello|outlook|asana|salesforce|hubspot|figma)\b/gi;
			const matches = message.match(sitePattern);
			if (matches) {
				const unique = new Set(matches.map((m) => m.toLowerCase()));
				if (unique.size >= 2) return true;
			}
		}
	}

	return false;
}

export const chatRoutes = new Hono<{ Variables: { user: AuthUser } }>();

chatRoutes.use('*', requireAuth);

chatRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { message, pageIndex, conversationId, selectedElements, agentId, tabId } = body as {
		message: string;
		pageIndex?: unknown;
		conversationId?: string;
		agentId?: string;
		tabId?: number;
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

	const chatMessages = history.map((m) => {
		// Include tool call summary in assistant messages for multi-turn context
		const td = m.toolData as {
			tools: { name: string; args: unknown; result: unknown; success: boolean }[];
		} | null;
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
	let domainKnowledge: string | undefined;
	if (pi?.url) {
		try {
			domain = new URL(pi.url).hostname;
			const [dm, um, dk] = await Promise.all([
				loadDomainMemory(domain),
				loadUserMemory(user.id, domain),
				loadDomainKnowledgeFromS3(user.id, domain),
			]);
			domainMem = dm ?? undefined;
			userMem = um ?? undefined;
			domainKnowledge = dk ?? undefined;

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

	// Detect multi-site intent — only for genuinely parallel cross-domain tasks
	const multiSiteDetected = detectMultiSiteIntent(message);
	if (multiSiteDetected) {
		console.log('[Chat] Multi-site parallel intent detected');
	}

	// Resolve agent — explicit agentId > domain match > default coordinator
	const agentConfig = await resolveAgent(user.id, agentId, domain);

	// Set agentId on conversation if this is a non-coordinator agent
	if (agentConfig.id !== '_coordinator' && convId) {
		db.update(conversations)
			.set({ agentId: agentConfig.id })
			.where(eq(conversations.id, convId))
			.catch(() => {}); // fire-and-forget
	}

	// Load existing plan for this conversation (if any) so the agent knows where it left off
	const existingPlan = convId ? await loadPlan(user.id, convId).catch(() => null) : null;

	// Get the abort signal from the request (fires when client disconnects)
	const signal = c.req.raw.signal;

	// Stream response as SSE
	return streamSSE(c, async (stream) => {
		let fullResponse = '';

		// SSE heartbeat — keeps connection alive during long tool executions
		const heartbeat = setInterval(async () => {
			if (signal.aborted) return;
			try {
				await stream.writeSSE({ event: 'heartbeat', data: '{}' });
			} catch {
				// Stream closed
			}
		}, 15000); // Every 15 seconds

		const onEvent = async (event: SSEEvent) => {
			if (signal.aborted) return;
			await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
		};

		// Emit conversationId immediately so the frontend can track it
		// This prevents orphaned conversations when the stream errors or disconnects
		await onEvent({ type: 'conversation_id', conversationId: convId! } as SSEEvent);

		try {
			let toolData:
				| { tools: { name: string; args: unknown; result: unknown; success: boolean }[] }
				| undefined;
			const startTime = Date.now();
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
					conversationId: convId,
					onEvent,
					signal,
					agentConfig,
					tabId,
					domainKnowledge,
					existingPlan,
				});
				fullResponse = result.response;
				if (result.toolCalls.length > 0) {
					toolData = { tools: result.toolCalls };
				}

				// Self-improvement: record run + analyze for non-coordinator agents
				if (agentConfig.id !== '_coordinator') {
					const durationMs = Date.now() - startTime;
					recordAgentRun({
						agentId: agentConfig.id,
						userId: user.id,
						conversationId: convId,
						status: 'completed',
						toolCalls: result.toolCalls.length,
						durationMs,
					}).catch((err) => console.warn('[SelfImprove] recordAgentRun failed:', err));

					const transcript = [
						...chatMessages.slice(-10).map((m) => `${m.role}: ${m.content}`),
						`assistant: ${fullResponse}`,
					].join('\n\n');
					analyzeAndImprove({
						userId: user.id,
						agentConfig,
						toolCalls: result.toolCalls,
						transcript,
						duration: durationMs,
						domain,
						conversationId: convId,
					}).catch((err) => console.warn('[SelfImprove] analyzeAndImprove failed:', err));
				}
			} else {
				fullResponse = await runSimpleChat({
					messages: chatMessages,
					pageIndex,
					selectedElements,
					domainMemory: domainMem,
					userMemory: userMem,
					onEvent,
					signal,
					agentConfig,
				});
			}

			// Always save the assistant response — even if the client disconnected.
			// This prevents orphaned conversations with user messages but no response.
			const contentToSave =
				fullResponse.trim() ||
				(toolData ? `[Agent executed ${toolData.tools.length} actions]` : '');
			if (contentToSave) {
				await db.insert(messages).values({
					conversationId: convId!,
					role: 'assistant',
					content: contentToSave,
					...(toolData && { toolData }),
				}).catch((err) => console.error('[Chat] Failed to save assistant message:', err));
			}

			// Send done event with conversation ID (only if client is still connected)
			if (!signal.aborted) {
				await onEvent({ type: 'done', conversationId: convId! });
			}
		} catch (err) {
			if (signal.aborted) return;
			console.error('Chat error:', err);
			await onEvent({ type: 'error', message: 'Something went wrong. Please try again.' });
		} finally {
			clearInterval(heartbeat);
		}
	});
});
