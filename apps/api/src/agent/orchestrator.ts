/**
 * Agent orchestrator — the main agentic loop.
 *
 * Provider-agnostic: uses the LLM provider layer, not vendor SDKs directly.
 * Handles: tool dispatch, safety classification, audit logging, kill switch, streaming.
 * Emits structured SSE events instead of raw text.
 */

import type { AgentConfig, SSEEvent } from '@afe/shared';
import type {
	ContentBlock,
	Message,
	TextBlock,
	ThinkingContentBlock,
	ToolResultBlock,
	ToolUseBlock,
} from '../llm/types.js';
import { collectStream, getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import { compressHistory } from '../memory/conversation.js';
import { saveCompaction } from '../storage/compaction-files.js';
import { isKilled } from '../ws/handler.js';
import { evaluateOnComplete } from './hooks.js';
import { buildSystemPrompt } from './prompts.js';
import { buildToolList } from './tool-definitions.js';
import { executeToolBlock, partitionToolsBySafety } from './browser-tools.js';
import {
	trimMessagesForTokenBudget,
	estimateMessageChars,
	MAX_INPUT_TOKENS,
	CHARS_PER_TOKEN,
	setMaxInputTokens,
} from './token-budget.js';

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
	conversationId?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	maxIterations?: number;
	agentConfig: AgentConfig;
	depth?: number;
	domainKnowledge?: string;
	tabId?: number;
	existingPlan?: import('../storage/plan-files.js').StoredPlan | null;
}

export interface ToolCallRecord {
	name: string;
	args: unknown;
	result: unknown;
	success: boolean;
	durationMs?: number;
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
		domain,
		conversationId,
		onEvent,
		signal,
		maxIterations: maxIter,
		agentConfig,
		domainKnowledge,
	} = params;

	const maxIterations = agentConfig.maxIterations ?? maxIter ?? 25;
	const provider = getProvider();
	const model = agentConfig.model === 'fast' ? getFastModel() : getStrongModel();

	// Set context limit based on provider — Anthropic supports up to 1M, OpenAI varies
	const providerName = process.env.LLM_PROVIDER || 'anthropic';
	if (providerName === 'anthropic') {
		setMaxInputTokens(800_000); // Claude supports 1M, leave 200K headroom for output
	} else if (providerName === 'openai') {
		setMaxInputTokens(120_000); // GPT-4o supports 128K
	} else {
		setMaxInputTokens(200_000); // Conservative default
	}
	const systemPrompt = buildSystemPrompt(
		pageIndex,
		selectedElements,
		domainMemory,
		userMemory,
		agentConfig,
		domainKnowledge,
		params.existingPlan,
	);

	const currentDepth = params.depth ?? 0;
	const tools = buildToolList(agentConfig, currentDepth);
	const { tabId } = params;
	const context = { connectionId, userId, tabId };

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

	while (iterations < maxIterations) {
		// Token budget guard — strip old screenshots and truncate if messages are too large
		currentMessages = trimMessagesForTokenBudget(currentMessages);

		// Emit context usage so the extension can show a progress indicator
		const usedChars = estimateMessageChars(currentMessages) + systemPrompt.length;
		const usedTokens = Math.round(usedChars / CHARS_PER_TOKEN);
		const contextPercent = Math.round((usedTokens / MAX_INPUT_TOKENS) * 100);
		await onEvent({
			type: 'context_status',
			used: usedTokens,
			limit: MAX_INPUT_TOKENS,
			percent: Math.min(contextPercent, 100),
		});

		// Auto-compact at 80% context usage — save transcript, replace with summary
		if (contextPercent >= 80 && currentMessages.length > 4 && conversationId) {
			currentMessages = await autoCompact(
				currentMessages,
				provider,
				agentConfig,
				userId,
				conversationId,
				onEvent,
				contextPercent,
			);
		}

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
			maxTokens: agentConfig.llm?.maxOutputTokens ?? 8000,
			signal,
			thinking: agentConfig.llm?.thinkingEnabled === false
				? undefined
				: { budgetTokens: agentConfig.llm?.thinkingBudget ?? 4000 },
		});

		// Stream text to client in real time while collecting tool calls
		const content: ContentBlock[] = [];
		let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

		const streamResult = await streamLLMResponse(
			streamIter,
			content,
			onEvent,
			signal,
			iterations,
		);
		stopReason = streamResult.stopReason;
		fullResponse += streamResult.text;

		if (streamResult.contextError) {
			// Context length exceeded — aggressively trim and retry
			currentMessages = aggressiveTrim(currentMessages);
			await onEvent({
				type: 'text_delta',
				text: '\n\n*Context was too large — trimmed history and continuing...*\n\n',
			});
			continue;
		}

		if (streamResult.aborted) break;
		if (signal?.aborted) break;

		const response = { content, stopReason };

		// Process tool calls — parallel for safe tools, sequential for review/blocked
		const { toolResults, hasToolUse } = await processToolCalls(
			response,
			domain,
			agentConfig,
			context,
			userId,
			connectionId,
			onEvent,
			provider,
			domainMemory,
			userMemory,
			currentDepth,
			conversationId,
			signal,
			allToolCalls,
		);

		// If no tool use or end_turn, check OnComplete hooks before stopping
		if (!hasToolUse || response.stopReason === 'end_turn') {
			// OnComplete hook — verify task completion if agent has hooks configured
			if (agentConfig.hooks?.onComplete?.length) {
				const toolSummary = allToolCalls.map((t) => `${t.name}: ${t.success ? 'ok' : 'failed'}`).join(', ');
				const completionCheck = await evaluateOnComplete(agentConfig.hooks, fullResponse, toolSummary);
				if (!completionCheck.done) {
					// Hook says task isn't done — inject feedback and continue
					currentMessages = [
						...currentMessages,
						{ role: 'assistant', content: response.content },
						{ role: 'user', content: `[Hook verification failed] ${completionCheck.reason}. Please complete the remaining work.` },
					];
					await onEvent({ type: 'text_delta', text: `\n\n*Verifying completion... ${completionCheck.reason}*\n\n` });
					continue; // Go back to the loop
				}
			}
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

	// If we exhausted all iterations without end_turn, let the user know
	if (iterations >= maxIterations) {
		const msg = `\n\n*Reached maximum iterations (${maxIterations}). The task may not be complete — send "continue" to keep going.*`;
		fullResponse += msg;
		await onEvent({ type: 'text_delta', text: msg });
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
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	agentConfig: AgentConfig;
}): Promise<string> {
	const provider = getProvider();
	const model = params.agentConfig.model === 'fast' ? getFastModel() : getStrongModel();
	const systemPrompt = buildSystemPrompt(
		params.pageIndex,
		params.selectedElements,
		params.domainMemory,
		params.userMemory,
		params.agentConfig,
	);

	await params.onEvent({ type: 'thinking' });

	let fullResponse = '';

	const stream = provider.chat({
		model,
		system: systemPrompt,
		messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
		maxTokens: params.agentConfig.llm?.maxOutputTokens ?? 8000,
		signal: params.signal,
		thinking: params.agentConfig.llm?.thinkingEnabled === false
			? undefined
			: { budgetTokens: params.agentConfig.llm?.thinkingBudget ?? 3000 },
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

/**
 * Auto-compact conversation when context exceeds 80%.
 */
async function autoCompact(
	currentMessages: Message[],
	provider: ReturnType<typeof getProvider>,
	agentConfig: AgentConfig,
	userId: string,
	conversationId: string,
	onEvent: (event: SSEEvent) => Promise<void>,
	contextPercent: number,
): Promise<Message[]> {
	try {
		const transcript = currentMessages
			.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[tool data]'}`)
			.join('\n\n');

		const summaryStream = provider.chat({
			model: agentConfig.model === 'fast' ? getFastModel() : getFastModel(),
			system:
				'Summarize this conversation concisely. Include: what was accomplished, what is in progress, key facts the agent needs to continue. 2-3 paragraphs max.',
			messages: [{ role: 'user', content: transcript.slice(-6000) }],
			maxTokens: 500,
		});
		const summaryResponse = await collectStream(summaryStream);
		const summary = summaryResponse.content
			.filter((b: ContentBlock) => b.type === 'text')
			.map((b: ContentBlock) => (b as TextBlock).text)
			.join('');

		if (summary) {
			const { path } = await saveCompaction(userId, conversationId, transcript, summary);

			await onEvent({
				type: 'compaction',
				summary,
				path,
				messageCount: currentMessages.length,
			});

			const compacted: Message[] = [
				{
					role: 'user',
					content: `[Conversation compacted — ${currentMessages.length} messages saved to ${path}]\n\nSummary of what happened so far:\n${summary}\n\nContinue from where we left off.`,
				},
			];

			console.log(
				`[Orchestrator] Compacted ${currentMessages.length} messages → summary (${contextPercent}% context used)`,
			);
			return compacted;
		}
	} catch (err) {
		console.warn('[Orchestrator] Compaction failed (non-critical):', err);
	}
	return currentMessages;
}

interface StreamResult {
	text: string;
	stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
	contextError: boolean;
	aborted: boolean;
}

/**
 * Stream the LLM response, accumulating content blocks and emitting SSE events.
 */
async function streamLLMResponse(
	streamIter: AsyncIterable<{ type: string; text?: string; id?: string; name?: string; input?: unknown; stopReason?: string; signature?: string }>,
	content: ContentBlock[],
	onEvent: (event: SSEEvent) => Promise<void>,
	signal: AbortSignal | undefined,
	iterations: number,
): Promise<StreamResult> {
	let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';
	let thinkingChunks = 0;
	let textChunks = 0;
	let text = '';

	try {
		for await (const event of streamIter) {
			if (signal?.aborted) return { text, stopReason, contextError: false, aborted: true };

			switch (event.type) {
				case 'thinking_delta':
					thinkingChunks++;
					if (thinkingChunks <= 3)
						console.log(
							`[Orchestrator] iter=${iterations} thinking_delta (chunk ${thinkingChunks}): "${event.text!.slice(0, 50)}..."`,
						);
					await onEvent({ type: 'thinking_delta', text: event.text! });
					if (content.length > 0 && content[content.length - 1].type === 'thinking') {
						(content[content.length - 1] as ThinkingContentBlock).thinking += event.text;
					} else {
						content.push({ type: 'thinking', thinking: event.text! });
					}
					break;
				case 'thinking_signature': {
					console.log(
						`[Orchestrator] iter=${iterations} thinking_signature received (${event.signature!.slice(0, 20)}...)`,
					);
					const lastThinking = [...content].reverse().find((b) => b.type === 'thinking');
					if (lastThinking) (lastThinking as ThinkingContentBlock).signature = event.signature;
					break;
				}
				case 'text':
					textChunks++;
					if (textChunks <= 3)
						console.log(
							`[Orchestrator] iter=${iterations} text (chunk ${textChunks}): "${event.text!.slice(0, 50)}..."`,
						);
					text += event.text;
					await onEvent({ type: 'text_delta', text: event.text! });
					if (content.length > 0 && content[content.length - 1].type === 'text') {
						(content[content.length - 1] as { text: string }).text += event.text;
					} else {
						content.push({ type: 'text', text: event.text! });
					}
					break;
				case 'tool_use_end':
					content.push({
						type: 'tool_use',
						id: event.id!,
						name: event.name!,
						input: event.input as Record<string, unknown>,
					});
					break;
				case 'message_end':
					stopReason = event.stopReason as typeof stopReason;
					break;
			}
		}
	} catch (err) {
		if (signal?.aborted) return { text, stopReason, contextError: false, aborted: true };

		const errMsg = err instanceof Error ? err.message : String(err);
		if (errMsg.includes('context_length_exceeded') || errMsg.includes('token')) {
			console.warn(`[Orchestrator] Context length exceeded on iteration ${iterations}, trimming aggressively`);
			return { text, stopReason, contextError: true, aborted: false };
		}
		throw err;
	}

	console.log(
		`[Orchestrator] iter=${iterations} stream done: thinkingChunks=${thinkingChunks} textChunks=${textChunks} stopReason=${stopReason} contentBlocks=${content.map((b) => b.type).join(',')}`,
	);

	return { text, stopReason, contextError: false, aborted: false };
}

/**
 * Aggressively trim messages for context length recovery.
 */
function aggressiveTrim(currentMessages: Message[]): Message[] {
	return currentMessages.slice(-2).map((m) => {
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
									.filter((sub: TextBlock | { type: string }) => sub.type !== 'image')
									.map((sub: TextBlock | { type: string }) =>
										sub.type === 'text' && (sub as TextBlock).text.length > 500
											? { ...sub, text: (sub as TextBlock).text.slice(0, 500) + '...' }
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
}

/**
 * Process tool calls from the LLM response — parallel for safe, sequential for review, reject blocked.
 */
async function processToolCalls(
	response: { content: ContentBlock[]; stopReason: string },
	domain: string | undefined,
	agentConfig: AgentConfig,
	context: { connectionId: string; userId: string },
	userId: string,
	connectionId: string,
	onEvent: (event: SSEEvent) => Promise<void>,
	provider: { supportsVision: boolean },
	domainMemory: string | undefined,
	userMemory: string | undefined,
	currentDepth: number,
	conversationId: string | undefined,
	signal: AbortSignal | undefined,
	allToolCalls: ToolCallRecord[],
): Promise<{ toolResults: ToolResultBlock[]; hasToolUse: boolean }> {
	const toolResults: ToolResultBlock[] = [];
	const toolBlocks = response.content.filter(
		(block): block is ToolUseBlock => block.type === 'tool_use',
	);

	if (toolBlocks.length === 0) {
		return { toolResults, hasToolUse: false };
	}

	// Partition tools by safety level for parallel execution
	const partitioned = partitionToolsBySafety(toolBlocks, domain, agentConfig.autonomy, agentConfig.domainAutonomy);

	// Phase 1: Execute all safe tools in parallel
	if (partitioned.safe.length > 0) {
		console.log(`[Orchestrator] Executing ${partitioned.safe.length} safe tools in parallel`);
		const safeResults = await Promise.allSettled(
			partitioned.safe.map((block) =>
				executeToolBlock(
					block, context, userId, connectionId, domain, onEvent,
					provider, domainMemory, userMemory, currentDepth, conversationId,
					agentConfig.autonomy, agentConfig.hooks,
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
			block, context, userId, connectionId, domain, onEvent,
			provider, domainMemory, userMemory, currentDepth, conversationId,
			agentConfig.autonomy,
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
	for (const block of toolBlocks) {
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

	return { toolResults, hasToolUse: true };
}
