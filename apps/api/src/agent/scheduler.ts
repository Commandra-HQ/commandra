/**
 * Agent scheduler v2 — runs agents with cron triggers on schedule.
 *
 * Features:
 * - Run deduplication (prevents overlapping runs)
 * - Retry with exponential backoff (5m → 15m → 60m, 3 attempts)
 * - Failure alerts via webhook (Slack, email, WhatsApp)
 * - Offline run queue (executes when browser reconnects)
 * - Jitter (0-30s random delay to prevent thundering herd)
 */

import { and, eq, lte, sql } from 'drizzle-orm';
import type { SSEEvent } from '@afe/shared';
import { db } from '../db/index.js';
import { agentRuns, agents, conversations, messages as messagesTable, scheduledTasks } from '../db/schema.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import { loadDomainKnowledgeFromS3 } from '../memory/domain.js';
import { loadUserMemory } from '../memory/user.js';
import { loadSitemap, renderSitemapTree } from '../storage/sitemap.js';
import { getConnectionByUser, sendActionRequest, sendToExtension } from '../ws/handler.js';
import { resolveAgent } from './agent-registry.js';
import { runOrchestrator } from './orchestrator.js';
import { analyzeAndImprove, recordAgentRun } from './self-improve.js';

const SCHEDULER_INTERVAL = 60_000; // 1 minute
const MAX_JITTER_MS = 30_000; // 0-30s random delay
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5 * 60_000, 15 * 60_000, 60 * 60_000]; // 5m, 15m, 60m
const QUEUE_MAX_AGE_MS = 24 * 60 * 60_000; // 24 hours
const QUEUE_MAX_DEPTH = 5; // per agent

let intervalId: ReturnType<typeof setInterval> | null = null;

// Dedup: track which agents are currently running
const runningAgents = new Set<string>();

// Dedup: prevent same-minute double-fire
const lastRun = new Map<string, number>();

// Retry state: agentId → { attempt, nextRetryAt, agentRow, connectionId }
const retryQueue = new Map<
	string,
	{
		attempt: number;
		nextRetryAt: number;
		agent: typeof agents.$inferSelect;
		connectionId: string;
	}
>();

export function startScheduler(): void {
	if (intervalId) return;
	console.log('[Scheduler] Starting agent scheduler (60s interval)');
	intervalId = setInterval(tick, SCHEDULER_INTERVAL);
}

/**
 * Trigger an immediate run of a scheduled agent (used by "Run Now" API).
 * Returns the conversation ID so the caller can track the run.
 */
export async function runAgentNow(agentId: string, userId: string): Promise<{ conversationId: string } | { error: string }> {
	const connectionId = getConnectionByUser(userId);
	if (!connectionId) {
		return { error: 'Browser not connected — open the extension to run agents' };
	}

	const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
	if (!agent || agent.userId !== userId) {
		return { error: 'Agent not found' };
	}

	if (runningAgents.has(agentId)) {
		return { error: 'Agent is already running' };
	}

	// Fire and forget — returns immediately with conversation ID
	// We create the conversation here so we can return the ID
	const taskMessage = `Execute your task now (manual trigger): ${agent.description}`;
	const [conv] = await db
		.insert(conversations)
		.values({ userId, title: `[Manual] ${agent.name}` })
		.returning();
	await db.insert(messagesTable).values({
		conversationId: conv.id,
		role: 'user',
		content: taskMessage,
	});

	// Run in background
	runScheduledAgent(agent, connectionId).catch((err) =>
		console.error(`[Scheduler] Manual run for "${agent.slug}" failed:`, err),
	);

	return { conversationId: conv.id };
}

export function stopScheduler(): void {
	if (intervalId) {
		clearInterval(intervalId);
		intervalId = null;
		console.log('[Scheduler] Stopped');
	}
}

/**
 * Called when a user reconnects via WebSocket.
 * Checks for queued runs and executes them.
 */
export async function onUserReconnected(userId: string, connectionId: string): Promise<void> {
	try {
		const queued = await db
			.select()
			.from(agentRuns)
			.where(and(eq(agentRuns.userId, userId), eq(agentRuns.status, 'queued')));

		if (queued.length === 0) return;

		console.log(`[Scheduler] User ${userId.slice(0, 8)} reconnected — ${queued.length} queued runs`);

		for (const run of queued) {
			// Skip stale queued runs (older than 24h)
			const age = Date.now() - new Date(run.createdAt).getTime();
			if (age > QUEUE_MAX_AGE_MS) {
				await db
					.update(agentRuns)
					.set({ status: 'expired', error: 'Queued run expired (>24h)' })
					.where(eq(agentRuns.id, run.id));
				continue;
			}

			// Load the agent (skip coordinator runs — they have null agentId)
			if (!run.agentId) continue;
			const [agent] = await db
				.select()
				.from(agents)
				.where(eq(agents.id, run.agentId))
				.limit(1);

			if (!agent) continue;

			// Mark as running
			await db.update(agentRuns).set({ status: 'running' }).where(eq(agentRuns.id, run.id));

			console.log(`[Scheduler] Executing queued run for "${agent.slug}"`);

			// Execute with jitter to stagger multiple queued runs
			const jitter = Math.random() * 5000;
			setTimeout(() => {
				runScheduledAgent(agent, connectionId).catch((err) =>
					console.error(`[Scheduler] Queued run for "${agent.slug}" failed:`, err),
				);
			}, jitter);
		}
	} catch (err) {
		console.error('[Scheduler] Failed to process queued runs:', err);
	}
}

/**
 * Process one-time scheduled tasks whose runAt has passed.
 */
async function processScheduledTasks(): Promise<void> {
	const now = new Date();
	const pending = await db
		.select()
		.from(scheduledTasks)
		.where(and(eq(scheduledTasks.status, 'pending'), lte(scheduledTasks.runAt, now)))
		.limit(10);

	for (const task of pending) {
		// Mark as running
		await db.update(scheduledTasks).set({ status: 'running' }).where(eq(scheduledTasks.id, task.id));

		const connectionId = getConnectionByUser(task.userId);
		if (!connectionId) {
			console.log(`[Scheduler] Skipping scheduled task "${task.id}" — user not connected`);
			continue; // Will retry on next tick (still pending → running, reset below)
		}

		if (!task.agentId) {
			await db.update(scheduledTasks).set({ status: 'failed', error: 'No agent specified' }).where(eq(scheduledTasks.id, task.id));
			continue;
		}

		const [agent] = await db.select().from(agents).where(eq(agents.id, task.agentId)).limit(1);
		if (!agent) {
			await db.update(scheduledTasks).set({ status: 'failed', error: 'Agent not found' }).where(eq(scheduledTasks.id, task.id));
			continue;
		}

		console.log(`[Scheduler] Running scheduled task "${task.id}" — agent: ${agent.slug}, task: ${task.task}`);

		try {
			await runScheduledAgent(agent, connectionId);
			await db.update(scheduledTasks).set({ status: 'completed' }).where(eq(scheduledTasks.id, task.id));
			console.log(`[Scheduler] Scheduled task "${task.id}" completed`);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			await db.update(scheduledTasks).set({ status: 'failed', error: errMsg }).where(eq(scheduledTasks.id, task.id));
			console.error(`[Scheduler] Scheduled task "${task.id}" failed:`, errMsg);
		}
	}

	// Reset "running" tasks that have been stuck for >5 minutes back to pending (crash recovery)
	const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
	await db
		.update(scheduledTasks)
		.set({ status: 'pending' })
		.where(and(eq(scheduledTasks.status, 'running'), lte(scheduledTasks.runAt, fiveMinAgo)));
}

async function tick(): Promise<void> {
	try {
		// Process one-time scheduled tasks whose runAt has passed
		await processScheduledTasks();

		// Process retries first
		await processRetries();

		// Query all agents with a cron trigger set
		const scheduled = await db
			.select()
			.from(agents)
			.where(sql`${agents.trigger}->>'cron' IS NOT NULL`);

		const now = new Date();

		for (const agent of scheduled) {
			const trigger = agent.trigger as { cron?: string; enabled?: boolean } | null;
			if (!trigger?.cron || trigger.enabled === false) continue;

			// Check if cron matches current minute
			if (!cronMatches(trigger.cron, now)) continue;

			// Prevent double-firing within the same minute
			const minuteKey = `${agent.id}-${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
			if (lastRun.has(minuteKey)) continue;

			// Skip if this agent is already running (dedup)
			if (runningAgents.has(agent.id)) {
				console.log(`[Scheduler] Agent "${agent.slug}" still running, skipping`);
				continue;
			}

			// Check if user has an active WS connection
			const connectionId = getConnectionByUser(agent.userId);
			if (!connectionId) {
				// Queue the run for when user reconnects
				await queueOfflineRun(agent);
				continue;
			}

			lastRun.set(minuteKey, Date.now());

			// Run with jitter to prevent thundering herd
			const jitter = Math.random() * MAX_JITTER_MS;
			setTimeout(() => {
				runScheduledAgent(agent, connectionId).catch((err) =>
					console.error(`[Scheduler] Agent "${agent.slug}" failed:`, err),
				);
			}, jitter);
		}

		// Cleanup old lastRun entries (older than 5 minutes)
		const cutoff = Date.now() - 5 * 60_000;
		for (const [key, ts] of lastRun) {
			if (ts < cutoff) lastRun.delete(key);
		}
	} catch (err) {
		console.error('[Scheduler] Tick failed:', err);
	}
}

/**
 * Queue a run for an offline user. Will execute when they reconnect.
 */
async function queueOfflineRun(agent: typeof agents.$inferSelect): Promise<void> {
	try {
		// Check queue depth — don't accumulate too many
		const existing = await db
			.select({ id: agentRuns.id })
			.from(agentRuns)
			.where(
				and(
					eq(agentRuns.agentId, agent.id),
					eq(agentRuns.status, 'queued'),
				),
			);

		if (existing.length >= QUEUE_MAX_DEPTH) {
			console.log(
				`[Scheduler] Agent "${agent.slug}" queue full (${existing.length}/${QUEUE_MAX_DEPTH}), skipping`,
			);
			return;
		}

		await db.insert(agentRuns).values({
			agentId: agent.id,
			userId: agent.userId,
			status: 'queued',
			toolCalls: 0,
			tokensUsed: 0,
		});

		console.log(`[Scheduler] Queued run for "${agent.slug}" — user ${agent.userId.slice(0, 8)} offline`);
	} catch (err) {
		console.error(`[Scheduler] Failed to queue run for "${agent.slug}":`, err);
	}
}

/**
 * Process pending retries.
 */
async function processRetries(): Promise<void> {
	const now = Date.now();
	for (const [agentId, retry] of retryQueue) {
		if (now < retry.nextRetryAt) continue;
		if (runningAgents.has(agentId)) continue;

		// Check connection is still alive
		const connectionId = getConnectionByUser(retry.agent.userId);
		if (!connectionId) continue;

		console.log(
			`[Scheduler] Retrying agent "${retry.agent.slug}" (attempt ${retry.attempt + 1}/${MAX_RETRIES})`,
		);
		retryQueue.delete(agentId);

		runScheduledAgent(retry.agent, connectionId, retry.attempt + 1).catch((err) =>
			console.error(`[Scheduler] Retry for "${retry.agent.slug}" failed:`, err),
		);
	}
}

async function runScheduledAgent(
	agent: typeof agents.$inferSelect,
	connectionId: string,
	retryAttempt = 0,
): Promise<void> {
	// Mark as running for dedup
	runningAgents.add(agent.id);

	console.log(
		`[Scheduler] Running agent "${agent.slug}" (user ${agent.userId.slice(0, 8)})${retryAttempt > 0 ? ` [retry ${retryAttempt}]` : ''}`,
	);
	const startTime = Date.now();

	try {
		// Cheap check — ask fast model if the agent should run now (skip on retries)
		if (retryAttempt === 0) {
			const shouldRun = await cheapCheck(agent);
			if (!shouldRun) {
				console.log(`[Scheduler] Agent "${agent.slug}" — cheap check returned NO, skipping`);
				runningAgents.delete(agent.id);
				return;
			}
		}

		// Load agent config (hydrated with files)
		const agentConfig = await resolveAgent(agent.userId, agent.id);

		// Load domain knowledge from S3
		let domainKnowledge: string | undefined;
		let userMem: string | undefined;
		let sitemapTree: string | undefined;
		const domain = (agent.domains as string[] | null)?.[0];
		if (domain) {
			const [um, dk, sitemap] = await Promise.all([
				loadUserMemory(agent.userId, domain),
				loadDomainKnowledgeFromS3(agent.userId, domain),
				loadSitemap(agent.userId, domain),
			]);
			userMem = um ?? undefined;
			domainKnowledge = dk ?? undefined;
			const tree = renderSitemapTree(sitemap);
			sitemapTree = tree || undefined;
		}

		// Create a conversation record so scheduled runs appear in history
		const taskMessage = `Execute your scheduled task: ${agent.description}`;
		const [conv] = await db
			.insert(conversations)
			.values({ userId: agent.userId, title: `[Scheduled] ${agent.name}` })
			.returning();
		await db.insert(messagesTable).values({
			conversationId: conv.id,
			role: 'user',
			content: taskMessage,
		});

		// Open a dedicated background tab
		const startUrl = domain ? `https://${domain}` : 'about:blank';
		let scheduledTabId: number | undefined;
		try {
			const tabResult = (await sendActionRequest(
				connectionId,
				'open_tab',
				{ action: 'open_tab', url: startUrl, agentId: `scheduled-${agent.slug}` },
				20000,
			)) as { success?: boolean; data?: { tabId?: number } } | null;
			if (tabResult?.success && tabResult.data?.tabId) {
				scheduledTabId = tabResult.data.tabId;
			}
		} catch {
			// Fall back to using the active tab if open_tab fails
		}

		sendToExtension(connectionId, {
			type: 'scheduled_agent_start',
			agentSlug: agent.slug,
			agentName: agent.name,
			conversationId: conv.id,
			tabId: scheduledTabId,
		});

		const noopEvent = async (_event: SSEEvent): Promise<void> => {};

		if (scheduledTabId) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		const result = await runOrchestrator({
			userId: agent.userId,
			connectionId,
			messages: [{ role: 'user', content: taskMessage }],
			domainMemory: undefined,
			userMemory: userMem,
			domainKnowledge,
			domain,
			onEvent: noopEvent,
			agentConfig,
			tabId: scheduledTabId,
			sitemapTree,
		});

		const durationMs = Date.now() - startTime;

		// Save assistant response to conversation
		if (result.response.trim()) {
			await db.insert(messagesTable).values({
				conversationId: conv.id,
				role: 'assistant',
				content: result.response,
				...(result.toolCalls.length > 0 && { toolData: { tools: result.toolCalls } }),
			});
		}

		await recordAgentRun({
			agentId: agent.id,
			userId: agent.userId,
			conversationId: conv.id,
			status: 'completed',
			toolCalls: result.toolCalls.length,
			durationMs,
		});

		// Self-improvement for scheduled runs
		const transcript = `user: ${taskMessage}\n\nassistant: ${result.response}`;
		analyzeAndImprove({
			userId: agent.userId,
			agentConfig,
			toolCalls: result.toolCalls,
			transcript,
			duration: durationMs,
		}).catch((err) => console.warn('[Scheduler] analyzeAndImprove failed:', err));

		sendToExtension(connectionId, {
			type: 'scheduled_agent_end',
			agentSlug: agent.slug,
			agentName: agent.name,
			conversationId: conv.id,
			success: true,
			summary: result.response.slice(0, 200),
		});

		// Close the scheduled tab on success (no one is watching)
		if (scheduledTabId) {
			sendActionRequest(
				connectionId,
				'close_tab',
				{ action: 'close_tab', tabId: scheduledTabId },
				5000,
			).catch(() => {});
		}

		console.log(`[Scheduler] Agent "${agent.slug}" completed in ${durationMs}ms`);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		const durationMs = Date.now() - startTime;

		await recordAgentRun({
			agentId: agent.id,
			userId: agent.userId,
			status: 'failed',
			durationMs,
			error: errorMsg,
		});

		sendToExtension(connectionId, {
			type: 'scheduled_agent_end',
			agentSlug: agent.slug,
			agentName: agent.name,
			success: false,
			error: errorMsg,
		});

		console.error(`[Scheduler] Agent "${agent.slug}" failed:`, errorMsg);

		// Retry logic
		if (retryAttempt < MAX_RETRIES) {
			const delay = RETRY_DELAYS[retryAttempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
			console.log(
				`[Scheduler] Scheduling retry ${retryAttempt + 1}/${MAX_RETRIES} for "${agent.slug}" in ${Math.round(delay / 60_000)}m`,
			);
			retryQueue.set(agent.id, {
				attempt: retryAttempt,
				nextRetryAt: Date.now() + delay,
				agent,
				connectionId,
			});
		} else {
			// All retries exhausted — fire alert
			console.error(
				`[Scheduler] Agent "${agent.slug}" permanently failed after ${MAX_RETRIES} retries`,
			);
			await fireAlertWebhook(agent, errorMsg, retryAttempt);
		}
	} finally {
		runningAgents.delete(agent.id);
	}
}

/**
 * Fire an alert webhook on permanent failure.
 */
async function fireAlertWebhook(
	agent: typeof agents.$inferSelect,
	error: string,
	attempts: number,
): Promise<void> {
	const trigger = agent.trigger as { cron?: string; enabled?: boolean; alertWebhook?: string } | null;
	const webhookUrl = trigger?.alertWebhook;
	if (!webhookUrl) return;

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				event: 'agent_run_failed',
				agent: {
					id: agent.id,
					slug: agent.slug,
					name: agent.name,
				},
				error,
				attempts,
				timestamp: new Date().toISOString(),
			}),
			signal: AbortSignal.timeout(10_000),
		});
		console.log(`[Scheduler] Alert webhook sent for "${agent.slug}"`);
	} catch (err) {
		console.warn(`[Scheduler] Alert webhook failed for "${agent.slug}":`, err);
	}
}

/**
 * Cheap check — ask the fast model whether the agent should run right now.
 */
async function cheapCheck(agent: typeof agents.$inferSelect): Promise<boolean> {
	try {
		const provider = getProvider();
		const model = getFastModel();
		const stream = provider.chat({
			model,
			system: 'Answer YES or NO only.',
			messages: [
				{
					role: 'user',
					content: `Agent "${agent.name}": ${agent.description}. It is ${new Date().toLocaleString()}. Should this agent run its scheduled task now? Consider whether this is a reasonable time for such a task. YES or NO.`,
				},
			],
			maxTokens: 10,
		});

		const response = await collectStream(stream);
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { text: string }).text)
			.join('')
			.trim()
			.toUpperCase();

		return text.includes('YES');
	} catch {
		// If cheap check fails, run the agent anyway
		return true;
	}
}

/**
 * Match a 5-field cron expression against a date.
 * Fields: minute hour day-of-month month day-of-week
 * Supports: *, numbers, comma lists (1,3,5), ranges (1-5)
 */
export function cronMatches(expression: string, date: Date): boolean {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) return false;

	const checks = [
		{ value: date.getMinutes(), field: fields[0] },
		{ value: date.getHours(), field: fields[1] },
		{ value: date.getDate(), field: fields[2] },
		{ value: date.getMonth() + 1, field: fields[3] },
		{ value: date.getDay(), field: fields[4] }, // 0=Sunday
	];

	return checks.every(({ value, field }) => fieldMatches(field, value));
}

function fieldMatches(field: string, value: number): boolean {
	if (field === '*') return true;

	const parts = field.split(',');
	return parts.some((part) => {
		if (part.includes('-')) {
			const [minStr, maxStr] = part.split('-');
			const min = Number.parseInt(minStr, 10);
			const max = Number.parseInt(maxStr, 10);
			if (Number.isNaN(min) || Number.isNaN(max)) return false;
			return value >= min && value <= max;
		}
		return Number.parseInt(part, 10) === value;
	});
}
