/**
 * Run Registry — manages active orchestrator runs independently of SSE connections.
 *
 * The orchestrator's lifecycle is owned by the run, not the HTTP request.
 * SSE streams are just "viewers" that subscribe/unsubscribe without affecting the run.
 */

import type { SSEEvent } from '@afe/shared';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import type { ToolCallRecord } from './orchestrator.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SSEWriter {
	writeSSE(data: { event: string; data: string }): Promise<void>;
}

type StreamBlock = {
	type: string;
	content?: string;
	toolName?: string;
	ts: number;
};

export interface ActiveRun {
	conversationId: string;
	userId: string;
	connectionId: string; // mutable — updated on WS reconnect
	abortController: AbortController;
	eventBuffer: SSEEvent[];
	sseSubscribers: Set<SSEWriter>;
	status: 'running' | 'paused' | 'completed' | 'failed';
	pausePromise?: { resolve: () => void; promise: Promise<void> };
	completionPromise: Promise<void>;
	resolveCompletion: () => void;
	streamBlocks: StreamBlock[];
	fullResponse: string;
	toolCalls: ToolCallRecord[];
	flushInterval?: ReturnType<typeof setInterval>;
	partialMessageId?: string; // tracks the upserted partial message row
}

// ── Registry ───────────────────────────────────────────────────────────────────

const activeRuns = new Map<string, ActiveRun>();

export function createRun(
	conversationId: string,
	userId: string,
	connectionId: string,
): ActiveRun {
	let resolveCompletion!: () => void;
	const completionPromise = new Promise<void>((r) => {
		resolveCompletion = r;
	});

	const run: ActiveRun = {
		conversationId,
		userId,
		connectionId,
		abortController: new AbortController(),
		eventBuffer: [],
		sseSubscribers: new Set(),
		status: 'running',
		completionPromise,
		resolveCompletion,
		streamBlocks: [],
		fullResponse: '',
		toolCalls: [],
	};

	activeRuns.set(conversationId, run);
	console.log(`[RunRegistry] createRun: ${conversationId} for user ${userId}`);

	// Update conversation status in DB
	updateConversationStatus(conversationId, 'running');

	// Start periodic flush of partial response
	startPeriodicFlush(run);

	return run;
}

export function getRun(conversationId: string): ActiveRun | undefined {
	return activeRuns.get(conversationId);
}

export function getRunByUser(userId: string): ActiveRun | undefined {
	for (const run of activeRuns.values()) {
		if (run.userId === userId && (run.status === 'running' || run.status === 'paused')) {
			return run;
		}
	}
	return undefined;
}

export function getAllRunsByUser(userId: string): ActiveRun[] {
	const runs: ActiveRun[] = [];
	for (const run of activeRuns.values()) {
		if (run.userId === userId && (run.status === 'running' || run.status === 'paused')) {
			runs.push(run);
		}
	}
	return runs;
}

export function killRun(conversationId: string): void {
	const run = activeRuns.get(conversationId);
	if (!run) return;

	console.log(`[RunRegistry] killRun: ${conversationId}`);
	run.abortController.abort();
	run.status = 'failed';

	// Resolve pause promise if paused (so the orchestrator unblocks and sees the abort)
	if (run.pausePromise) {
		run.pausePromise.resolve();
		run.pausePromise = undefined;
	}

	// Don't clean up yet — let the orchestrator's .catch()/.finally() call completeRun
}

export async function completeRun(
	conversationId: string,
	status: 'completed' | 'failed',
): Promise<void> {
	const run = activeRuns.get(conversationId);
	if (!run) return;

	console.log(`[RunRegistry] completeRun: ${conversationId} status=${status} eventBuffer=${run.eventBuffer.length} subscribers=${run.sseSubscribers.size}`);
	run.status = status;

	// Stop periodic flush
	if (run.flushInterval) {
		clearInterval(run.flushInterval);
		run.flushInterval = undefined;
	}

	// Final DB status update
	await updateConversationStatus(conversationId, status === 'completed' ? 'idle' : 'failed');

	// Resolve the completion promise so SSE subscribers unblock
	run.resolveCompletion();

	// Clean up after a short delay (allow final events to drain to subscribers)
	setTimeout(() => {
		activeRuns.delete(conversationId);
	}, 5000);
}

// ── SSE Subscriber Management ──────────────────────────────────────────────────

export function subscribeSSE(
	conversationId: string,
	writer: SSEWriter,
): () => void {
	const run = activeRuns.get(conversationId);
	if (!run) return () => {};

	run.sseSubscribers.add(writer);
	return () => {
		run.sseSubscribers.delete(writer);
	};
}

// ── Durable Event Emission ─────────────────────────────────────────────────────

export function createDurableOnEvent(
	run: ActiveRun,
): (event: SSEEvent) => Promise<void> {
	return async (event: SSEEvent) => {
		// 1. Always buffer (even with 0 subscribers)
		run.eventBuffer.push(event);

		// 2. Update streamBlocks for persistence
		updateStreamBlocks(run, event);

		// 3. Track fullResponse for text deltas
		if (event.type === 'text_delta') {
			run.fullResponse += event.text;
		}

		// 4. Track tool calls for incremental persistence
		if (event.type === 'tool_end') {
			run.toolCalls.push({
				name: event.toolName,
				args: {},
				result: event.result ?? (event.success ? 'ok' : event.error || 'failed'),
				success: event.success,
			});
		}

		// 5. Fan out to all active SSE subscribers (best-effort)
		const dead: SSEWriter[] = [];
		for (const sub of run.sseSubscribers) {
			try {
				await sub.writeSSE({
					event: event.type,
					data: JSON.stringify(event),
				});
			} catch {
				dead.push(sub);
			}
		}
		for (const sub of dead) {
			run.sseSubscribers.delete(sub);
		}
	};
}

function updateStreamBlocks(run: ActiveRun, event: SSEEvent): void {
	const blocks = run.streamBlocks;
	switch (event.type) {
		case 'thinking_delta': {
			const last = blocks[blocks.length - 1];
			if (last?.type === 'thinking') {
				last.content = (last.content || '') + event.text;
			} else {
				blocks.push({ type: 'thinking', content: event.text, ts: Date.now() });
			}
			break;
		}
		case 'text_delta': {
			const last = blocks[blocks.length - 1];
			if (last?.type === 'text') {
				last.content = (last.content || '') + event.text;
			} else {
				blocks.push({ type: 'text', content: event.text, ts: Date.now() });
			}
			break;
		}
		case 'tool_start':
			blocks.push({
				type: 'tool_start',
				toolName: event.toolName,
				content: event.label,
				ts: Date.now(),
			});
			break;
		case 'tool_end':
			blocks.push({
				type: 'tool_end',
				toolName: event.toolName,
				content: event.success ? 'ok' : event.error || 'failed',
				ts: Date.now(),
			});
			break;
		case 'blocked':
			blocks.push({
				type: 'blocked',
				toolName: event.toolName,
				content: event.reason,
				ts: Date.now(),
			});
			break;
		case 'sub_agent_start':
			blocks.push({
				type: 'sub_agent_start',
				toolName: event.agentId,
				content: `${event.task} → ${event.targetUrl}`,
				ts: Date.now(),
			});
			break;
		case 'sub_agent_action':
			blocks.push({
				type: 'sub_agent_action',
				toolName: event.toolName,
				content: event.success
					? event.label || 'ok'
					: event.error || 'failed',
				ts: Date.now(),
			});
			break;
		case 'sub_agent_end':
			blocks.push({
				type: 'sub_agent_end',
				toolName: event.agentId,
				content: event.success ? event.summary || 'done' : 'failed',
				ts: Date.now(),
			});
			break;
		case 'approval_inline': {
			// Save the full __approval__ string so it can be directly used for reconstruction
			let approvalStr: string;
			if (event.approvalType === 'plan') {
				const steps = (event.planSteps as string[]) || [];
				approvalStr = `plan:${event.requestId}:${event.label || ''}:${steps.join('|')}`;
			} else {
				approvalStr = `tool:${event.requestId}:${event.action}:${event.label || ''}:${event.reason}`;
			}
			blocks.push({
				type: 'approval_inline',
				content: approvalStr,
				ts: Date.now(),
			});
			break;
		}
		case 'plan_submitted':
			blocks.push({
				type: 'plan_submitted',
				content: event.description,
				ts: Date.now(),
			});
			break;
		case 'paused':
			blocks.push({ type: 'paused', content: event.reason, ts: Date.now() });
			break;
		case 'resumed':
			blocks.push({ type: 'resumed', ts: Date.now() });
			break;
	}
}

// ── Pause / Resume ─────────────────────────────────────────────────────────────

export function pauseForBrowser(conversationId: string): Promise<void> {
	const run = activeRuns.get(conversationId);
	if (!run) return Promise.resolve();

	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	run.pausePromise = { resolve, promise };
	run.status = 'paused';
	updateConversationStatus(conversationId, 'paused');
	return promise;
}

export function resumeRun(conversationId: string): void {
	const run = activeRuns.get(conversationId);
	if (!run) return;

	if (run.pausePromise) {
		run.status = 'running';
		updateConversationStatus(conversationId, 'running');
		run.pausePromise.resolve();
		run.pausePromise = undefined;
	}
}

export function updateConnectionId(
	conversationId: string,
	newConnectionId: string,
): void {
	const run = activeRuns.get(conversationId);
	if (run) {
		run.connectionId = newConnectionId;
	}
}

// ── Incremental Persistence ────────────────────────────────────────────────────

function startPeriodicFlush(run: ActiveRun): void {
	run.flushInterval = setInterval(async () => {
		if (run.status !== 'running' && run.status !== 'paused') {
			clearInterval(run.flushInterval);
			run.flushInterval = undefined;
			return;
		}
		await flushPartialMessage(run);
	}, 5_000);
}

async function flushPartialMessage(run: ActiveRun): Promise<void> {
	// Only flush if there's content
	const content = run.fullResponse.trim();
	if (!content && run.streamBlocks.length === 0) return;
	console.log(`[RunRegistry] flush: ${run.conversationId} blocks=${run.streamBlocks.length} contentLen=${content.length} partialMsgId=${run.partialMessageId || 'new'}`);

	const toolData: Record<string, unknown> = { partial: true };
	if (run.streamBlocks.length > 0) toolData.streamBlocks = [...run.streamBlocks];
	if (run.toolCalls.length > 0) toolData.tools = [...run.toolCalls];

	try {
		if (run.partialMessageId) {
			// Update existing partial message
			await db
				.update(messages)
				.set({
					content: content || '(processing...)',
					toolData,
				})
				.where(eq(messages.id, run.partialMessageId));
		} else {
			// Insert new partial message
			const [row] = await db
				.insert(messages)
				.values({
					conversationId: run.conversationId,
					role: 'assistant',
					content: content || '(processing...)',
					toolData,
				})
				.returning({ id: messages.id });
			if (row) {
				run.partialMessageId = row.id;
			}
		}
	} catch (err) {
		console.warn('[RunRegistry] Failed to flush partial message:', err);
	}
}

/**
 * Save the final assistant message, replacing the partial if one exists.
 */
export async function saveFinalMessage(
	run: ActiveRun,
	toolCallRecords?: { name: string; args: unknown; result: unknown; success: boolean }[],
): Promise<void> {
	let content = run.fullResponse.trim();

	// If no text, generate summary from tool calls
	if (!content && toolCallRecords && toolCallRecords.length > 0) {
		const summary = toolCallRecords
			.map(
				(t) =>
					`${t.success ? '✓' : '✗'} ${t.name}${t.args && typeof t.args === 'object' && 'selector' in (t.args as Record<string, unknown>) ? ` (${(t.args as Record<string, unknown>).selector})` : ''}`,
			)
			.join('\n');
		content = `Executed ${toolCallRecords.length} actions:\n${summary}`;
	}

	if (!content) return;

	const fullToolData: Record<string, unknown> = {};
	if (toolCallRecords && toolCallRecords.length > 0) fullToolData.tools = toolCallRecords;
	if (run.streamBlocks.length > 0) fullToolData.streamBlocks = run.streamBlocks;

	try {
		if (run.partialMessageId) {
			// Replace partial with final
			await db
				.update(messages)
				.set({
					content,
					...(Object.keys(fullToolData).length > 0 && { toolData: fullToolData }),
				})
				.where(eq(messages.id, run.partialMessageId));
		} else {
			// No partial existed — insert fresh
			await db
				.insert(messages)
				.values({
					conversationId: run.conversationId,
					role: 'assistant',
					content,
					...(Object.keys(fullToolData).length > 0 && { toolData: fullToolData }),
				})
				.catch((err) => console.error('[RunRegistry] Failed to save final message:', err));
		}
	} catch (err) {
		console.error('[RunRegistry] Failed to save final message:', err);
	}
}

// ── DB Helpers ─────────────────────────────────────────────────────────────────

export async function updateConversationStatus(
	conversationId: string,
	status: string,
): Promise<void> {
	await db
		.update(conversations)
		.set({ status, updatedAt: new Date() })
		.where(eq(conversations.id, conversationId))
		.catch((err) =>
			console.warn('[RunRegistry] Failed to update conversation status:', err),
		);
}

/**
 * On server startup, reset any stale running/paused conversations to idle.
 * These are leftovers from a previous server process that crashed.
 */
export async function resetStaleRuns(): Promise<void> {
	try {
		const result = await db
			.update(conversations)
			.set({ status: 'idle', updatedAt: new Date() })
			.where(inArray(conversations.status, ['running', 'paused']));
		console.log('[RunRegistry] Reset stale conversation statuses on startup');
	} catch (err) {
		console.warn('[RunRegistry] Failed to reset stale runs:', err);
	}
}

// ── Utility ────────────────────────────────────────────────────────────────────

/**
 * Helper to create a promise that resolves when an AbortSignal fires.
 */
export function abortPromise(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve(), { once: true });
	});
}
