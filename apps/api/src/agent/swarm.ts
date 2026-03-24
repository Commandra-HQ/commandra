/**
 * Multi-agent swarm — parallel sub-agents for cross-tab/cross-page workflows.
 *
 * Architecture:
 *   Coordinator (strong model, main tab)
 *     ├── Sub-Agent 1 (fast model, background tab) → task A
 *     ├── Sub-Agent 2 (fast model, background tab) → task B
 *     └── Sub-Agent 3 (fast model, background tab) → task C
 *
 * Each sub-agent gets its own browser tab via the extension:
 * 1. Backend sends `open_tab` action → extension creates background tab → returns tabId
 * 2. All tool calls include `tabId` so the extension targets the right tab
 * 3. On completion, backend sends `close_tab` → extension removes the tab
 */

import { randomUUID } from 'node:crypto';
import type { AgentConfig, SSEEvent } from '@afe/shared';
import { getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import type { ContentBlock, Message, ToolResultBlock, ToolUseBlock } from '../llm/types.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { writeScratchpad, readScratchpad } from '../storage/scratchpad.js';
import { isKilled, sendActionRequest, sendApprovalRequest } from '../ws/handler.js';
import { analyzeAndImprove, recordAgentRun } from './self-improve.js';
import type { ToolCallRecord } from './orchestrator.js';

// Defaults — overrideable per agent via agentConfig.limits
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_SUBAGENT_TIMEOUT = 120_000; // 2 minutes

interface SubAgent {
	id: string;
	task: string;
	targetUrl: string;
	tabId?: number;
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

const activeSubAgents = new Map<string, Map<string, SubAgent>>();

function getUserSubAgents(userId: string): Map<string, SubAgent> {
	if (!activeSubAgents.has(userId)) {
		activeSubAgents.set(userId, new Map());
	}
	return activeSubAgents.get(userId)!;
}

/**
 * Spawn a sub-agent to perform a task in a new browser tab.
 * Opens a background tab via the extension, then runs an orchestrator loop on it.
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
	agentConfig?: AgentConfig;
	depth?: number;
	keepTab?: boolean;
	conversationId?: string;
}): Promise<{ agentId: string; error?: string }> {
	const { userId, connectionId, task, targetUrl, onEvent } = params;
	const timeout = params.timeout ?? DEFAULT_SUBAGENT_TIMEOUT;
	const userAgents = getUserSubAgents(userId);

	const runningCount = [...userAgents.values()].filter((a) => a.status === 'running').length;
	if (runningCount >= DEFAULT_MAX_CONCURRENT) {
		return {
			agentId: '',
			error: `Maximum ${DEFAULT_MAX_CONCURRENT} concurrent sub-agents. Wait for existing agents to complete.`,
		};
	}

	// Open a background tab in the extension
	let tabId: number | undefined;
	try {
		const agentId = randomUUID();
		const tabResult = (await sendActionRequest(
			connectionId,
			'open_tab',
			{
				action: 'open_tab',
				url: targetUrl,
				agentId,
			},
			20000,
		)) as { success?: boolean; data?: { tabId?: number }; error?: string } | null;

		if (!tabResult?.success || !tabResult.data?.tabId) {
			return {
				agentId: '',
				error: `Failed to open background tab: ${tabResult?.error || 'No tab ID returned'}`,
			};
		}
		tabId = tabResult.data.tabId;

		const subAgent: SubAgent = {
			id: agentId,
			task,
			targetUrl,
			tabId,
			status: 'running',
			startedAt: Date.now(),
		};
		userAgents.set(agentId, subAgent);

		await onEvent({ type: 'sub_agent_start', agentId, task, targetUrl });

		// Run in background
		runSubAgent({ ...params, agentId, tabId, timeout, onEvent }).catch((err) => {
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
	} catch (err) {
		// Clean up tab if we managed to open one
		if (tabId) {
			sendActionRequest(connectionId, 'close_tab', { action: 'close_tab', tabId }, 5000).catch(
				() => {},
			);
		}
		return {
			agentId: '',
			error: `Failed to spawn sub-agent: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
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

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// Timeout remaining
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

	// Cleanup
	for (const id of agentIds) {
		userAgents.delete(id);
	}

	return results;
}

// --- Internal: run sub-agent orchestrator loop in a dedicated tab ---

async function runSubAgent(params: {
	agentId: string;
	userId: string;
	connectionId: string;
	task: string;
	targetUrl: string;
	tabId: number;
	domainMemory?: string;
	userMemory?: string;
	domain?: string;
	timeout: number;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
	agentConfig?: AgentConfig;
	depth?: number;
	keepTab?: boolean;
}): Promise<void> {
	const {
		agentId,
		userId,
		connectionId,
		task,
		targetUrl,
		tabId,
		domainMemory,
		userMemory,
		timeout,
		onEvent,
		signal,
		agentConfig,
	} = params;
	const currentDepth = params.depth ?? 0;

	const userAgents = getUserSubAgents(userId);
	const subAgent = userAgents.get(agentId);
	if (!subAgent) return;

	const provider = getProvider();
	// Use agent's model preference, fallback to strong model
	const model = agentConfig?.model === 'fast' ? getFastModel() : getStrongModel();
	// Use agent's tool allowlist if specified — respects per-agent restrictions
	const browserTools = getToolDefinitions(agentConfig?.tools);
	// Sub-agents get scratchpad tools for inter-agent data passing
	const scratchpadTools = [
		{
			name: 'write_scratchpad',
			description: 'Write data to the shared scratchpad for other agents to read.',
			parameters: {
				type: 'object' as const,
				properties: {
					key: { type: 'string', description: 'Key name for this data' },
					data: { type: 'string', description: 'The data to store (JSON or text)' },
				},
				required: ['key', 'data'],
			},
		},
		{
			name: 'read_scratchpad',
			description: 'Read data from the shared scratchpad written by another agent.',
			parameters: {
				type: 'object' as const,
				properties: {
					key: { type: 'string', description: 'Key name of the data to read' },
				},
				required: ['key'],
			},
		},
	];
	const tools = [...browserTools, ...scratchpadTools];
	const context = { connectionId, userId };
	const actionsPerformed: string[] = [];

	// Wait a moment for the tab to finish loading + get indexed
	await new Promise((resolve) => setTimeout(resolve, 3000));

	// Get initial page state so the sub-agent knows what's on the page
	let initialPageState = '';
	try {
		const pageResult = (await executeTool('get_page_state', { tabId }, context)) as {
			success?: boolean;
			data?: {
				elements?: { type: string; label: string; selector: string }[];
				url?: string;
				title?: string;
			};
		};
		if (pageResult?.success && pageResult.data?.elements) {
			const elements = pageResult.data.elements;
			const grouped: Record<string, string[]> = {};
			for (const el of elements) {
				if (!grouped[el.type]) grouped[el.type] = [];
				grouped[el.type].push(`"${el.label}" [${el.selector}]`);
			}
			const lines: string[] = [
				`Page: ${pageResult.data.title || targetUrl}`,
				`URL: ${pageResult.data.url || targetUrl}`,
				'',
			];
			for (const [type, els] of Object.entries(grouped)) {
				lines.push(`${type}s (${els.length}):`);
				for (const el of els.slice(0, 20)) {
					lines.push(`  - ${el}`);
				}
				if (els.length > 20) lines.push(`  - ...and ${els.length - 20} more`);
			}
			initialPageState = lines.join('\n');
			actionsPerformed.push('get_page_state: loaded initial page');
		}
	} catch {
		// Page state fetch failed — sub-agent will have to call it manually
	}

	const systemPrompt = buildSubAgentPrompt(
		task,
		targetUrl,
		domainMemory,
		userMemory,
		initialPageState,
		agentConfig,
		currentDepth,
	);

	let currentMessages: Message[] = [
		{
			role: 'user',
			content: initialPageState
				? `Execute this task: ${task}\n\nThe page is loaded and you can see the elements above. Start working.`
				: `Execute this task: ${task}\n\nThe page is at ${targetUrl}. Use get_page_state first to see what's on the page, then complete the task.`,
		},
	];

	let fullResponse = '';
	let iterations = 0;

	const timeoutController = new AbortController();
	const timer = setTimeout(() => timeoutController.abort(), timeout);
	const combinedSignal = signal
		? AbortSignal.any([signal, timeoutController.signal])
		: timeoutController.signal;

	try {
		const maxIter = agentConfig?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		while (iterations < maxIter) {
			if (isKilled(connectionId) || combinedSignal.aborted) break;

			iterations++;
			console.log(`[Swarm] Sub-agent ${agentId} (tab ${tabId}) iteration ${iterations}`);

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
						if (content.length > 0 && content[content.length - 1].type === 'thinking') {
							(content[content.length - 1] as { thinking: string }).thinking += event.text;
						} else {
							content.push({ type: 'thinking', thinking: event.text });
						}
						break;
					case 'thinking_signature': {
						const last = [...content].reverse().find((b) => b.type === 'thinking');
						if (last) (last as { signature?: string }).signature = event.signature;
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
						content.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
						break;
					case 'message_end':
						stopReason = event.stopReason;
						break;
				}
			}

			if (combinedSignal.aborted) break;

			const toolBlocks = content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
			const toolResults: ToolResultBlock[] = [];
			let hasToolUse = false;

			for (const block of toolBlocks) {
				if (combinedSignal.aborted) break;
				hasToolUse = true;

				const elementLabel =
					(block.input.description as string) || (block.input.selector as string) || '';

				const classification = classifyAction({
					toolName: block.name,
					args: block.input,
					elementLabel,
				});

				if (classification.level === 'blocked') {
					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify({ success: false, error: `Blocked: ${classification.reason}` }),
						isError: true,
					});
					continue;
				}

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
								content: JSON.stringify({ success: false, error: 'User rejected' }),
								isError: true,
							});
							continue;
						}
					} catch {
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({ success: false, error: 'Approval failed' }),
							isError: true,
						});
						continue;
					}
				}

				// Handle internal tools (scratchpad) — these don't go through the browser tool registry
				if (block.name === 'write_scratchpad' || block.name === 'read_scratchpad') {
					try {
						const convId = params.conversationId || agentId; // conversation-scoped to prevent cross-conversation collisions
						if (block.name === 'write_scratchpad') {
							const args = block.input as { key: string; data: string };
							let parsed: unknown;
							try { parsed = JSON.parse(args.data); } catch { parsed = args.data; }
							await writeScratchpad(userId, convId, args.key, parsed);
							toolResults.push({
								type: 'tool_result',
								toolUseId: block.id,
								content: JSON.stringify({ success: true, message: `Wrote "${args.key}" to scratchpad` }),
								isError: false,
							});
						} else {
							const args = block.input as { key: string };
							const data = await readScratchpad(userId, convId, args.key);
							toolResults.push({
								type: 'tool_result',
								toolUseId: block.id,
								content: JSON.stringify({ success: true, exists: data !== null, data: data ?? '(not found)' }),
								isError: false,
							});
						}
						actionsPerformed.push(`${block.name}: ${(block.input as { key: string }).key}`);
					} catch (err) {
						toolResults.push({
							type: 'tool_result',
							toolUseId: block.id,
							content: JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
							isError: true,
						});
					}
					continue;
				}

				// Execute browser tool — inject tabId so the extension targets the sub-agent's tab
				try {
					const argsWithTab = { ...block.input, tabId };
					const result = await executeTool(block.name, argsWithTab, context);
					actionsPerformed.push(
						`${block.name}: ${elementLabel || JSON.stringify(block.input).slice(0, 80)}`,
					);

					await logAction({
						userId,
						action: block.name,
						safetyLevel: classification.level,
						approved: true,
						metadata: { args: block.input, result, subAgentId: agentId, tabId },
					});

					// Extract screenshot for frontend if present
					const resultData = result as unknown as Record<string, unknown> | undefined;
					const screenshotImage =
						block.name === 'screenshot' && resultData?.success
							? ((resultData.data as Record<string, unknown>)?.image as string | undefined)
							: undefined;

					// Emit rich sub_agent_action with full tool data — rendered inside the sub-agent accordion
					await onEvent({
						type: 'sub_agent_action',
						agentId,
						toolName: block.name,
						label: elementLabel,
						success: true,
						args: block.input as Record<string, unknown>,
						result: screenshotImage ? { success: true } : result,
						screenshot: screenshotImage,
					});

					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify(result),
						isError: false,
					});

					// Auto-refresh page state after state-changing actions (mirrors main orchestrator)
					const STATE_CHANGING = ['click_element', 'navigate', 'type_text', 'select_option'];
					if (STATE_CHANGING.includes(block.name)) {
						try {
							const delay = block.name === 'click_element' || block.name === 'navigate' ? 2000 : 500;
							await new Promise((resolve) => setTimeout(resolve, delay));
							const freshState = await executeTool('get_page_state', { tabId }, context);
							const freshData = freshState as Record<string, unknown>;
							if (freshData?.success && freshData.data) {
								// Append refreshed page state to the last tool result
								const lastResult = toolResults[toolResults.length - 1];
								if (lastResult && typeof lastResult.content === 'string') {
									try {
										const parsed = JSON.parse(lastResult.content);
										parsed.pageState = freshData.data;
										lastResult.content = JSON.stringify(parsed);
									} catch { /* non-critical */ }
								}
							}
						} catch { /* non-critical — sub-agent can call refresh_page_state manually */ }
					}
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					actionsPerformed.push(`${block.name}: FAILED - ${errorMsg}`);

					await onEvent({
						type: 'sub_agent_action',
						agentId,
						toolName: block.name,
						label: elementLabel,
						success: false,
						args: block.input as Record<string, unknown>,
						error: errorMsg,
					});

					toolResults.push({
						type: 'tool_result',
						toolUseId: block.id,
						content: JSON.stringify({ success: false, error: errorMsg }),
						isError: true,
					});
				}
			}

			if (!hasToolUse || stopReason === 'end_turn') break;

			currentMessages = [
				...currentMessages,
				{ role: 'assistant', content },
				{ role: 'user', content: toolResults },
			];
		}

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
		// Close tab on success, keep open on failure for debugging
		if (subAgent.status === 'completed' && tabId && !params.keepTab) {
			sendActionRequest(params.connectionId, 'close_tab', { action: 'close_tab', tabId }, 5000).catch(
				() => {},
			);
		}
	}

	// Record run + self-improvement for non-coordinator agents
	if (agentConfig && agentConfig.id !== '_coordinator') {
		recordAgentRun({
			agentId: agentConfig.id,
			userId,
			status: subAgent.status === 'completed' ? 'completed' : 'failed',
			toolCalls: actionsPerformed.length,
			durationMs: Date.now() - subAgent.startedAt,
			error: subAgent.result?.error,
		}).catch((err) => console.warn('[Swarm] recordAgentRun failed:', err));

		// Self-improvement: extract learnings from sub-agent run
		const transcript = currentMessages
			.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : '[tool data]'}`)
			.join('\n\n');
		const toolCallRecords: ToolCallRecord[] = actionsPerformed.map((a) => {
			const [name, ...rest] = a.split(': ');
			const detail = rest.join(': ');
			return {
				name,
				args: {},
				result: {},
				success: !detail.includes('FAILED'),
			};
		});
		analyzeAndImprove({
			userId,
			agentConfig,
			toolCalls: toolCallRecords,
			transcript,
			duration: Date.now() - subAgent.startedAt,
			domain: params.domain,
			conversationId: params.conversationId,
		}).catch((err) => console.warn('[Swarm] analyzeAndImprove failed:', err));
	}

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
	initialPageState?: string,
	agentConfig?: AgentConfig,
	depth?: number,
): string {
	// Use agent's SOUL.md as identity if available
	const identity = agentConfig?.soul
		? agentConfig.soul
		: `You are a sub-agent performing a specific task in your own browser tab. You have the same browser tools as the main agent: click_element, type_text, select_option, navigate, scroll, screenshot, get_page_state, refresh_page_state, read_text, read_table, wait_for_element, go_back.`;

	let prompt = `${identity}

Your task: ${task}
Your tab URL: ${targetUrl}

${initialPageState ? `## Current Page Elements\n${initialPageState}` : 'Use get_page_state to see the current page elements.'}

Instructions:
- Reference elements by their label and use the provided selectors
- If a selector doesn't work, use refresh_page_state to re-index the page (SPAs change DOM dynamically)
- After clicking something that changes the page (navigation, modal, compose window), use refresh_page_state before trying to interact with new elements
- For Gmail: after clicking Compose, wait 2 seconds then refresh_page_state to see the compose form fields
- For GitHub: click on folder/file links directly using their selectors
- Be thorough — complete ALL parts of the task
- Do NOT ask for clarification — work with what you have
${(depth ?? 0) >= 2 ? '- Do NOT try to spawn sub-agents' : ''}

After completing the task, provide a clear summary of:
1. What you did (actions taken)
2. What you found (data extracted, results observed)
3. Whether the task was successful`;

	if (agentConfig?.skills) {
		prompt += `\n\n## Agent Skills\n${agentConfig.skills}`;
	}
	if (agentConfig?.learnings) {
		const lines = agentConfig.learnings.split('\n').filter((l) => l.trim().startsWith('- '));
		if (lines.length > 0) {
			prompt += `\n\n## Past Learnings\n${lines.slice(-20).join('\n')}`;
		}
	}
	if (agentConfig?.errors) {
		const lines = agentConfig.errors.split('\n').filter((l) => l.trim().startsWith('- '));
		if (lines.length > 0) {
			prompt += `\n\n## Known Failure Patterns\n${lines.slice(-10).join('\n')}`;
		}
	}
	if (domainMemory) {
		prompt += `\n\n## App Knowledge\n${domainMemory}`;
	}
	if (userMemory) {
		prompt += `\n\n## User Context\n${userMemory}`;
	}

	return prompt;
}
