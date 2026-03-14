/**
 * Multi-agent swarm — parallel sub-agents for cross-tab/cross-page workflows.
 *
 * Architecture:
 *   Coordinator (strong model, main tab)
 *     ├── Sub-Agent 1 (fast model, background tab) → task A
 *     ├── Sub-Agent 2 (fast model, background tab) → task B
 *     └── Sub-Agent 3 (fast model, background tab) → task C
 *
 * Sub-agents:
 * - Use the fast model (cost/speed optimization)
 * - Max 5 iterations (sub-tasks should be small)
 * - Share domain memory (read-only) and user memory (read-only)
 * - Have their own isolated conversation context
 * - Cannot spawn further sub-agents (no recursion)
 * - Execute in the same browser via the extension (background tabs)
 */

import { randomUUID } from 'node:crypto';
import type { SSEEvent } from '@afe/shared';
import { getFastModel, getProvider } from '../llm/index.js';
import type {
	ContentBlock,
	Message,
	TextBlock,
	ToolResultBlock,
	ToolUseBlock,
} from '../llm/types.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';

const MAX_CONCURRENT_SUBAGENTS = 3;
const MAX_SUBAGENT_ITERATIONS = 5;
const DEFAULT_SUBAGENT_TIMEOUT = 60_000; // 60 seconds

/** Active sub-agent tracking */
interface SubAgent {
	id: string;
	task: string;
	targetUrl: string;
	status: 'running' | 'completed' | 'failed' | 'timeout';
	result?: SubAgentResult;
	startedAt: number;
}

export interface SubAgentResult {
	success: boolean;
	data?: unknown;
	summary: string;
	actionsPerformed: string[];
	error?: string;
}

// Track active sub-agents per user to enforce concurrency limits
const activeSubAgents = new Map<string, Map<string, SubAgent>>();

function getUserSubAgents(userId: string): Map<string, SubAgent> {
	if (!activeSubAgents.has(userId)) {
		activeSubAgents.set(userId, new Map());
	}
	return activeSubAgents.get(userId)!;
}

/**
 * Spawn a sub-agent to perform a task. Returns immediately with an agent ID.
 * The sub-agent runs in the background and results can be collected via waitForAgents.
 */
export async function spawnSubAgent(params: {
	userId: string;
	connectionId: string;
	task: string;
	targetUrl: string;
	domainMemory?: string;
	userMemory?: string;
	domain?: string;
	timeout?: number;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
}): Promise<{ agentId: string; error?: string }> {
	const {
		userId,
		connectionId,
		task,
		targetUrl,
		domainMemory,
		userMemory,
		domain,
		onEvent,
		signal,
	} = params;
	const timeout = params.timeout ?? DEFAULT_SUBAGENT_TIMEOUT;
	const userAgents = getUserSubAgents(userId);

	// Enforce concurrency limit
	const runningCount = [...userAgents.values()].filter((a) => a.status === 'running').length;
	if (runningCount >= MAX_CONCURRENT_SUBAGENTS) {
		return {
			agentId: '',
			error: `Maximum ${MAX_CONCURRENT_SUBAGENTS} concurrent sub-agents reached. Wait for existing agents to complete.`,
		};
	}

	const agentId = randomUUID();
	const subAgent: SubAgent = {
		id: agentId,
		task,
		targetUrl,
		status: 'running',
		startedAt: Date.now(),
	};
	userAgents.set(agentId, subAgent);

	// Emit sub-agent start event
	await onEvent({
		type: 'sub_agent_start',
		agentId,
		task,
		targetUrl,
	});

	// Run sub-agent in background (don't await)
	runSubAgent({
		agentId,
		userId,
		connectionId,
		task,
		targetUrl,
		domainMemory,
		userMemory,
		domain,
		timeout,
		onEvent,
		signal,
	}).catch((err) => {
		console.error(`[Swarm] Sub-agent ${agentId} failed:`, err);
		subAgent.status = 'failed';
		subAgent.result = {
			success: false,
			summary: 'Sub-agent failed unexpectedly',
			actionsPerformed: [],
			error: err instanceof Error ? err.message : String(err),
		};
	});

	return { agentId };
}

/**
 * Wait for specific sub-agents to complete. Returns all results.
 */
export async function waitForAgents(
	userId: string,
	agentIds: string[],
	timeoutMs = 90_000,
): Promise<Record<string, SubAgentResult>> {
	const userAgents = getUserSubAgents(userId);
	const deadline = Date.now() + timeoutMs;
	const results: Record<string, SubAgentResult> = {};

	while (Date.now() < deadline) {
		let allDone = true;

		for (const id of agentIds) {
			const agent = userAgents.get(id);
			if (!agent) {
				results[id] = {
					success: false,
					summary: 'Agent not found',
					actionsPerformed: [],
					error: `No sub-agent with ID ${id}`,
				};
				continue;
			}

			if (agent.status === 'running') {
				allDone = false;
			} else if (agent.result) {
				results[id] = agent.result;
			}
		}

		if (allDone || Object.keys(results).length === agentIds.length) {
			break;
		}

		// Poll every 500ms
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// Timeout remaining agents
	for (const id of agentIds) {
		if (!results[id]) {
			const agent = userAgents.get(id);
			if (agent && agent.status === 'running') {
				agent.status = 'timeout';
				agent.result = {
					success: false,
					summary: 'Sub-agent timed out',
					actionsPerformed: [],
					error: `Timed out after ${timeoutMs}ms`,
				};
			}
			results[id] = agent?.result ?? {
				success: false,
				summary: 'Agent not found',
				actionsPerformed: [],
			};
		}
	}

	// Cleanup completed agents
	for (const id of agentIds) {
		userAgents.delete(id);
	}

	return results;
}

// --- Internal: run a sub-agent orchestrator loop ---

async function runSubAgent(params: {
	agentId: string;
	userId: string;
	connectionId: string;
	task: string;
	targetUrl: string;
	domainMemory?: string;
	userMemory?: string;
	domain?: string;
	timeout: number;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
}): Promise<void> {
	const {
		agentId,
		userId,
		connectionId,
		task,
		targetUrl,
		domainMemory,
		userMemory,
		timeout,
		onEvent,
		signal,
	} = params;

	const userAgents = getUserSubAgents(userId);
	const subAgent = userAgents.get(agentId);
	if (!subAgent) return;

	const provider = getProvider();
	const model = getFastModel(); // Sub-agents use fast model
	const tools = getToolDefinitions(); // Browser tools only, no save_memory/recall_memory/spawn_agent
	const context = { connectionId, userId };
	const actionsPerformed: string[] = [];

	const systemPrompt = buildSubAgentPrompt(task, targetUrl, domainMemory, userMemory);

	let currentMessages: Message[] = [
		{
			role: 'user',
			content: `Execute this task: ${task}\n\nStart by navigating to ${targetUrl} and then complete the task.`,
		},
	];

	let fullResponse = '';
	let iterations = 0;

	// Set up timeout
	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(), timeout);
	const combinedSignal = signal
		? AbortSignal.any([signal, timeoutController.signal])
		: timeoutController.signal;

	try {
		while (iterations < MAX_SUBAGENT_ITERATIONS) {
			if (isKilled(connectionId) || combinedSignal.aborted) {
				break;
			}

			iterations++;
			console.log(`[Swarm] Sub-agent ${agentId} iteration ${iterations}`);

			const streamIter = provider.chat({
				model,
				system: systemPrompt,
				messages: currentMessages,
				tools,
				maxTokens: 4000,
				signal: combinedSignal,
				thinking: { budgetTokens: 2000 },
			});

			const content: ContentBlock[] = [];
			let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

			for await (const event of streamIter) {
				if (combinedSignal.aborted) break;

				switch (event.type) {
					case 'thinking_delta':
						// Sub-agents don't stream thinking to client
						if (content.length > 0 && content[content.length - 1].type === 'thinking') {
							(content[content.length - 1] as { thinking: string }).thinking += event.text;
						} else {
							content.push({ type: 'thinking', thinking: event.text });
						}
						break;
					case 'thinking_signature': {
						const lastThinking = [...content].reverse().find((b) => b.type === 'thinking');
						if (lastThinking) (lastThinking as { signature?: string }).signature = event.signature;
						break;
					}
					case 'text':
						fullResponse += event.text;
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

			if (combinedSignal.aborted) break;

			// Process tool calls
			const toolBlocks = content.filter(
				(block): block is ToolUseBlock => block.type === 'tool_use',
			);
			const toolResults: ToolResultBlock[] = [];
			let hasToolUse = false;

			for (const block of toolBlocks) {
				if (combinedSignal.aborted) break;
				hasToolUse = true;

				const elementLabel =
					(block.input.description as string) || (block.input.selector as string) || '';

				// Sub-agents still go through safety classification
				const classification = classifyAction({
					toolName: block.name,
					args: block.input,
					elementLabel,
				});

				if (classification.level === 'blocked') {
					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify({
							success: false,
							error: `Blocked: ${classification.reason}`,
						}),
						isError: true,
					});
					continue;
				}

				// Review tools in sub-agents still need user approval
				if (classification.level === 'review') {
					try {
						const approval = await sendApprovalRequest(connectionId, {
							action: block.name,
							selector: block.input.selector as string,
							label: `[Sub-agent] ${elementLabel}`,
							reason: classification.reason,
						});
						if (!approval.approved) {
							toolResults.push({
								type: 'tool_result',
								toolUseId: block.id,
								content: JSON.stringify({
									success: false,
									error: 'User rejected this action',
								}),
								isError: true,
							});
							continue;
						}
					} catch {
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({
								success: false,
								error: 'Could not get user approval',
							}),
							isError: true,
						});
						continue;
					}
				}

				// Execute
				try {
					const result = await executeTool(block.name, block.input, context);
					actionsPerformed.push(
						`${block.name}: ${elementLabel || JSON.stringify(block.input).slice(0, 80)}`,
					);

					await logAction({
						userId,
						action: block.name,
						safetyLevel: classification.level,
						approved: true,
						metadata: { args: block.input, result, subAgentId: agentId },
					});

					// Emit sub-agent progress
					await onEvent({
						type: 'sub_agent_action',
						agentId,
						toolName: block.name,
						label: elementLabel,
						success: true,
					});

					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify(result),
						isError: false,
					});
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					actionsPerformed.push(`${block.name}: FAILED - ${errorMsg}`);
					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify({ success: false, error: errorMsg }),
						isError: true,
					});
				}
			}

			if (!hasToolUse || stopReason === 'end_turn') {
				break;
			}

			currentMessages = [
				...currentMessages,
				{ role: 'assistant', content },
				{ role: 'user', content: toolResults },
			];
		}

		// Sub-agent completed
		subAgent.status = 'completed';
		subAgent.result = {
			success: true,
			summary: fullResponse || 'Task completed',
			actionsPerformed,
			data: fullResponse,
		};
	} catch (err) {
		if (combinedSignal.aborted) {
			subAgent.status = 'timeout';
			subAgent.result = {
				success: false,
				summary: 'Sub-agent timed out or was cancelled',
				actionsPerformed,
				error: 'Timeout or cancellation',
			};
		} else {
			subAgent.status = 'failed';
			subAgent.result = {
				success: false,
				summary: 'Sub-agent failed',
				actionsPerformed,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	} finally {
		clearTimeout(timer);
	}

	// Emit completion event
	await onEvent({
		type: 'sub_agent_end',
		agentId,
		success: subAgent.status === 'completed',
		summary: subAgent.result?.summary ?? '',
		actionsPerformed,
	});
}

function buildSubAgentPrompt(
	task: string,
	targetUrl: string,
	domainMemory?: string,
	userMemory?: string,
): string {
	let prompt = `You are a sub-agent performing a specific task within a larger workflow. You work quickly and efficiently.

Your task: ${task}
Target URL: ${targetUrl}

Instructions:
- Navigate to the target URL first using the navigate tool
- Complete the assigned task using browser tools
- Be concise and efficient — minimize the number of actions
- Report your findings clearly in your final text response
- If you encounter an error, describe what went wrong
- Do NOT ask for clarification — work with what you have
- Do NOT spawn sub-agents — you cannot delegate further

After completing the task, provide a clear summary of:
1. What you did (actions taken)
2. What you found (data extracted, results observed)
3. Whether the task was successful`;

	if (domainMemory) {
		prompt += `\n\n## App Knowledge\n${domainMemory}`;
	}
	if (userMemory) {
		prompt += `\n\n## User Context\n${userMemory}`;
	}

	return prompt;
}
