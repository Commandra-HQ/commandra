/**
 * Agent orchestrator — the main agentic loop.
 *
 * Provider-agnostic: uses the LLM provider layer, not vendor SDKs directly.
 * Handles: tool dispatch, safety classification, audit logging, kill switch, streaming.
 * Emits structured SSE events instead of raw text.
 */

import type { SSEEvent } from '@afe/shared';
import { searchUserMemories } from '../db/vector-search.js';
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
import { type MemoryCategory, saveUserMemory } from '../memory/user.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';
import { parsePlan } from './planner.js';
import { buildSystemPrompt } from './prompts.js';
import { isRecording, recordStep } from './recorder.js';
import { spawnSubAgent, waitForAgents } from './swarm.js';

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
	const recallMemoryTool = {
		name: 'recall_memory',
		description:
			'Search your memories about this user and domain for specific information. Use when you need context not in the system prompt — e.g., past workflows, preferences, or domain knowledge.',
		parameters: {
			type: 'object' as const,
			properties: {
				query: {
					type: 'string',
					description:
						'What to search for — natural language description of the information you need',
				},
			},
			required: ['query'],
		},
	};
	const spawnAgentTool = {
		name: 'spawn_agent',
		description:
			'Spawn a sub-agent to perform a task in a separate browser context. Use for parallel operations like reading data from multiple pages simultaneously. Sub-agents use the fast model and have max 5 iterations.',
		parameters: {
			type: 'object' as const,
			properties: {
				task: {
					type: 'string',
					description: 'Natural language description of the task for the sub-agent',
				},
				targetUrl: {
					type: 'string',
					description: 'URL the sub-agent should navigate to first',
				},
				timeout: {
					type: 'number',
					description: 'Max execution time in milliseconds (default: 60000)',
				},
			},
			required: ['task', 'targetUrl'],
		},
	};
	const waitForAgentsTool = {
		name: 'wait_for_agents',
		description:
			'Wait for one or more spawned sub-agents to complete and get their results. Call this after spawning agents to collect their findings.',
		parameters: {
			type: 'object' as const,
			properties: {
				agentIds: {
					type: 'array',
					items: { type: 'string' },
					description: 'Array of agent IDs returned by spawn_agent',
				},
			},
			required: ['agentIds'],
		},
	};
	const tools = [
		...browserTools,
		saveMemoryTool,
		recallMemoryTool,
		spawnAgentTool,
		waitForAgentsTool,
	];
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
						if (thinkingChunks <= 3)
							console.log(
								`[Orchestrator] iter=${iterations} thinking_delta (chunk ${thinkingChunks}): "${event.text.slice(0, 50)}..."`,
							);
						await onEvent({ type: 'thinking_delta', text: event.text });
						// Accumulate thinking content for multi-turn history
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
						// Attach signature to the last thinking block (required for Anthropic multi-turn)
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

			// Partition tools by safety level for parallel execution
			const partitioned = partitionToolsBySafety(toolBlocks, domain);

			// Phase 1: Execute all safe tools in parallel (including save_memory)
			if (partitioned.safe.length > 0) {
				console.log(`[Orchestrator] Executing ${partitioned.safe.length} safe tools in parallel`);
				const safeResults = await Promise.allSettled(
					partitioned.safe.map((block) =>
						executeToolBlock(block, context, userId, connectionId, domain, onEvent, provider),
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

/**
 * Partition tool blocks into safe/review/blocked buckets for parallel execution.
 * save_memory is always safe (internal, no WS routing).
 */
function partitionToolsBySafety(
	toolBlocks: ToolUseBlock[],
	domain?: string,
): { safe: ToolUseBlock[]; review: ToolUseBlock[]; blocked: ToolUseBlock[] } {
	const safe: ToolUseBlock[] = [];
	const review: ToolUseBlock[] = [];
	const blocked: ToolUseBlock[] = [];

	for (const block of toolBlocks) {
		// Internal tools are always safe (no WS routing)
		if (['save_memory', 'recall_memory', 'spawn_agent', 'wait_for_agents'].includes(block.name)) {
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

/**
 * Execute a single tool block and return a ToolResultBlock.
 * Handles save_memory internally; routes browser tools through handleToolCall.
 */
async function executeToolBlock(
	block: ToolUseBlock,
	context: { connectionId: string; userId: string },
	userId: string,
	connectionId: string,
	domain: string | undefined,
	onEvent: (event: SSEEvent) => Promise<void>,
	provider: { supportsVision: boolean },
): Promise<ToolResultBlock> {
	// Handle internal tools (no WS routing)

	// recall_memory — search past memories on-demand
	if (block.name === 'recall_memory' && domain) {
		const args = block.input as { query: string };
		try {
			const results = await searchUserMemories(args.query, userId, domain, 5);
			const formatted =
				results.length > 0
					? results
							.map((r) => `[${r.category}] ${r.content} (confidence: ${r.confidence})`)
							.join('\n')
					: 'No matching memories found.';
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: true, memories: formatted, count: results.length }),
				isError: false,
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: false, error: errorMsg }),
				isError: true,
			};
		}
	}

	// spawn_agent — launch a sub-agent for parallel work
	if (block.name === 'spawn_agent') {
		const args = block.input as { task: string; targetUrl: string; timeout?: number };
		try {
			const result = await spawnSubAgent({
				userId,
				connectionId,
				task: args.task,
				targetUrl: args.targetUrl,
				domainMemory: undefined, // Will be loaded by coordinator context
				userMemory: undefined,
				domain,
				timeout: args.timeout,
				onEvent,
				signal: undefined,
			});
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify(
					result.error
						? { success: false, error: result.error }
						: {
								success: true,
								agentId: result.agentId,
								message: 'Sub-agent spawned. Use wait_for_agents to get results.',
							},
				),
				isError: !!result.error,
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: false, error: errorMsg }),
				isError: true,
			};
		}
	}

	// wait_for_agents — collect results from spawned sub-agents
	if (block.name === 'wait_for_agents') {
		const args = block.input as { agentIds: string[] };
		try {
			const results = await waitForAgents(userId, args.agentIds);
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: true, results }),
				isError: false,
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: false, error: errorMsg }),
				isError: true,
			};
		}
	}

	// save_memory — persist user preferences/corrections
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
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: true, message: 'Memory saved' }),
				isError: false,
			};
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: false, error: errorMsg }),
				isError: true,
			};
		}
	}

	// Browser tool — classify, approve, execute
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

	return {
		type: 'tool_result',
		toolUseId: block.id,
		content: toolContent,
		isError: result.isError,
	};
}

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

		// Record step if in teach mode (skip read-only tools)
		if (
			isRecording(connectionId) &&
			!['screenshot', 'get_page_state', 'refresh_page_state', 'go_back'].includes(name)
		) {
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
