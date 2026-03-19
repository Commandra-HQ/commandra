/**
 * Agent orchestrator — the main agentic loop.
 *
 * Provider-agnostic: uses the LLM provider layer, not vendor SDKs directly.
 * Handles: tool dispatch, safety classification, audit logging, kill switch, streaming.
 * Emits structured SSE events instead of raw text.
 */

import type { AgentConfig, SSEEvent } from '@afe/shared';
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
import { createAgent, loadAgentBySlug } from './agent-registry.js';
import { buildSystemPrompt } from './prompts.js';
import { persistScreenshot, saveScreenshot } from '../screenshots/manager.js';
import { uploadAgentFile } from '../storage/agent-files.js';
import { saveLocalFile } from '../storage/local.js';
import { type StoredPlan, loadPlan, savePlan, updatePlanStep } from '../storage/plan-files.js';
import { spawnSubAgent, waitForAgents } from './swarm.js';
import { db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { eq } from 'drizzle-orm';

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
	conversationId?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	maxIterations?: number;
	agentConfig: AgentConfig;
	depth?: number;
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
		conversationId,
		onEvent,
		signal,
		maxIterations: maxIter,
		agentConfig,
	} = params;

	const maxIterations = agentConfig.maxIterations ?? maxIter ?? 15;
	const provider = getProvider();
	const model = agentConfig.model === 'fast' ? getFastModel() : getStrongModel();
	const systemPrompt = buildSystemPrompt(pageIndex, selectedElements, domainMemory, userMemory, priorContext, agentConfig);

	// Add save_memory internal tool alongside browser tools
	const browserTools = getToolDefinitions(agentConfig.tools);
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
			'Spawn a sub-agent to perform a task in a separate browser context. Use for parallel operations like reading data from multiple pages simultaneously. You can target a specific agent by slug via `agentSlug`, or let the system use the default coordinator.',
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
				agentSlug: {
					type: 'string',
					description: 'Optional slug of a specific agent to use for this task (e.g. "email-drafter")',
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
	const saveToLocalTool = {
		name: 'save_to_local',
		description:
			'Save a file to persistent local storage on the user\'s computer (~/.commandra/). Use for exports, extracted data, or context files the user wants to keep.',
		parameters: {
			type: 'object' as const,
			properties: {
				filename: {
					type: 'string',
					description: 'Filename to save as (e.g. "report.json", "data.csv")',
				},
				content: {
					type: 'string',
					description: 'File content to save',
				},
				category: {
					type: 'string',
					enum: ['exports', 'context'],
					description: 'Category: exports (user-requested data) or context (reference material)',
				},
			},
			required: ['filename', 'content', 'category'],
		},
	};
	const createAgentTool = {
		name: 'create_agent',
		description:
			'Create a new persistent agent that specializes in a task or domain. Use when the user describes a repeatable workflow, asks you to "remember how to do this", wants a scheduled task, or explicitly asks for an agent. The agent will retain its personality and skills across sessions.',
		parameters: {
			type: 'object' as const,
			properties: {
				slug: {
					type: 'string',
					description: 'URL-safe identifier (lowercase, hyphens, underscores). e.g. "gmail-summarizer", "jira-triager"',
				},
				name: {
					type: 'string',
					description: 'Human-readable name. e.g. "Gmail Morning Summarizer"',
				},
				description: {
					type: 'string',
					description: 'What this agent does — one sentence. e.g. "Summarizes unread emails from key contacts every morning"',
				},
				soul: {
					type: 'string',
					description: 'The agent\'s personality and behavioral instructions (becomes SOUL.md). Write in second person: "You are a..."',
				},
				domains: {
					type: 'array',
					items: { type: 'string' },
					description: 'Domains this agent works on. e.g. ["mail.google.com", "*.github.com"]',
				},
				cron: {
					type: 'string',
					description: 'Optional cron schedule (5-field). e.g. "0 9 * * 1-5" for weekdays at 9am. Only if the user wants it to run automatically.',
				},
			},
			required: ['slug', 'name', 'description', 'soul'],
		},
	};
	const updateAgentFilesTool = {
		name: 'update_agent_files',
		description:
			'Write or update a file for an existing agent (SOUL.md, SKILLS.md, LEARNINGS.md, ERRORS.md). Use after create_agent to add initial skills, or to update an agent\'s personality/capabilities.',
		parameters: {
			type: 'object' as const,
			properties: {
				agentSlug: {
					type: 'string',
					description: 'Slug of the agent to update',
				},
				filename: {
					type: 'string',
					enum: ['SOUL.md', 'SKILLS.md', 'LEARNINGS.md', 'ERRORS.md'],
					description: 'Which file to write',
				},
				content: {
					type: 'string',
					description: 'Full file content (replaces existing)',
				},
			},
			required: ['agentSlug', 'filename', 'content'],
		},
	};
	const submitPlanTool = {
		name: 'submit_plan',
		description:
			'Submit an execution plan for user approval BEFORE executing any multi-step task (3+ steps). This is MANDATORY — you must NOT execute a plan until the user approves it. The plan will be shown to the user and you must wait for their approval or rejection.',
		parameters: {
			type: 'object' as const,
			properties: {
				description: {
					type: 'string',
					description: 'Brief summary of what this plan accomplishes',
				},
				steps: {
					type: 'array',
					items: { type: 'string' },
					description: 'Ordered list of steps to execute. Each should be a clear, actionable description.',
				},
			},
			required: ['description', 'steps'],
		},
	};

	const updatePlanTool = {
		name: 'update_plan',
		description:
			'Update the status of a plan step after executing it. Call this after each step completes (success or failure) to keep the plan up to date.',
		parameters: {
			type: 'object' as const,
			properties: {
				stepIndex: {
					type: 'number',
					description: 'Zero-based index of the step to update',
				},
				status: {
					type: 'string',
					enum: ['in_progress', 'completed', 'failed'],
					description: 'New status for the step',
				},
				error: {
					type: 'string',
					description: 'Error message if step failed',
				},
			},
			required: ['stepIndex', 'status'],
		},
	};

	const currentDepth = params.depth ?? 0;
	const tools = [
		...browserTools,
		saveMemoryTool,
		recallMemoryTool,
		// Exclude spawn/wait tools at depth >= 2 to prevent deep nesting
		...(currentDepth >= 2 ? [] : [spawnAgentTool, waitForAgentsTool]),
		saveToLocalTool,
		createAgentTool,
		updateAgentFilesTool,
		submitPlanTool,
		updatePlanTool,
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
	const allToolCalls: ToolCallRecord[] = [];

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

			// Context length exceeded — aggressively trim and retry once
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg.includes('context_length_exceeded') || errMsg.includes('token')) {
				console.warn(
					`[Orchestrator] Context length exceeded on iteration ${iterations}, trimming aggressively`,
				);
				// Keep only last 2 messages + strip all images
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
										return {
											...tr,
											content: tr.content.slice(0, 500) + '...',
										};
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
				continue; // Retry this iteration with trimmed messages
			}

			throw err;
		}

		console.log(
			`[Orchestrator] iter=${iterations} stream done: thinkingChunks=${thinkingChunks} textChunks=${textChunks} stopReason=${stopReason} contentBlocks=${content.map((b) => b.type).join(',')}`,
		);

		if (signal?.aborted) break;

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
						executeToolBlock(
							block,
							context,
							userId,
							connectionId,
							domain,
							onEvent,
							provider,
							domainMemory,
							userMemory,
							currentDepth,
							conversationId,
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
					domainMemory,
					userMemory,
					currentDepth,
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
					result: result ? (typeof result.content === 'string' ? (() => { try { return JSON.parse(result.content); } catch { return result.content; } })() : '[structured]') : null,
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
	agentConfig: AgentConfig;
}): Promise<string> {
	const provider = getProvider();
	const model = params.agentConfig.model === 'fast' ? getFastModel() : getStrongModel();
	const systemPrompt = buildSystemPrompt(
		params.pageIndex,
		params.selectedElements,
		params.domainMemory,
		params.userMemory,
		params.priorContext,
		params.agentConfig,
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
		if (['save_memory', 'recall_memory', 'spawn_agent', 'wait_for_agents', 'save_to_local', 'create_agent', 'update_agent_files'].includes(block.name)) {
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
	domainMemoryStr?: string,
	userMemoryStr?: string,
	depth?: number,
	conversationId?: string,
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
		const args = block.input as { task: string; targetUrl: string; agentSlug?: string; timeout?: number };
		try {
			// Load target agent config if slug specified
			let subAgentConfig: AgentConfig | undefined;
			if (args.agentSlug) {
				const loaded = await loadAgentBySlug(args.agentSlug, userId);
				if (loaded) subAgentConfig = loaded;
			}
			const result = await spawnSubAgent({
				userId,
				connectionId,
				task: args.task,
				targetUrl: args.targetUrl,
				domainMemory: domainMemoryStr,
				userMemory: userMemoryStr,
				domain,
				timeout: args.timeout,
				onEvent,
				signal: undefined,
				agentConfig: subAgentConfig,
				depth: (depth ?? 0) + 1,
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

	// save_to_local — persist files to ~/.commandra/
	if (block.name === 'save_to_local' && domain) {
		const args = block.input as { filename: string; content: string; category: 'exports' | 'context' };
		try {
			const saved = saveLocalFile(args.category, domain, args.filename, args.content);
			await onEvent({
				type: 'tool_start',
				toolName: 'save_to_local',
				label: args.filename,
				args: block.input,
			});
			await onEvent({
				type: 'tool_end',
				toolName: 'save_to_local',
				success: true,
				result: { success: true, path: saved.path, sizeBytes: saved.sizeBytes },
			});
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({
					success: true,
					message: `File saved to ~/.commandra/${saved.path}`,
					sizeBytes: saved.sizeBytes,
				}),
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

	// create_agent — create a new persistent agent from conversation context
	if (block.name === 'create_agent') {
		const args = block.input as { slug: string; name: string; description: string; soul: string; domains?: string[]; cron?: string };
		try {
			const agent = await createAgent(userId, {
				slug: args.slug,
				name: args.name,
				description: args.description,
				domains: args.domains,
				trigger: args.cron ? { cron: args.cron, enabled: true } : undefined,
			});
			// Write SOUL.md immediately
			await uploadAgentFile(userId, args.slug, 'SOUL.md', args.soul);
			await onEvent({
				type: 'tool_start',
				toolName: 'create_agent',
				label: `Created agent: ${args.name}`,
				args: block.input,
			});
			await onEvent({
				type: 'tool_end',
				toolName: 'create_agent',
				success: true,
				result: { success: true, agentId: agent.id, slug: agent.slug },
			});
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({
					success: true,
					agentId: agent.id,
					slug: agent.slug,
					message: `Agent "${args.name}" created with slug "${args.slug}". It has a SOUL.md. You can use update_agent_files to add SKILLS.md if needed.${args.cron ? ` Scheduled: ${args.cron}` : ''}${args.domains?.length ? ` Domains: ${args.domains.join(', ')}` : ''}`,
				}),
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

	// update_agent_files — write/update agent files (SOUL.md, SKILLS.md, etc.)
	if (block.name === 'update_agent_files') {
		const args = block.input as { agentSlug: string; filename: string; content: string };
		try {
			await uploadAgentFile(userId, args.agentSlug, args.filename, args.content);
			await onEvent({
				type: 'tool_start',
				toolName: 'update_agent_files',
				label: `${args.agentSlug}/${args.filename}`,
				args: block.input,
			});
			await onEvent({
				type: 'tool_end',
				toolName: 'update_agent_files',
				success: true,
				result: { success: true, file: args.filename },
			});
			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({ success: true, message: `Updated ${args.filename} for agent "${args.agentSlug}"` }),
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

	// submit_plan — save plan + send for approval (blocks until user responds)
	if (block.name === 'submit_plan' && conversationId) {
		const args = block.input as { description: string; steps: string[] };
		try {
			const plan: StoredPlan = {
				description: args.description,
				steps: args.steps.map((label) => ({ label, status: 'pending' as const })),
			};
			// Persist plan to storage
			await savePlan(userId, conversationId, plan);

			// Update conversation planStatus
			db.update(conversations)
				.set({
					planStatus: {
						totalSteps: plan.steps.length,
						completedSteps: 0,
						status: 'pending' as const,
					},
					updatedAt: new Date(),
				})
				.where(eq(conversations.id, conversationId))
				.catch(() => {});

			const planId = conversationId; // use convId as planId

			// Send plan to extension for approval (blocks here)
			const approval = await sendApprovalRequest(connectionId, {
				type: 'plan_approval',
				planId,
				description: args.description,
				steps: args.steps,
			});

			if (approval.approved) {
				// Mark plan as approved
				const approvedPlan: StoredPlan = {
					...plan,
					steps: plan.steps.map((s) => ({ ...s })),
				};
				await savePlan(userId, conversationId, approvedPlan);
				db.update(conversations)
					.set({
						planStatus: {
							totalSteps: plan.steps.length,
							completedSteps: 0,
							status: 'approved' as const,
						},
						updatedAt: new Date(),
					})
					.where(eq(conversations.id, conversationId))
					.catch(() => {});

				await onEvent({
					type: 'plan_approved',
					planId,
				});

				return {
					type: 'tool_result',
					toolUseId: block.id,
					content: JSON.stringify({
						success: true,
						approved: true,
						message: 'Plan approved by user. Proceed with execution. Call update_plan with stepIndex and status as you complete each step.',
					}),
					isError: false,
				};
			} else {
				await onEvent({
					type: 'plan_rejected',
					planId,
					reason: approval.reason,
				});
				return {
					type: 'tool_result',
					toolUseId: block.id,
					content: JSON.stringify({
						success: true,
						approved: false,
						reason: approval.reason || 'User rejected the plan',
						message: 'Plan rejected. Ask the user what they would like to change.',
					}),
					isError: false,
				};
			}
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

	// update_plan — mark step status + persist
	if (block.name === 'update_plan' && conversationId) {
		const args = block.input as { stepIndex: number; status: 'in_progress' | 'completed' | 'failed'; error?: string };
		try {
			const updated = await updatePlanStep(
				userId,
				conversationId,
				args.stepIndex,
				args.status,
				args.error,
			);

			if (!updated) {
				return {
					type: 'tool_result',
					toolUseId: block.id,
					content: JSON.stringify({ success: false, error: 'Plan not found or invalid step index' }),
					isError: true,
				};
			}

			const completedSteps = updated.steps.filter((s) => s.status === 'completed').length;
			const failedSteps = updated.steps.filter((s) => s.status === 'failed').length;
			const allDone = completedSteps + failedSteps === updated.steps.length;

			// Update conversation planStatus
			db.update(conversations)
				.set({
					planStatus: {
						totalSteps: updated.steps.length,
						completedSteps,
						status: allDone
							? failedSteps > 0
								? ('failed' as const)
								: ('completed' as const)
							: ('in_progress' as const),
					},
					updatedAt: new Date(),
				})
				.where(eq(conversations.id, conversationId))
				.catch(() => {});

			// Emit SSE event
			await onEvent({
				type: 'plan_step_updated',
				planId: conversationId,
				stepIndex: args.stepIndex,
				status: args.status,
				error: args.error,
			});

			return {
				type: 'tool_result',
				toolUseId: block.id,
				content: JSON.stringify({
					success: true,
					completedSteps,
					totalSteps: updated.steps.length,
					allDone,
				}),
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
		// Save full screenshot to disk for potential later use
		const saved = saveScreenshot(image as string);
		console.log(
			`[Orchestrator] Screenshot saved: ${saved.id} (${Math.round(saved.sizeBytes / 1024)}KB)`,
		);
		// Also persist to ~/.commandra/screenshots/ for long-term storage
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

// Rough token estimate: ~4 chars per token for English text, base64 images are ~3 chars per token
const MAX_INPUT_TOKENS = 200_000;
const CHARS_PER_TOKEN = 4;

/**
 * Estimate total character count across all messages (including content blocks).
 */
function estimateMessageChars(messages: Message[]): number {
	let total = 0;
	for (const m of messages) {
		if (typeof m.content === 'string') {
			total += m.content.length;
		} else if (Array.isArray(m.content)) {
			for (const block of m.content) {
				if (block.type === 'text') total += (block as TextBlock).text.length;
				else if (block.type === 'image') total += (block as ImageBlock).data.length;
				else if (block.type === 'tool_result') {
					const tr = block as ToolResultBlock;
					if (typeof tr.content === 'string') total += tr.content.length;
					else if (Array.isArray(tr.content)) {
						for (const sub of tr.content) {
							if (sub.type === 'text') total += sub.text.length;
							else if (sub.type === 'image') total += sub.data.length;
						}
					}
				} else if (block.type === 'tool_use') {
					total += JSON.stringify((block as ToolUseBlock).input).length;
				} else if (block.type === 'thinking') {
					total += ((block as ThinkingContentBlock).thinking || '').length;
				}
			}
		}
	}
	return total;
}

/**
 * Trim messages to stay within token budget.
 * Strategy:
 * 1. Strip base64 image data from all but the most recent screenshot
 * 2. If still over budget, summarize old tool results to just success/error
 * 3. If still over budget, drop the oldest message pairs
 */
function trimMessagesForTokenBudget(messages: Message[]): Message[] {
	const maxChars = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;
	let result = [...messages];

	// Phase 1: Strip old screenshots — keep only the last image block
	let lastImageIdx = -1;
	for (let i = result.length - 1; i >= 0; i--) {
		const content = result[i].content;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === 'image') {
					lastImageIdx = i;
					break;
				}
				if (block.type === 'tool_result') {
					const tr = block as ToolResultBlock;
					if (Array.isArray(tr.content)) {
						for (const sub of tr.content) {
							if (sub.type === 'image') {
								lastImageIdx = i;
								break;
							}
						}
					}
				}
			}
			if (lastImageIdx >= 0) break;
		}
	}

	// Replace older image blocks with a placeholder
	result = result.map((m, idx) => {
		if (idx >= lastImageIdx || !Array.isArray(m.content)) return m;
		const cleaned = (m.content as ContentBlock[]).map((block) => {
			if (block.type === 'image') {
				return { type: 'text' as const, text: '[screenshot removed to save context]' };
			}
			if (block.type === 'tool_result') {
				const tr = block as ToolResultBlock;
				if (Array.isArray(tr.content)) {
					const hasImage = tr.content.some((sub) => sub.type === 'image');
					if (hasImage) {
						return {
							...tr,
							content: tr.content.map((sub) =>
								sub.type === 'image'
									? { type: 'text' as const, text: '[screenshot removed]' }
									: sub,
							),
						} as ToolResultBlock;
					}
				}
			}
			return block;
		});
		return { ...m, content: cleaned };
	});

	// Phase 2: If still over budget, truncate long tool result strings
	if (estimateMessageChars(result) > maxChars) {
		result = result.map((m) => {
			if (!Array.isArray(m.content)) return m;
			const cleaned = (m.content as ContentBlock[]).map((block) => {
				if (block.type === 'tool_result') {
					const tr = block as ToolResultBlock;
					if (typeof tr.content === 'string' && tr.content.length > 2000) {
						return { ...tr, content: tr.content.slice(0, 2000) + '...[truncated]' };
					}
				}
				return block;
			});
			return { ...m, content: cleaned };
		});
	}

	// Phase 3: If still over budget, drop oldest assistant+user pairs (keep first + last 4)
	if (estimateMessageChars(result) > maxChars && result.length > 6) {
		const keep = 4; // Keep last N messages
		const trimmed = [result[0], ...result.slice(-keep)];
		console.log(
			`[Orchestrator] Token budget exceeded, dropped ${result.length - trimmed.length} messages`,
		);
		result = trimmed;
	}

	return result;
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
		// Only auto-refresh if the action actually succeeded
		const STATE_CHANGING_TOOLS = ['click_element', 'navigate', 'type_text', 'select_option'];
		let pageStateUpdate: unknown = undefined;
		if (toolSucceeded && STATE_CHANGING_TOOLS.includes(name)) {
			try {
				// Wait for SPA transitions / DOM updates — longer for click/navigate (modals, page loads)
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
		// Format elements clearly so the LLM knows exactly which selectors to use
		let enrichedResult: unknown = result;
		if (pageStateUpdate && resultData?.success) {
			const ps = pageStateUpdate as { elements?: { type: string; label: string; selector: string; inOverlay?: boolean }[]; url?: string; title?: string };
			if (ps.elements) {
				// Surface overlay/modal elements first (compose windows, dialogs, etc.)
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
