import type { AgentConfig, SSEEvent } from '@afe/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { resolveAgent } from '../agent/agent-registry.js';
import type { OrchestratorResult } from '../agent/orchestrator.js';
import { runOrchestrator, runSimpleChat } from '../agent/orchestrator.js';
import {
	abortPromise,
	completeRun,
	createDurableOnEvent,
	createRun,
	getRun,
	saveFinalMessage,
	subscribeSSE,
} from '../agent/run-registry.js';
import { analyzeAndImprove, calculateCost, recordAgentRun } from '../agent/self-improve.js';
import { db } from '../db/index.js';
import { agents, conversations, messages, pages, sites } from '../db/schema.js';
import { getOrgOrUserScope } from '../db/scope.js';
import { getFastModel, getModelCapabilities, getProvider, getStrongModel } from '../llm/index.js';
import { loadDomainKnowledgeFromS3, syncDomainKnowledgeToS3 } from '../memory/domain.js';
import { extractAndSaveUserMemory, loadUserMemory } from '../memory/user.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { loadPlan } from '../storage/plan-files.js';
import { loadSitemap, renderSitemapTree } from '../storage/sitemap.js';
import { getConnectionByUser, registerConversationConnection, resetKill } from '../ws/handler.js';

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

/**
 * Generate a short conversation title using the fast model.
 * Called after the 1st message (initial title) and 3rd message (refined title).
 * Fire-and-forget — never blocks the chat flow.
 */
async function generateConversationTitle(
	convId: string,
	chatMessages: { role: string; content: string }[],
	onEvent?: (event: SSEEvent) => Promise<void>,
): Promise<void> {
	const provider = getProvider();
	const fastModel = getFastModel();
	const { collectStream } = await import('../llm/types.js');

	const recent = chatMessages.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');

	const stream = provider.chat({
		model: fastModel,
		system: 'Generate a short title (3-6 words) for this conversation. Return ONLY the title, no quotes, no punctuation at the end.',
		messages: [{ role: 'user', content: recent }],
		maxTokens: 30,
	});

	const response = await collectStream(stream);
	const title = response.content
		.filter((b) => b.type === 'text')
		.map((b) => (b as { text: string }).text)
		.join('')
		.trim()
		.slice(0, 100);

	if (title) {
		await db
			.update(conversations)
			.set({ title, updatedAt: new Date() })
			.where(eq(conversations.id, convId));
		// Emit title to the client via SSE (if run is active)
		if (onEvent) {
			await onEvent({ type: 'title_updated', title });
		}
	}
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

	// Auto-generate conversation title via fast model (fire-and-forget).
	// Delayed slightly so the run exists and we can emit via its SSE stream.
	const userMsgCount = history.filter((m) => m.role === 'user').length;
	if (userMsgCount === 1 || userMsgCount === 3) {
		setTimeout(() => {
			const run = getRun(convId!);
			const onEvent = run ? createDurableOnEvent(run) : undefined;
			generateConversationTitle(convId!, chatMessages, onEvent).catch(() => {});
		}, 2000);
	}

	// Check if extension is connected
	const connectionId = getConnectionByUser(user.id);
	const canAct = !!connectionId;
	if (connectionId) resetKill(connectionId);

	// Load user memory + domain knowledge from S3
	const pi = pageIndex as
		| { url?: string; urlPattern?: string; sitePages?: unknown; lastIndexedAt?: unknown }
		| undefined;
	let domain: string | undefined;
	let userMem: string | undefined;
	let domainKnowledge: string | undefined;
	let sitemapTree: string | undefined;
	if (pi?.url) {
		try {
			domain = new URL(pi.url).hostname;
			const [um, dk, sitemap] = await Promise.all([
				loadUserMemory(user.id, domain),
				loadDomainKnowledgeFromS3(user.id, domain),
				loadSitemap(user.id, domain),
			]);
			userMem = um ?? undefined;
			domainKnowledge = dk ?? undefined;
			const tree = renderSitemapTree(sitemap);
			sitemapTree = tree || undefined;

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

	// HTTP signal — only controls the SSE stream, NOT the orchestrator
	const httpSignal = c.req.raw.signal;

	// Stream response as SSE — the orchestrator runs independently
	return streamSSE(c, async (stream) => {
		// Check if there's already an active run for this conversation (reconnection case)
		let run = convId ? getRun(convId!) : undefined;

		if (!run) {
			// New run — create and launch orchestrator as a detached promise
			run = createRun(convId!, user.id, connectionId || '');
			if (connectionId) registerConversationConnection(convId!, connectionId);
			const durableOnEvent = createDurableOnEvent(run);

			// Emit conversationId immediately so the frontend can track it
			await durableOnEvent({ type: 'conversation_id', conversationId: convId! } as SSEEvent);

			// Capture context for the completion handler
			const runContext = {
				user,
				agentConfig,
				chatMessages,
				domain,
				convId: convId!,
				canAct,
				connectionId,
				pageIndex,
				selectedElements,
				userMem,
				domainKnowledge,
				existingPlan,
				tabId,
				sitemapTree,
			};

			const startTime = Date.now();

			// Launch orchestrator — fire and forget from HTTP perspective
			const orchestratorPromise = canAct
				? runOrchestrator({
						userId: user.id,
						connectionId: connectionId!,
						messages: chatMessages,
						pageIndex,
						selectedElements,
						domainMemory: undefined,
						userMemory: userMem,
						domain,
						conversationId: convId,
						onEvent: durableOnEvent,
						signal: run.abortController.signal,
						agentConfig,
						tabId,
						domainKnowledge,
						existingPlan,
						sitemapTree,
					})
				: runSimpleChat({
						messages: chatMessages,
						pageIndex,
						selectedElements,
						domainMemory: undefined,
						userMemory: userMem,
						onEvent: durableOnEvent,
						signal: run.abortController.signal,
						agentConfig,
					}).then(
						(text): OrchestratorResult => ({
							response: text,
							toolCalls: [],
							usage: {
								inputTokens: 0,
								outputTokens: 0,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
								thinkingTokens: 0,
							},
						}),
					);

			// Handle completion in the background (not tied to HTTP)
			orchestratorPromise
				.then(async (result) => {
					const currentRun = getRun(convId!);
					if (!currentRun) return;

					// Update run state with final data
					currentRun.fullResponse = result.response;
					currentRun.toolCalls = result.toolCalls;

					// Save final assistant message to DB
					await saveFinalMessage(
						currentRun,
						result.toolCalls.length > 0 ? result.toolCalls : undefined,
					);

					// Self-improvement + recording (fire-and-forget)
					handlePostOrchestrator(result, runContext, startTime);

					// Emit done event via durable handler
					await durableOnEvent({ type: 'done', conversationId: convId! });

					// Mark run complete
					await completeRun(convId!, 'completed');
				})
				.catch(async (err) => {
					const currentRun = getRun(convId!);
					if (currentRun?.abortController.signal.aborted) {
						// User killed the run — save whatever we have
						await saveFinalMessage(
							currentRun,
							currentRun.toolCalls.length > 0 ? currentRun.toolCalls : undefined,
						);
						await completeRun(convId!, 'completed');
						return;
					}
					console.error('[Chat] Orchestrator error:', err);
					await durableOnEvent({
						type: 'error',
						message: 'Something went wrong. Please try again.',
					});
					await saveFinalMessage(currentRun!, currentRun?.toolCalls);
					await completeRun(convId!, 'failed');
				});
		}

		// ── SSE subscriber: replay buffered events then stream live ──

		const heartbeat = setInterval(async () => {
			if (httpSignal.aborted) return;
			try {
				await stream.writeSSE({ event: 'heartbeat', data: '{}' });
			} catch {
				// Stream closed
			}
		}, 15000);

		// Replay any buffered events (handles reconnection)
		for (const event of run.eventBuffer) {
			if (httpSignal.aborted) break;
			try {
				await stream.writeSSE({
					event: event.type,
					data: JSON.stringify(event),
				});
			} catch {
				break;
			}
		}

		// Subscribe for live events
		const unsub = subscribeSSE(convId!, stream);

		// Block until run finishes OR client disconnects
		await Promise.race([run.completionPromise, abortPromise(httpSignal)]);

		clearInterval(heartbeat);
		unsub();
	});
});

/**
 * GET /api/chat/subscribe/:conversationId — reconnect to a running conversation's SSE stream.
 * Returns live events + replays buffered events from the current run.
 */
chatRoutes.get('/subscribe/:conversationId', requireAuth, async (c) => {
	const user = c.get('user');
	const convId = c.req.param('conversationId');

	// Verify ownership
	const [conv] = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.id, convId), eq(conversations.userId, user.id)));
	if (!conv) return c.json({ error: 'Not found' }, 404);

	const run = getRun(convId);
	console.log(`[Chat] subscribe/${convId}: run=${run ? `exists (status=${run.status}, events=${run.eventBuffer.length})` : 'NOT FOUND'}, dbStatus=${conv.status}`);
	if (!run) {
		return c.json({ status: conv.status || 'idle' });
	}

	const httpSignal = c.req.raw.signal;

	return streamSSE(c, async (stream) => {
		const heartbeat = setInterval(async () => {
			if (httpSignal.aborted) return;
			try {
				await stream.writeSSE({ event: 'heartbeat', data: '{}' });
			} catch {
				// Stream closed
			}
		}, 15000);

		// Replay buffered events
		for (const event of run.eventBuffer) {
			if (httpSignal.aborted) break;
			try {
				await stream.writeSSE({
					event: event.type,
					data: JSON.stringify(event),
				});
			} catch {
				break;
			}
		}

		// Subscribe for live events
		const unsub = subscribeSSE(convId, stream);

		// Block until run finishes OR client disconnects
		await Promise.race([run.completionPromise, abortPromise(httpSignal)]);

		clearInterval(heartbeat);
		unsub();
	});
});

/**
 * Post-orchestrator handler — self-improvement, recording, memory extraction.
 * Runs in the background, not tied to any HTTP connection.
 */
function handlePostOrchestrator(
	result: OrchestratorResult,
	ctx: {
		user: AuthUser;
		agentConfig: AgentConfig;
		chatMessages: { role: string; content: string }[];
		domain?: string;
		convId: string;
		canAct: boolean;
	},
	startTime: number,
): void {
	const { user, agentConfig, chatMessages, domain, convId } = ctx;
	const durationMs = Date.now() - startTime;
	const fullResponse = result.response;

	// Record run in DB
	const runProviderName = process.env.LLM_PROVIDER || 'anthropic';
	const runModel = agentConfig.model === 'fast' ? getFastModel() : getStrongModel();
	const runCaps = getModelCapabilities(runProviderName, runModel);
	const estimatedCost = calculateCost(result.usage, runCaps);
	recordAgentRun({
		agentId: agentConfig.id === '_coordinator' ? null : agentConfig.id,
		userId: user.id,
		conversationId: convId,
		status: 'completed',
		toolCalls: result.toolCalls.length,
		tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
		durationMs,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		cacheReadTokens: result.usage.cacheReadTokens,
		cacheWriteTokens: result.usage.cacheWriteTokens,
		thinkingTokens: result.usage.thinkingTokens,
		estimatedCostUsd: estimatedCost.toFixed(6),
		model: runModel,
		provider: runProviderName,
	}).catch((err) => console.warn('[SelfImprove] recordAgentRun failed:', err));

	// Analyze and improve
	if (result.toolCalls.length > 0 || fullResponse.length > 100) {
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

		// Extract user-specific memories (fire-and-forget)
		if (domain) {
			const provider = getProvider();
			const fastModel = getFastModel();
			const strongModel = getStrongModel();
			extractAndSaveUserMemory(user.id, domain, transcript, provider, fastModel, strongModel).catch(
				(err) => console.warn('[UserMemory] extractAndSaveUserMemory failed:', err),
			);
			syncDomainKnowledgeToS3(user.id, domain, transcript, provider, fastModel).catch((err) =>
				console.warn('[DomainKnowledge] syncDomainKnowledgeToS3 failed:', err),
			);
		}
	}

	// Auto-agent suggestion
	if (agentConfig.id === '_coordinator' && domain && result.toolCalls.length >= 2) {
		(async () => {
			try {
				const domainConvCount = await db
					.select({ count: count() })
					.from(conversations)
					.where(
						and(
							eq(conversations.userId, user.id),
							sql`${conversations.title} ILIKE ${'%' + domain.split('.')[0] + '%'}`,
						),
					);
				const convCount = domainConvCount[0]?.count ?? 0;

				const existingAgents = await db
					.select({ id: agents.id })
					.from(agents)
					.where(
						and(
							eq(agents.userId, user.id),
							sql`${agents.domains}::text LIKE ${'%' + domain + '%'}`,
						),
					)
					.limit(1);

				if (convCount >= 3 && existingAgents.length === 0) {
					console.log(
						`[Chat] Domain "${domain}" used ${convCount}x with no agent — consider auto-creating one`,
					);
					const { uploadDomainFile } = await import('../storage/domain-files.js');
					const agentHint = `## Agent Suggestion\n\nYou've worked on ${domain} ${convCount}+ times. Consider creating a specialized agent for this domain using create_agent. This will enable:\n- Persistent SKILLS.md with learned workflows\n- MEMORY.md with accumulated knowledge\n- Self-improvement after every run\n- Scheduled automation\n\nSuggest this to the user when appropriate.`;
					await uploadDomainFile(user.id, domain, 'AGENT_HINT.md', agentHint);
				}
			} catch {
				// Non-critical
			}
		})();
	}
}

/**
 * POST /api/chat/compact — manually compact a conversation's messages.
 * Summarizes history via fast model, saves transcript to S3, replaces messages.
 */
chatRoutes.post('/compact', async (c) => {
	const user = c.get('user');
	const { conversationId } = await c.req.json<{ conversationId: string }>();

	if (!conversationId) return c.json({ error: 'conversationId required' }, 400);

	// Load messages
	const msgs = await db
		.select()
		.from(messages)
		.where(and(eq(messages.conversationId, conversationId)))
		.orderBy(asc(messages.createdAt));

	if (msgs.length < 2) {
		return c.json({ error: 'Not enough messages to compact' }, 400);
	}
	console.log(
		`[Compact] Starting compaction for conversation ${conversationId} (${msgs.length} messages)`,
	);

	// Verify user owns conversation
	const [conv] = await db
		.select()
		.from(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id)));
	if (!conv) return c.json({ error: 'Conversation not found' }, 404);

	const provider = getProvider();
	const fastModel = getFastModel();

	const transcript = msgs
		.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[structured]'}`)
		.join('\n\n');

	try {
		const { collectStream: collect } = await import('../llm/types.js');
		const { saveCompaction } = await import('../storage/compaction-files.js');

		const summaryStream = provider.chat({
			model: fastModel,
			system:
				'Summarize this conversation concisely. Include: what was accomplished, what is in progress, key facts to continue. 2-3 paragraphs max.',
			messages: [{ role: 'user', content: transcript.slice(-6000) }],
			maxTokens: 500,
		});
		const summaryResponse = await collect(summaryStream);
		const summary = summaryResponse.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { text: string }).text)
			.join('');

		if (!summary) return c.json({ error: 'Failed to generate summary' }, 500);

		// Save full transcript to S3
		const { path } = await saveCompaction(user.id, conversationId, transcript, summary);

		// Delete old messages and insert compacted summary
		await db.delete(messages).where(eq(messages.conversationId, conversationId));
		await db.insert(messages).values({
			conversationId,
			role: 'user',
			content: `[Conversation compacted — ${msgs.length} messages saved to ${path}]\n\nSummary:\n${summary}\n\nContinue from where we left off.`,
		});

		return c.json({ summary, path, messagesCompacted: msgs.length });
	} catch (err) {
		console.error('Manual compaction failed:', err);
		return c.json({ error: 'Compaction failed' }, 500);
	}
});
