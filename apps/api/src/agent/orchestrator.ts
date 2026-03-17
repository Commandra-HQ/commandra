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
import { getToolDefinitions } from '../tools/registry.js';
import { isKilled } from '../ws/handler.js';
import { executeInternalTool, getInternalToolDefinitions } from './internal-tools.js';
import { parsePlan } from './planner.js';
import { buildSystemPrompt } from './prompts.js';
import { trimMessagesForTokenBudget } from './token-budget.js';
import { executeToolBlock, partitionToolsBySafety } from './tool-executor.js';

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
	priorContext?: string;
	domain?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	maxIterations?: number;
	/** Optional agent instructions to prepend to system prompt */
	agentInstructions?: string;
	/** Optional tool filter — if set, only these tools are available */
	allowedTools?: string[];
}

export interface ToolCallRecord {
	name: string;
	args: unknown;
	result: unknown;
	success: boolean;
}

export interface OrchestratorResult {
	response: string;
	toolCalls: ToolCallRecord[];
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
		priorContext,
		domain,
		onEvent,
		signal,
		maxIterations = 15,
		agentInstructions,
		allowedTools,
	} = params;

	const provider = getProvider();
	const model = getStrongModel();

	// Build system prompt — agent instructions prepended if provided
	const basePrompt = buildSystemPrompt(
		pageIndex,
		selectedElements,
		domainMemory,
		userMemory,
		priorContext,
	);
	const systemPrompt = agentInstructions
		? `${agentInstructions}\n\n---\n\n${basePrompt}`
		: basePrompt;

	// Merge browser tools with internal tools, optionally filtered by agent config
	const browserTools = getToolDefinitions();
	const internalTools = getInternalToolDefinitions();
	let tools = [...browserTools, ...internalTools];
	if (allowedTools && !allowedTools.includes('*')) {
		const allowed = new Set(allowedTools);
		// Always allow internal tools
		tools = tools.filter(
			(t) => allowed.has(t.name) || internalTools.some((it) => it.name === t.name),
		);
	}

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
	const allToolCalls: ToolCallRecord[] = [];

	// Create bound internal tool executor with current context
	const boundExecuteInternal = (block: ToolUseBlock) =>
		executeInternalTool(block, {
			userId,
			connectionId,
			domain,
			domainMemory,
			userMemory,
			onEvent,
		});

	while (iterations < maxIterations) {
		// Token budget guard — strip old screenshots and truncate if messages are too large
		currentMessages = trimMessagesForTokenBudget(currentMessages);
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
						if (thinkingChunks <= 3)
							console.log(
								`[Orchestrator] iter=${iterations} thinking_delta (chunk ${thinkingChunks}): "${event.text.slice(0, 50)}..."`,
							);
						await onEvent({ type: 'thinking_delta', text: event.text });
						if (content.length > 0 && content[content.length - 1].type === 'thinking') {
							(content[content.length - 1] as ThinkingContentBlock).thinking += event.text;
						} else {
							content.push({ type: 'thinking', thinking: event.text });
						}
						break;
					case 'thinking_signature': {
						console.log(
							`[Orchestrator] iter=${iterations} thinking_signature received (${event.signature.slice(0, 20)}...)`,
						);
						const lastThinking = [...content].reverse().find((b) => b.type === 'thinking');
						if (lastThinking) (lastThinking as ThinkingContentBlock).signature = event.signature;
						break;
					}
					case 'text':
						textChunks++;
						if (textChunks <= 3)
							console.log(
								`[Orchestrator] iter=${iterations} text (chunk ${textChunks}): "${event.text.slice(0, 50)}..."`,
							);
						fullResponse += event.text;
						await onEvent({ type: 'text_delta', text: event.text });
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
			if (signal?.aborted) break;

			// Context length exceeded — aggressively trim and retry once
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg.includes('context_length_exceeded') || errMsg.includes('token')) {
				console.warn(
					`[Orchestrator] Context length exceeded on iteration ${iterations}, trimming aggressively`,
				);
				currentMessages = currentMessages.slice(-2).map((m) => {
					if (!Array.isArray(m.content)) return m;
					return {
						...m,
						content: (m.content as ContentBlock[])
							.filter((b) => b.type !== 'image')
							.map((b) => {
								if (b.type === 'tool_result') {
									const tr = b as ToolResultBlock;
									if (Array.isArray(tr.content)) {
										return {
											...tr,
											content: tr.content
												.filter((sub: TextBlock | ImageBlock) => sub.type !== 'image')
												.map((sub: TextBlock | ImageBlock) =>
													sub.type === 'text' && sub.text.length > 500
														? { ...sub, text: sub.text.slice(0, 500) + '...' }
														: sub,
												),
										} as ToolResultBlock;
									}
									if (typeof tr.content === 'string' && tr.content.length > 500) {
										return { ...tr, content: tr.content.slice(0, 500) + '...' };
									}
								}
								return b;
							}),
					};
				});
				await onEvent({
					type: 'text_delta',
					text: '\n\n*Context was too large — trimmed history and continuing...*\n\n',
				});
				continue;
			}

			throw err;
		}

		console.log(
			`[Orchestrator] iter=${iterations} stream done: thinkingChunks=${thinkingChunks} textChunks=${textChunks} stopReason=${stopReason} contentBlocks=${content.map((b) => b.type).join(',')}`,
		);

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

		// Process tool calls — parallel for safe tools, sequential for review/blocked
		const toolResults: ToolResultBlock[] = [];
		let hasToolUse = false;

		const toolBlocks = response.content.filter(
			(block): block is ToolUseBlock => block.type === 'tool_use',
		);

		if (toolBlocks.length > 0) {
			hasToolUse = true;

			const partitioned = partitionToolsBySafety(toolBlocks, domain);

			// Phase 1: Execute all safe tools in parallel
			if (partitioned.safe.length > 0) {
				console.log(`[Orchestrator] Executing ${partitioned.safe.length} safe tools in parallel`);
				const safeResults = await Promise.allSettled(
					partitioned.safe.map((block) =>
						executeToolBlock(
							block,
							context,
							userId,
							connectionId,
							domain,
							onEvent,
							provider,
							boundExecuteInternal,
						),
					),
				);

				for (let i = 0; i < safeResults.length; i++) {
					const settled = safeResults[i];
					const block = partitioned.safe[i];
					if (settled.status === 'fulfilled') {
						toolResults.push(settled.value);
					} else {
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({
								success: false,
								error: settled.reason?.message || 'Unknown error',
							}),
							isError: true,
						});
					}
				}
			}

			// Phase 2: Execute review tools sequentially (need approval gates)
			for (const block of partitioned.review) {
				if (signal?.aborted) break;
				const result = await executeToolBlock(
					block,
					context,
					userId,
					connectionId,
					domain,
					onEvent,
					provider,
					boundExecuteInternal,
				);
				toolResults.push(result);
			}

			// Phase 3: Reject blocked tools immediately
			for (const block of partitioned.blocked) {
				toolResults.push({
					type: 'tool_result',
					toolUseId: block.id,
					content: JSON.stringify({
						success: false,
						error: 'This action is blocked by safety policy. Ask the user to confirm explicitly.',
					}),
					isError: true,
				});
			}

			// Track tool calls for structured history
			for (let i = 0; i < toolBlocks.length; i++) {
				const block = toolBlocks[i];
				const result = toolResults.find((r) => r.toolUseId === block.id);
				allToolCalls.push({
					name: block.name,
					args: block.input,
					result: result
						? typeof result.content === 'string'
							? (() => {
									try {
										return JSON.parse(result.content);
									} catch {
										return result.content;
									}
								})()
							: '[structured]'
						: null,
					success: result ? !result.isError : false,
				});
			}

			// Sort results back to original tool call order (LLM expects this)
			const orderMap = new Map(toolBlocks.map((b, i) => [b.id, i]));
			toolResults.sort(
				(a, b) => (orderMap.get(a.toolUseId) ?? 0) - (orderMap.get(b.toolUseId) ?? 0),
			);
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

	return { response: fullResponse, toolCalls: allToolCalls };
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
	priorContext?: string;
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
		params.priorContext,
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
