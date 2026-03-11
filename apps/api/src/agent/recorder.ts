/**
 * Flow recorder — captures tool calls during a conversation into FlowSteps.
 *
 * When recording mode is active, each tool call executed by the orchestrator
 * is captured as a FlowStep. The LLM generates an intent description for each step.
 * At the end, the steps are saved as a flow.
 */

import type { FlowStep, SSEEvent } from '@afe/shared';
import { db } from '../db/index.js';
import { flows, sites } from '../db/schema.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { eq } from 'drizzle-orm';

/** In-memory recording sessions keyed by connectionId */
const recordings = new Map<
	string,
	{
		userId: string;
		domain: string;
		steps: FlowStep[];
		onEvent: (event: SSEEvent) => Promise<void>;
	}
>();

export function startRecording(
	connectionId: string,
	userId: string,
	domain: string,
	onEvent: (event: SSEEvent) => Promise<void>,
) {
	recordings.set(connectionId, { userId, domain, steps: [], onEvent });
}

export function isRecording(connectionId: string): boolean {
	return recordings.has(connectionId);
}

export function getRecording(connectionId: string) {
	return recordings.get(connectionId);
}

/**
 * Record a tool call as a flow step.
 * Called by the orchestrator after each successful tool execution.
 */
export async function recordStep(
	connectionId: string,
	toolName: string,
	args: Record<string, unknown>,
	result: { success: boolean; data?: unknown },
	urlPattern: string,
	pageType: string,
): Promise<FlowStep | null> {
	const recording = recordings.get(connectionId);
	if (!recording) return null;

	// Generate intent description using the fast model
	const intent = await generateIntent(toolName, args);

	const step: FlowStep = {
		index: recording.steps.length,
		intent,
		toolName,
		args,
		urlPattern,
		pageType,
		result,
	};

	recording.steps.push(step);

	return step;
}

/**
 * Stop recording and save the flow.
 * Returns the created flow ID.
 */
export async function stopRecording(
	connectionId: string,
	name: string,
	description?: string,
): Promise<string | null> {
	const recording = recordings.get(connectionId);
	if (!recording || recording.steps.length === 0) {
		recordings.delete(connectionId);
		return null;
	}

	const { userId, domain, steps } = recording;
	recordings.delete(connectionId);

	// Find or create site
	let [site] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);
	if (!site) {
		[site] = await db.insert(sites).values({ userId, domain }).returning();
	}

	// Save flow
	const [flow] = await db
		.insert(flows)
		.values({
			userId,
			siteId: site.id,
			name: name.trim(),
			description: description?.trim() || null,
			steps,
			parameters: [],
			status: 'ready',
		})
		.returning();

	return flow.id;
}

export function cancelRecording(connectionId: string) {
	recordings.delete(connectionId);
}

/**
 * Use the fast model to generate a human-readable intent from a tool call.
 */
async function generateIntent(
	toolName: string,
	args: Record<string, unknown>,
): Promise<string> {
	// Simple heuristic first — only call LLM for complex cases
	const selector = args.selector as string | undefined;
	const text = args.text as string | undefined;
	const url = args.url as string | undefined;
	const value = args.value as string | undefined;

	switch (toolName) {
		case 'navigate':
			return `Navigate to ${url || 'page'}`;
		case 'click_element':
			return `Click ${selector ? `"${selectorToLabel(selector)}"` : 'element'}`;
		case 'type_text':
			return `Type "${text?.slice(0, 50) || ''}" into ${selector ? `"${selectorToLabel(selector)}"` : 'field'}`;
		case 'select_option':
			return `Select "${value || ''}" from ${selector ? `"${selectorToLabel(selector)}"` : 'dropdown'}`;
		case 'screenshot':
			return 'Take a screenshot to see the page';
		case 'get_page_state':
			return 'Check the current page state';
		case 'scroll':
			return `Scroll ${(args.direction as string) || 'down'}`;
		case 'wait_for_element':
			return `Wait for ${selector ? `"${selectorToLabel(selector)}"` : 'element'} to appear`;
		case 'read_text':
			return `Read text from ${selector ? `"${selectorToLabel(selector)}"` : 'element'}`;
		case 'read_table':
			return `Read table data from ${selector ? `"${selectorToLabel(selector)}"` : 'table'}`;
		case 'export_data':
			return `Export data as ${(args.format as string) || 'CSV'}`;
		default:
			return `Execute ${toolName}`;
	}
}

/** Extract a human-readable label from a CSS selector */
function selectorToLabel(selector: string): string {
	// Try to extract meaningful parts: #id, .class, [aria-label], text content
	const ariaMatch = selector.match(/\[aria-label="([^"]+)"\]/);
	if (ariaMatch) return ariaMatch[1];

	const idMatch = selector.match(/#([\w-]+)/);
	if (idMatch) return idMatch[1].replace(/-/g, ' ');

	const dataTestId = selector.match(/\[data-testid="([^"]+)"\]/);
	if (dataTestId) return dataTestId[1].replace(/-/g, ' ');

	// Return last meaningful part of selector
	const parts = selector.split(/\s+/);
	return parts[parts.length - 1].replace(/[.#\[\]"=]/g, ' ').trim() || selector;
}
