/**
 * Agent orchestrator — the main agentic loop.
 *
 * Provider-agnostic: uses the LLM provider layer, not vendor SDKs directly.
 * Handles: tool dispatch, safety classification, audit logging, kill switch, streaming.
 * Emits structured SSE events instead of raw text.
 */

import type { SSEEvent } from '@afe/shared';
import { getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import type {
	ContentBlock,
	ImageBlock,
	Message,
	TextBlock,
	ToolResultBlock,
	ToolUseBlock,
} from '../llm/types.js';
import { compressHistory } from '../memory/conversation.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';
import { buildSystemPrompt } from './prompts.js';

export interface OrchestratorParams {
	userId: string;
	connectionId: string;
	messages: { role: 'user' | 'assistant'; content: string }[];
	pageIndex?: unknown;
	selectedElements?: {
		selector: string;
		fallbackSelectors: string[];
		tag: string;
		label: string;
		type?: string;
		attributes: Record<string, string>;
	}[];
	domainMemory?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	maxIterations?: number;
}

export interface OrchestratorResult {
	response: string;
}

/**
 * Run the agentic loop. Emits structured SSE events, executes tools,
 * handles safety classification and approval gates.
 */
export async function runOrchestrator(params: OrchestratorParams): Promise<OrchestratorResult> {
	const {
		userId,
		connectionId,
		messages: chatHistory,
		pageIndex,
		selectedElements,
		domainMemory,
		onEvent,
		signal,
		maxIterations = 15,
	} = params;

	const provider = getProvider();
	const model = getStrongModel();
	const systemPrompt = buildSystemPrompt(pageIndex, selectedElements, domainMemory);
	const tools = getToolDefinitions();
	const context = { connectionId, userId };

	// Compress long conversation histories before sending to LLM
	const { messages: compressedHistory } = await compressHistory(
		chatHistory,
		provider,
		getFastModel(),
	);

	// Build message history in provider-agnostic format
	let currentMessages: Message[] = compressedHistory.map((m) => ({
		role: m.role,
		content: m.content,
	}));

	let fullResponse = '';
	let iterations = 0;

	while (iterations < maxIterations) {
		// Kill switch / abort check
		if (isKilled(connectionId) || signal?.aborted) {
			break;
		}

		iterations++;

		// Signal that the LLM is thinking
		await onEvent({ type: 'thinking' });

		// Call LLM with abort signal
		const streamIter = provider.chat({
			model,
			system: systemPrompt,
			messages: currentMessages,
			tools: connectionId ? tools : undefined,
			maxTokens: 4096,
			signal,
		});

		// Stream text to client in real time while collecting tool calls
		const content: ContentBlock[] = [];
		let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

		try {
			for await (const event of streamIter) {
				if (signal?.aborted) break;

				switch (event.type) {
					case 'text':
						fullResponse += event.text;
						await onEvent({ type: 'text_delta', text: event.text });
						// Merge consecutive text blocks
						if (content.length > 0 && content[content.length - 1].type === 'text') {
							(content[content.length - 1] as { text: string }).text += event.text;
						} else {
							content.push({ type: 'text', text: event.text });
						}
						break;
					case 'tool_use_end':
						content.push({
							type: 'tool_use',
							id: event.id,
							name: event.name,
							input: event.input,
						});
						break;
					case 'message_end':
						stopReason = event.stopReason;
						break;
				}
			}
		} catch (err) {
			// AbortError is expected when client disconnects
			if (signal?.aborted) break;
			throw err;
		}

		if (signal?.aborted) break;

		const response = { content, stopReason };

		// Process tool calls
		const toolResults: ToolResultBlock[] = [];
		let hasToolUse = false;

		for (const block of response.content) {
			if (signal?.aborted) break;

			if (block.type === 'tool_use') {
				hasToolUse = true;
				const result = await handleToolCall(block, context, userId, connectionId, onEvent);

				// Build tool result content — include image for screenshot results
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
					toolContent = [
						{ type: 'text' as const, text: JSON.stringify({ success: true, data: rest }) },
						{
							type: 'image' as const,
							data: image as string,
							mediaType: 'image/jpeg' as const,
						},
					];
				} else {
					toolContent = JSON.stringify(result.data);
				}

				toolResults.push({
					type: 'tool_result',
					toolUseId: block.id,
					content: toolContent,
					isError: result.isError,
				});
			}
		}

		// If no tool use or end_turn, we're done
		if (!hasToolUse || response.stopReason === 'end_turn') {
			break;
		}

		// Feed results back to the LLM for the next iteration
		const assistantContent: ContentBlock[] = response.content;
		currentMessages = [
			...currentMessages,
			{ role: 'assistant', content: assistantContent },
			{ role: 'user', content: toolResults },
		];
	}

	return { response: fullResponse };
}

/**
 * Simple chat — no tool use, just streaming text response.
 */
export async function runSimpleChat(params: {
	messages: { role: 'user' | 'assistant'; content: string }[];
	pageIndex?: unknown;
	selectedElements?: OrchestratorParams['selectedElements'];
	domainMemory?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
}): Promise<string> {
	const provider = getProvider();
	const model = getStrongModel();
	const systemPrompt = buildSystemPrompt(
		params.pageIndex,
		params.selectedElements,
		params.domainMemory,
	);

	await params.onEvent({ type: 'thinking' });

	let fullResponse = '';

	const stream = provider.chat({
		model,
		system: systemPrompt,
		messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
		maxTokens: 2048,
		signal: params.signal,
	});

	try {
		for await (const event of stream) {
			if (params.signal?.aborted) break;
			if (event.type === 'text') {
				fullResponse += event.text;
				await params.onEvent({ type: 'text_delta', text: event.text });
			}
		}
	} catch (err) {
		if (params.signal?.aborted) return fullResponse;
		throw err;
	}

	return fullResponse;
}

// --- Internal helpers ---

interface ToolCallResult {
	data: unknown;
	isError: boolean;
}

async function handleToolCall(
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

	// Review — request approval via WS (existing flow, just emit events)
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
		await logAction({
			userId,
			action: name,
			safetyLevel: classification.level,
			approved: true,
			metadata: { args: toolArgs, result },
		});

		// Extract screenshot for the frontend if this was a screenshot tool
		const resultData = result as Record<string, unknown> | undefined;
		const screenshotImage =
			name === 'screenshot' && resultData?.success
				? ((resultData.data as Record<string, unknown>)?.image as string | undefined)
				: undefined;

		await onEvent({
			type: 'tool_end',
			toolName: name,
			success: true,
			result: screenshotImage ? { success: true } : result,
			screenshot: screenshotImage,
		});
		return { data: result, isError: false };
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
