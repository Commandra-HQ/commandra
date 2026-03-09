/**
 * Agent orchestrator — the main agentic loop.
 *
 * Provider-agnostic: uses the LLM provider layer, not vendor SDKs directly.
 * Handles: tool dispatch, safety classification, audit logging, kill switch, streaming.
 */

import { collectStream, getFastModel, getProvider, getStrongModel } from '../llm/index.js';
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
	onText: (text: string) => Promise<void>;
	maxIterations?: number;
}

export interface OrchestratorResult {
	response: string;
}

/**
 * Run the agentic loop. Streams text to the client, executes tools,
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
		onText,
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
		// Kill switch check
		if (isKilled(connectionId)) {
			const msg = '\n\n[Agent stopped by user]';
			fullResponse += msg;
			await onText(msg);
			break;
		}

		iterations++;

		// Call LLM
		const stream = provider.chat({
			model,
			system: systemPrompt,
			messages: currentMessages,
			tools: connectionId ? tools : undefined, // Only pass tools if browser connected
			maxTokens: 4096,
		});

		// Collect the full response (we need to process tool calls after)
		const response = await collectStream(stream);

		// Process response blocks
		const toolResults: ToolResultBlock[] = [];
		let hasToolUse = false;

		for (const block of response.content) {
			if (block.type === 'text') {
				fullResponse += block.text;
				await onText(block.text);
			} else if (block.type === 'tool_use') {
				hasToolUse = true;
				const result = await handleToolCall(block, context, userId, connectionId, onText);
				fullResponse += result.statusText;

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
					// Send screenshot as actual vision content so the LLM can see the page
					const { image, ...rest } = imageData;
					toolContent = [
						{ type: 'text' as const, text: JSON.stringify({ success: true, data: rest }) },
						{ type: 'image' as const, data: image as string, mediaType: 'image/jpeg' as const },
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
	onText: (text: string) => Promise<void>;
}): Promise<string> {
	const provider = getProvider();
	const model = getStrongModel();
	const systemPrompt = buildSystemPrompt(
		params.pageIndex,
		params.selectedElements,
		params.domainMemory,
	);

	let fullResponse = '';

	const stream = provider.chat({
		model,
		system: systemPrompt,
		messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
		maxTokens: 2048,
	});

	for await (const event of stream) {
		if (event.type === 'text') {
			fullResponse += event.text;
			await params.onText(event.text);
		}
	}

	return fullResponse;
}

// --- Internal helpers ---

interface ToolCallResult {
	data: unknown;
	isError: boolean;
	statusText: string;
}

async function handleToolCall(
	block: ToolUseBlock,
	context: { connectionId: string; userId: string },
	userId: string,
	connectionId: string,
	onText: (text: string) => Promise<void>,
): Promise<ToolCallResult> {
	const { name, input: toolArgs } = block;
	const elementLabel = (toolArgs.description as string) || (toolArgs.selector as string) || '';

	// Kill switch check before each action
	if (isKilled(connectionId)) {
		return {
			data: { success: false, error: 'Agent stopped by user' },
			isError: true,
			statusText: '',
		};
	}

	// Safety classification
	const classification = classifyAction({ toolName: name, args: toolArgs, elementLabel });
	console.log(
		`[Safety] ${name} "${elementLabel}" → ${classification.level} (${classification.reason})`,
	);

	// Blocked
	if (classification.level === 'blocked') {
		const msg = `\n[Blocked: ${classification.reason}]\n`;
		await onText(msg);
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
			statusText: msg,
		};
	}

	// Review — request approval
	if (classification.level === 'review') {
		const approvalMsg = `\n[Awaiting approval: ${name} — ${classification.reason}]\n`;
		await onText(approvalMsg);

		try {
			const approval = await sendApprovalRequest(connectionId, {
				action: name,
				selector: toolArgs.selector as string,
				label: elementLabel,
				reason: classification.reason,
			});

			if (!approval.approved) {
				const rejectMsg = `\n[User rejected: ${approval.reason || 'No reason given'}]\n`;
				await onText(rejectMsg);
				await logAction({
					userId,
					action: name,
					safetyLevel: 'review',
					approved: false,
					metadata: { args: toolArgs, reason: approval.reason },
				});
				return {
					data: { success: false, error: `User rejected this action. ${approval.reason || ''}` },
					isError: true,
					statusText: approvalMsg + rejectMsg,
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
				statusText: approvalMsg,
			};
		}
	}

	// Execute (safe or approved review)
	const statusMsg = `\n[Action: ${name}${toolArgs.selector ? ` on "${toolArgs.selector}"` : ''}${toolArgs.url ? ` to ${toolArgs.url}` : ''}]\n`;
	await onText(statusMsg);

	try {
		const result = await executeTool(name, toolArgs, context);
		await logAction({
			userId,
			action: name,
			safetyLevel: classification.level,
			approved: true,
			metadata: { args: toolArgs, result },
		});
		return { data: result, isError: false, statusText: statusMsg };
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await logAction({
			userId,
			action: name,
			safetyLevel: classification.level,
			approved: true,
			metadata: { args: toolArgs, error: errorMsg },
		});
		return {
			data: { success: false, error: errorMsg },
			isError: true,
			statusText: statusMsg,
		};
	}
}
