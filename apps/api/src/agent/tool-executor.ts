/**
 * Tool execution and safety classification for the orchestrator.
 * Handles browser tool calls with safety gates, page state refresh, and screenshot management.
 */

import type { SSEEvent } from '@afe/shared';
import type { ImageBlock, TextBlock, ToolResultBlock, ToolUseBlock } from '../llm/types.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { persistScreenshot, saveScreenshot } from '../screenshots/manager.js';
import { executeTool } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';
import { isInternalTool } from './internal-tools.js';

/**
 * Partition tool blocks into safe/review/blocked buckets for parallel execution.
 * Internal tools are always safe (no WS routing).
 */
export function partitionToolsBySafety(
	toolBlocks: ToolUseBlock[],
	domain?: string,
): { safe: ToolUseBlock[]; review: ToolUseBlock[]; blocked: ToolUseBlock[] } {
	const safe: ToolUseBlock[] = [];
	const review: ToolUseBlock[] = [];
	const blocked: ToolUseBlock[] = [];

	for (const block of toolBlocks) {
		if (isInternalTool(block.name)) {
			safe.push(block);
			continue;
		}

		const elementLabel =
			(block.input.description as string) || (block.input.selector as string) || '';
		const classification = classifyAction({
			toolName: block.name,
			args: block.input,
			elementLabel,
		});

		if (classification.level === 'blocked') {
			blocked.push(block);
		} else if (classification.level === 'review') {
			review.push(block);
		} else {
			safe.push(block);
		}
	}

	return { safe, review, blocked };
}

interface ToolCallResult {
	data: unknown;
	isError: boolean;
}

/**
 * Handle a browser tool call with full safety workflow:
 * classification → approval gate → execution → page state refresh → event emission.
 */
export async function handleToolCall(
	block: ToolUseBlock,
	context: { connectionId: string; userId: string },
	userId: string,
	connectionId: string,
	onEvent: (event: SSEEvent) => Promise<void>,
): Promise<ToolCallResult> {
	const { name, input: toolArgs } = block;
	const elementLabel = (toolArgs.description as string) || (toolArgs.selector as string) || '';

	// Kill switch check before each action
	if (isKilled(connectionId)) {
		return {
			data: { success: false, error: 'Agent stopped by user' },
			isError: true,
		};
	}

	// Safety classification
	const classification = classifyAction({ toolName: name, args: toolArgs, elementLabel });
	console.log(
		`[Safety] ${name} "${elementLabel}" → ${classification.level} (${classification.reason})`,
	);

	// Blocked
	if (classification.level === 'blocked') {
		await onEvent({ type: 'blocked', toolName: name, reason: classification.reason });
		await logAction({
			userId,
			action: name,
			safetyLevel: 'blocked',
			approved: false,
			metadata: { args: toolArgs, reason: classification.reason },
		});
		return {
			data: {
				success: false,
				error: `Blocked: ${classification.reason}. Ask the user to confirm this action explicitly.`,
			},
			isError: true,
		};
	}

	// Review — request approval via WS
	if (classification.level === 'review') {
		try {
			const approval = await sendApprovalRequest(connectionId, {
				action: name,
				selector: toolArgs.selector as string,
				label: elementLabel,
				reason: classification.reason,
			});

			if (!approval.approved) {
				await logAction({
					userId,
					action: name,
					safetyLevel: 'review',
					approved: false,
					metadata: { args: toolArgs, reason: approval.reason },
				});
				return {
					data: {
						success: false,
						error: `User rejected this action. ${approval.reason || ''}`,
					},
					isError: true,
				};
			}
		} catch {
			await logAction({
				userId,
				action: name,
				safetyLevel: 'review',
				approved: false,
				metadata: { args: toolArgs, error: 'Approval failed' },
			});
			return {
				data: { success: false, error: 'Could not get user approval' },
				isError: true,
			};
		}
	}

	// Execute tool — emit start/end events with args and results
	await onEvent({
		type: 'tool_start',
		toolName: name,
		label: elementLabel || undefined,
		args: toolArgs,
	});

	try {
		const result = await executeTool(name, toolArgs, context);

		// Check if the tool itself reported failure (e.g., element not found, invalid selector)
		const resultData = result as unknown as Record<string, unknown> | undefined;
		const toolSucceeded = resultData?.success !== false;

		await logAction({
			userId,
			action: name,
			safetyLevel: classification.level,
			approved: true,
			metadata: { args: toolArgs, result },
		});

		// Auto-refresh page state after state-changing actions so the agent always has current DOM
		const STATE_CHANGING_TOOLS = ['click_element', 'navigate', 'type_text', 'select_option'];
		let pageStateUpdate: unknown = undefined;
		if (toolSucceeded && STATE_CHANGING_TOOLS.includes(name)) {
			try {
				const delay = name === 'click_element' || name === 'navigate' ? 2000 : 500;
				await new Promise((resolve) => setTimeout(resolve, delay));
				const freshState = await executeTool('get_page_state', {}, context);
				const freshData = freshState as unknown as Record<string, unknown>;
				if (freshData?.success) {
					pageStateUpdate = freshData.data;
				}
			} catch {
				// Non-critical — agent can still call refresh_page_state manually
			}
		}

		// Extract screenshot for the frontend if this was a screenshot tool
		const screenshotImage =
			name === 'screenshot' && resultData?.success
				? ((resultData.data as Record<string, unknown>)?.image as string | undefined)
				: undefined;

		// Merge page state update into the result so LLM sees current elements
		let enrichedResult: unknown = result;
		if (pageStateUpdate && resultData?.success) {
			const ps = pageStateUpdate as {
				elements?: { type: string; label: string; selector: string; inOverlay?: boolean }[];
				url?: string;
				title?: string;
			};
			if (ps.elements) {
				const overlayEls = ps.elements.filter((e) => e.inOverlay);
				const otherEls = ps.elements.filter((e) => !e.inOverlay);

				const formatEl = (e: { type: string; label: string; selector: string }) =>
					`[${e.type}] "${e.label}" → selector: ${e.selector}`;

				const elementSummary = [
					...(overlayEls.length > 0
						? ['MODAL/DIALOG ELEMENTS (use these first):', ...overlayEls.slice(0, 20).map(formatEl)]
						: []),
					'PAGE ELEMENTS:',
					...otherEls.slice(0, 30).map(formatEl),
					...(otherEls.length > 30 ? [`...and ${otherEls.length - 30} more`] : []),
				].join('\n');

				enrichedResult = {
					...resultData,
					updatedPageElements: elementSummary,
					note: 'USE ONLY the selectors listed above. Do NOT invent selectors.',
				};
			} else {
				enrichedResult = { ...resultData, pageState: pageStateUpdate };
			}
		}

		await onEvent({
			type: 'tool_end',
			toolName: name,
			success: toolSucceeded,
			result: screenshotImage ? { success: true } : enrichedResult,
			screenshot: screenshotImage,
			error: toolSucceeded ? undefined : (resultData?.error as string) || 'Action failed',
		});

		return { data: enrichedResult, isError: !toolSucceeded };
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await logAction({
			userId,
			action: name,
			safetyLevel: classification.level,
			approved: true,
			metadata: { args: toolArgs, error: errorMsg },
		});
		await onEvent({
			type: 'tool_end',
			toolName: name,
			success: false,
			error: errorMsg,
		});
		return {
			data: { success: false, error: errorMsg },
			isError: true,
		};
	}
}

/**
 * Execute a single tool block and return a ToolResultBlock.
 * Handles internal tools directly; routes browser tools through handleToolCall.
 */
export async function executeToolBlock(
	block: ToolUseBlock,
	context: { connectionId: string; userId: string },
	userId: string,
	connectionId: string,
	domain: string | undefined,
	onEvent: (event: SSEEvent) => Promise<void>,
	provider: { supportsVision: boolean },
	executeInternalToolFn: (
		block: ToolUseBlock,
	) => Promise<import('../llm/types.js').ToolResultBlock | null>,
): Promise<ToolResultBlock> {
	// Try internal tool first
	const internalResult = await executeInternalToolFn(block);
	if (internalResult) return internalResult;

	// Browser tool — classify, approve, execute
	const result = await handleToolCall(block, context, userId, connectionId, onEvent);

	// Build tool result content — save screenshots to disk, keep compressed version for LLM
	let toolContent: string | (TextBlock | ImageBlock)[];
	const resultData = result.data as Record<string, unknown> | undefined;
	const imageData = resultData?.data as Record<string, unknown> | undefined;

	if (
		block.name === 'screenshot' &&
		!result.isError &&
		imageData?.image &&
		provider.supportsVision
	) {
		const { image, ...rest } = imageData;
		const saved = saveScreenshot(image as string);
		console.log(
			`[Orchestrator] Screenshot saved: ${saved.id} (${Math.round(saved.sizeBytes / 1024)}KB)`,
		);
		if (domain) {
			try {
				persistScreenshot(image as string, domain, `${userId.slice(0, 8)}-${Date.now()}`);
			} catch {
				// Non-critical — tmp copy still exists
			}
		}
		toolContent = [
			{
				type: 'text' as const,
				text: JSON.stringify({ success: true, data: { ...rest, screenshotId: saved.id } }),
			},
			{
				type: 'image' as const,
				data: saved.base64,
				mediaType: 'image/jpeg' as const,
			},
		];
	} else {
		toolContent = JSON.stringify(result.data);
	}

	return {
		type: 'tool_result',
		toolUseId: block.id,
		content: toolContent,
		isError: result.isError,
	};
}
