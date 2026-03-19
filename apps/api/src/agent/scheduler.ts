/**
 * Agent scheduler — runs agents with cron triggers on schedule.
 * Requires an active browser connection (WS) to execute.
 */

import { db } from '../db/index.js';
import { agents, conversations, messages as messagesTable } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { resolveAgent } from './agent-registry.js';
import { runOrchestrator } from './orchestrator.js';
import { analyzeAndImprove, recordAgentRun } from './self-improve.js';
import { loadDomainMemory } from '../memory/domain.js';
import { loadUserMemory } from '../memory/user.js';
import { getConnectionByUser, sendActionRequest, sendToExtension } from '../ws/handler.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import type { SSEEvent } from '@afe/shared';

const SCHEDULER_INTERVAL = 60_000; // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null;
const lastRun = new Map<string, number>();

export function startScheduler(): void {
	if (intervalId) return;
	console.log('[Scheduler] Starting agent scheduler (60s interval)');
	intervalId = setInterval(tick, SCHEDULER_INTERVAL);
}

export function stopScheduler(): void {
	if (intervalId) {
		clearInterval(intervalId);
		intervalId = null;
		console.log('[Scheduler] Stopped');
	}
}

async function tick(): Promise<void> {
	try {
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

			// Check if user has an active WS connection
			const connectionId = getConnectionByUser(agent.userId);
			if (!connectionId) {
				console.log(`[Scheduler] Skipping agent "${agent.slug}" — user ${agent.userId.slice(0, 8)} offline`);
				continue;
			}

			lastRun.set(minuteKey, Date.now());

			// Run in background — don't block the tick loop
			runScheduledAgent(agent, connectionId).catch((err) =>
				console.error(`[Scheduler] Agent "${agent.slug}" failed:`, err),
			);
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

async function runScheduledAgent(
	agent: typeof agents.$inferSelect,
	connectionId: string,
): Promise<void> {
	console.log(`[Scheduler] Running agent "${agent.slug}" (user ${agent.userId.slice(0, 8)})`);
	const startTime = Date.now();

	try {
		// Cheap check — ask fast model if the agent should run now
		const shouldRun = await cheapCheck(agent);
		if (!shouldRun) {
			console.log(`[Scheduler] Agent "${agent.slug}" — cheap check returned NO, skipping`);
			return;
		}

		// Load agent config (hydrated with files)
		const agentConfig = await resolveAgent(agent.userId, agent.id);

		// Load domain memory if agent has domains
		let domainMem: string | undefined;
		let userMem: string | undefined;
		const domain = (agent.domains as string[] | null)?.[0];
		if (domain) {
			const [dm, um] = await Promise.all([
				loadDomainMemory(domain),
				loadUserMemory(agent.userId, domain),
			]);
			domainMem = dm ?? undefined;
			userMem = um ?? undefined;
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

		// Open a dedicated background tab so we don't interfere with the user's active tab
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

		// Notify the extension that a scheduled agent is running
		sendToExtension(connectionId, {
			type: 'scheduled_agent_start',
			agentSlug: agent.slug,
			agentName: agent.name,
			conversationId: conv.id,
			tabId: scheduledTabId,
		});

		// No-op SSE handler — scheduled runs don't stream to an HTTP response
		const noopEvent = async (_event: SSEEvent): Promise<void> => {};

		// If we got a dedicated tab, wait for it to load
		if (scheduledTabId) {
			await new Promise((resolve) => setTimeout(resolve, 3000));
		}

		const result = await runOrchestrator({
			userId: agent.userId,
			connectionId,
			messages: [{ role: 'user', content: taskMessage }],
			domainMemory: domainMem,
			userMemory: userMem,
			domain,
			onEvent: noopEvent,
			agentConfig,
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

		// Notify extension that the run completed
		sendToExtension(connectionId, {
			type: 'scheduled_agent_end',
			agentSlug: agent.slug,
			agentName: agent.name,
			conversationId: conv.id,
			success: true,
			summary: result.response.slice(0, 200),
		});

		console.log(`[Scheduler] Agent "${agent.slug}" completed in ${durationMs}ms`);
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await recordAgentRun({
			agentId: agent.id,
			userId: agent.userId,
			status: 'failed',
			durationMs: Date.now() - startTime,
			error: errorMsg,
		});
		// Notify extension about failure
		sendToExtension(connectionId, {
			type: 'scheduled_agent_end',
			agentSlug: agent.slug,
			agentName: agent.name,
			success: false,
			error: errorMsg,
		});
		console.error(`[Scheduler] Agent "${agent.slug}" failed:`, errorMsg);
	}
}

/**
 * Cheap check — ask the fast model whether the agent should run right now.
 * Returns true if YES, false if NO.
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

	// Comma-separated list: 1,3,5
	const parts = field.split(',');
	return parts.some((part) => {
		// Range: 1-5
		if (part.includes('-')) {
			const [minStr, maxStr] = part.split('-');
			const min = Number.parseInt(minStr, 10);
			const max = Number.parseInt(maxStr, 10);
			if (Number.isNaN(min) || Number.isNaN(max)) return false;
			return value >= min && value <= max;
		}
		// Exact number
		return Number.parseInt(part, 10) === value;
	});
}
