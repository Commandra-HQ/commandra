/**
 * Internal tool definitions and handlers.
 * These tools run inside the orchestrator (no WS routing to the extension).
 */

import type { SSEEvent } from '@afe/shared';
import { searchUserMemories } from '../db/vector-search.js';
import type { ToolResultBlock, ToolUseBlock } from '../llm/types.js';
import { type MemoryCategory, saveUserMemory } from '../memory/user.js';
import { saveLocalFile } from '../storage/local.js';
import { spawnSubAgent, waitForAgents } from './swarm.js';

/** Names of all internal tools (not routed through WS). */
export const INTERNAL_TOOL_NAMES = [
	'save_memory',
	'recall_memory',
	'spawn_agent',
	'wait_for_agents',
	'save_to_local',
] as const;

/** Get internal tool definitions to merge with browser tools. */
export function getInternalToolDefinitions() {
	return [
		{
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
		},
		{
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
		},
		{
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
		},
		{
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
		},
		{
			name: 'save_to_local',
			description:
				"Save a file to persistent local storage on the user's computer (~/.commandra/). Use for exports, extracted data, or context files the user wants to keep.",
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
		},
	];
}

/** Check if a tool name is an internal tool. */
export function isInternalTool(name: string): boolean {
	return (INTERNAL_TOOL_NAMES as readonly string[]).includes(name);
}

interface InternalToolContext {
	userId: string;
	connectionId: string;
	domain?: string;
	domainMemory?: string;
	userMemory?: string;
	onEvent: (event: SSEEvent) => Promise<void>;
}

/**
 * Execute an internal tool and return a ToolResultBlock.
 * Returns null if the tool is not an internal tool.
 */
export async function executeInternalTool(
	block: ToolUseBlock,
	ctx: InternalToolContext,
): Promise<ToolResultBlock | null> {
	const { userId, connectionId, domain, domainMemory, userMemory, onEvent } = ctx;

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
				domainMemory,
				userMemory,
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

	// save_to_local — persist files to ~/.commandra/
	if (block.name === 'save_to_local' && domain) {
		const args = block.input as {
			filename: string;
			content: string;
			category: 'exports' | 'context';
		};
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

	// Not an internal tool
	return null;
}
