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
	ThinkingContentBlock,
	ToolResultBlock,
	ToolUseBlock,
} from '../llm/types.js';
import { compressHistory } from '../memory/conversation.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';
import { saveUserMemory, type MemoryCategory } from '../memory/user.js';
import { parsePlan } from './planner.js';
import { buildSystemPrompt } from './prompts.js';
import { isRecording, recordStep } from './recorder.js';

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
	userMemory?: string;
	domain?: string;
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
		userMemory,
		domain,
		onEvent,
		signal,
		maxIterations = 15,
	} = params;

	const provider = getProvider();
	const model = getStrongModel();
	const systemPrompt = buildSystemPrompt(pageIndex, selectedElements, domainMemory, userMemory);

	// Add save_memory internal tool alongside browser tools
	const browserTools = getToolDefinitions();
	const saveMemoryTool = {
		name: 'save_memory',
		description:
			'Save something to remember about this user for future sessions. Use when the user explicitly asks you to remember something, or when you notice a strong preference or correction worth preserving.',
		parameters: {
			type: 'object' as const,
			properties: {
				category: {
					type: 'string',
					enum: ['preference', 'correction', 'terminology', 'workflow'],
					description:
						'Category: preference (how they like things), correction (something they corrected you on), terminology (their shorthand/jargon), workflow (repeated patterns)',
				},
				content: {
					type: 'string',
					description: 'What to remember — be specific and concise',
				},
			},
			required: ['category', 'content'],
		},
	};
	const tools = [...browserTools, saveMemoryTool];
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
		console.log(`[Orchestrator] Iteration ${iterations} starting`);

		// Signal that the LLM is thinking
		await onEvent({ type: 'thinking' });

		// Call LLM with abort signal — enable extended thinking for richer reasoning
		const streamIter = provider.chat({
			model,
			system: systemPrompt,
			messages: currentMessages,
			tools: connectionId ? tools : undefined,
			maxTokens: 8000,
			signal,
			thinking: { budgetTokens: 4000 },
		});

		// Stream text to client in real time while collecting tool calls
		const content: ContentBlock[] = [];
		let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';
		let thinkingChunks = 0;
		let textChunks = 0;

		try {
			for await (const event of streamIter) {
				if (signal?.aborted) break;

				switch (event.type) {
					case 'thinking_delta':
						thinkingChunks++;
						if (thinkingChunks <= 3) console.log(`[Orchestrator] iter=${iterations} thinking_delta (chunk ${thinkingChunks}): "${event.text.slice(0, 50)}..."`);
						await onEvent({ type: 'thinking_delta', text: event.text });
						// Accumulate thinking content for multi-turn history
						if (content.length > 0 && content[content.length - 1].type === 'thinking') {
							(content[content.length - 1] as ThinkingContentBlock).thinking += event.text;
						} else {
							content.push({ type: 'thinking', thinking: event.text });
						}
						break;
					case 'thinking_signature': {
						console.log(`[Orchestrator] iter=${iterations} thinking_signature received (${event.signature.slice(0, 20)}...)`);
						// Attach signature to the last thinking block (required for Anthropic multi-turn)
						const lastThinking = [...content].reverse().find((b) => b.type === 'thinking');
						if (lastThinking) (lastThinking as ThinkingContentBlock).signature = event.signature;
						break;
					}
					case 'text':
						textChunks++;
						if (textChunks <= 3) console.log(`[Orchestrator] iter=${iterations} text (chunk ${textChunks}): "${event.text.slice(0, 50)}..."`);
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

		console.log(`[Orchestrator] iter=${iterations} stream done: thinkingChunks=${thinkingChunks} textChunks=${textChunks} stopReason=${stopReason} contentBlocks=${content.map(b => b.type).join(',')}`);

		if (signal?.aborted) break;

		// Detect plan blocks in accumulated text and emit explicit plan SSE event
		const textSoFar = content
			.filter((b) => b.type === 'text')
			.map((b) => (b as TextBlock).text)
			.join('');
		const detectedPlan = parsePlan(textSoFar);
		if (detectedPlan) {
			await onEvent({
				type: 'plan',
				steps: detectedPlan.steps,
				description: detectedPlan.description,
			});
		}

		const response = { content, stopReason };

		// Process tool calls
		const toolResults: ToolResultBlock[] = [];
		let hasToolUse = false;

		for (const block of response.content) {
			if (signal?.aborted) break;

			if (block.type === 'tool_use') {
				hasToolUse = true;

				// Handle save_memory internally (no WS routing)
				if (block.name === 'save_memory' && domain) {
					const args = block.input as { category: string; content: string };
					try {
						await saveUserMemory(
							userId,
							domain,
							args.category as MemoryCategory,
							args.content,
							'explicit',
						);
						await onEvent({
							type: 'tool_start',
							toolName: 'save_memory',
							label: args.content.slice(0, 60),
							args: block.input,
						});
						await onEvent({
							type: 'tool_end',
							toolName: 'save_memory',
							success: true,
							result: { success: true, saved: args.content },
						});
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({ success: true, message: 'Memory saved' }),
							isError: false,
						});
					} catch (err) {
						const errorMsg = err instanceof Error ? err.message : String(err);
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({ success: false, error: errorMsg }),
							isError: true,
						});
					}
					continue;
				}

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
	userMemory?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
}): Promise<string> {
	const provider = getProvider();
	const model = getStrongModel();
	const systemPrompt = buildSystemPrompt(
		params.pageIndex,
		params.selectedElements,
		params.domainMemory,
		params.userMemory,
	);

	await params.onEvent({ type: 'thinking' });

	let fullResponse = '';

	const stream = provider.chat({
		model,
		system: systemPrompt,
		messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
		maxTokens: 8000,
		signal: params.signal,
		thinking: { budgetTokens: 3000 },
	});

	try {
		for await (const event of stream) {
			if (params.signal?.aborted) break;
			if (event.type === 'thinking_delta') {
				await params.onEvent({ type: 'thinking_delta', text: event.text });
			} else if (event.type === 'text') {
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
		const resultData = result as unknown as Record<string, unknown> | undefined;
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

		// Record step if in teach mode (skip read-only tools like screenshot/get_page_state)
		if (isRecording(connectionId) && !['screenshot', 'get_page_state'].includes(name)) {
			const step = await recordStep(
				connectionId,
				name,
				toolArgs,
				{ success: true, data: result },
				'', // URL pattern will be filled by page context
				'',
			);
			if (step) {
				await onEvent({ type: 'flow_step_recorded', step, stepCount: step.index + 1 });
			}
		}

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
