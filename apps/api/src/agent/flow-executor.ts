/**
 * Flow executor — AI-guided replay of saved flows.
 *
 * Instead of rigid step replay, the flow steps become context for the LLM.
 * The AI reads the steps, understands the goal, and executes with its own judgment.
 * If selectors changed, it adapts. If extra steps are needed, it adds them.
 */

import type { FlowParameter, FlowStep, SSEEvent, StepResult } from '@afe/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { flowRuns, flows } from '../db/schema.js';
import { getFastModel, getProvider, getStrongModel } from '../llm/index.js';
import type { ContentBlock, Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../llm/types.js';
import { logAction } from '../safety/audit.js';
import { classifyAction } from '../safety/classifier.js';
import { executeTool, getToolDefinitions } from '../tools/registry.js';
import { isKilled, sendApprovalRequest } from '../ws/handler.js';

export interface FlowExecutionParams {
	userId: string;
	connectionId: string;
	flowRunId: string;
	flowSteps: FlowStep[];
	parameters: unknown[];
	parameterValues: Record<string, string>;
	domain: string;
	onEvent: (event: SSEEvent) => Promise<void>;
	signal?: AbortSignal;
}

function buildFlowSystemPrompt(
	flowSteps: FlowStep[],
	parameters: FlowParameter[],
	parameterValues: Record<string, string>,
	domain: string,
): string {
	const stepsDescription = flowSteps
		.map((s, i) => {
			let desc = `${i + 1}. ${s.intent}`;
			if (s.toolName) desc += ` [tool: ${s.toolName}]`;
			if (s.args?.selector) desc += ` [selector: ${s.args.selector}]`;
			if (s.urlPattern) desc += ` [page: ${s.urlPattern}]`;
			return desc;
		})
		.join('\n');

	const paramDescription =
		parameters.length > 0
			? `\n\nParameters provided by the user:\n${parameters
					.map((p) => {
						const param = p as FlowParameter;
						const value = parameterValues[param.name] ?? param.defaultValue ?? '(not set)';
						return `- ${param.name}: "${value}"${param.description ? ` — ${param.description}` : ''}`;
					})
					.join('\n')}`
			: '';

	return `You are an AI assistant executing a saved flow (playbook) on ${domain}.

The user recorded these steps previously. Follow them as a guide, but use your judgment:
- Try the recorded selectors first, but if they don't work, find the equivalent element on the page
- If a step doesn't apply (element already visible, page already loaded), skip it
- If something unexpected appears (modal, error, loading), handle it
- Use get_page_state or screenshot to verify the page state when needed

## Flow Steps
${stepsDescription}
${paramDescription}

## Instructions
- Execute the steps in order using the browser tools
- After each action, briefly confirm what happened
- If a selector fails, use get_page_state to see what's on the page and find the right element
- Report your progress: "Step 1/${flowSteps.length}: [what you're doing]"
- When all steps are complete, summarize the result

You have access to all browser tools. Start executing now.`;
}

export async function runFlowExecution(params: FlowExecutionParams): Promise<void> {
	const {
		userId,
		connectionId,
		flowRunId,
		flowSteps,
		parameters,
		parameterValues,
		domain,
		onEvent,
		signal,
	} = params;

	const provider = getProvider();
	const model = getStrongModel();
	const tools = getToolDefinitions();
	const context = { connectionId, userId };
	const stepResults: StepResult[] = [];
	let stepsCompleted = 0;

	const systemPrompt = buildFlowSystemPrompt(
		flowSteps,
		parameters as FlowParameter[],
		parameterValues,
		domain,
	);

	let currentMessages: Message[] = [
		{
			role: 'user',
			content: 'Execute the flow now. Start with step 1.',
		},
	];

	let fullResponse = '';
	let iterations = 0;
	const maxIterations = flowSteps.length * 3 + 5; // Allow extra iterations for adaptation
	let flowFailed = false;

	await onEvent({ type: 'thinking' });

	while (iterations < maxIterations) {
		if (isKilled(connectionId) || signal?.aborted) {
			await updateFlowRun(flowRunId, 'stopped', stepsCompleted, stepResults, 'Stopped by user');
			await onEvent({ type: 'flow_done', flowRunId, success: false });
			return;
		}

		iterations++;

		const streamIter = provider.chat({
			model,
			system: systemPrompt,
			messages: currentMessages,
			tools,
			maxTokens: 4096,
			signal,
		});

		const content: ContentBlock[] = [];
		let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

		try {
			for await (const event of streamIter) {
				if (signal?.aborted) break;

				switch (event.type) {
					case 'text':
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
			throw err;
		}

		if (signal?.aborted) break;

		// Process tool calls
		const toolResults: ToolResultBlock[] = [];
		let hasToolUse = false;

		for (const block of content) {
			if (signal?.aborted) break;

			if (block.type === 'tool_use') {
				hasToolUse = true;
				const toolBlock = block as ToolUseBlock;
				const { name, input: toolArgs } = toolBlock;
				const elementLabel = (toolArgs.description as string) || (toolArgs.selector as string) || '';
				const stepStart = Date.now();

				if (isKilled(connectionId)) {
					toolResults.push({
						type: 'tool_result',
						toolUseId: toolBlock.id,
						content: JSON.stringify({ success: false, error: 'Stopped by user' }),
						isError: true,
					});
					continue;
				}

				// Safety classification
				const classification = classifyAction({ toolName: name, args: toolArgs, elementLabel });

				if (classification.level === 'blocked') {
					await onEvent({ type: 'blocked', toolName: name, reason: classification.reason });
					await logAction({
						userId,
						action: name,
						safetyLevel: 'blocked',
						approved: false,
						metadata: { args: toolArgs, reason: classification.reason, flowRunId },
					});
					toolResults.push({
						type: 'tool_result',
						toolUseId: toolBlock.id,
						content: JSON.stringify({
							success: false,
							error: `Blocked: ${classification.reason}`,
						}),
						isError: true,
					});
					continue;
				}

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
								metadata: { args: toolArgs, reason: approval.reason, flowRunId },
							});
							toolResults.push({
								type: 'tool_result',
								toolUseId: toolBlock.id,
								content: JSON.stringify({
									success: false,
									error: `User rejected: ${approval.reason || ''}`,
								}),
								isError: true,
							});
							continue;
						}
					} catch {
						toolResults.push({
							type: 'tool_result',
							toolUseId: toolBlock.id,
							content: JSON.stringify({ success: false, error: 'Approval failed' }),
							isError: true,
						});
						continue;
					}
				}

				// Execute
				await onEvent({
					type: 'tool_start',
					toolName: name,
					label: elementLabel || undefined,
					args: toolArgs,
				});

				try {
					const result = await executeTool(name, toolArgs, context);
					const duration = Date.now() - stepStart;

					await logAction({
						userId,
						action: name,
						safetyLevel: classification.level,
						approved: true,
						metadata: { args: toolArgs, result, flowRunId },
					});

					// Track as a step result (map tool calls to flow steps)
					const matchingStep = flowSteps.find(
						(s) => s.toolName === name && !stepResults.some((r) => r.stepIndex === s.index),
					);
					if (matchingStep) {
						stepsCompleted++;
						stepResults.push({
							stepIndex: matchingStep.index,
							success: true,
							toolName: name,
							duration,
						});
						await onEvent({
							type: 'flow_step_end',
							stepIndex: matchingStep.index,
							success: true,
						});
					}

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

					// Build tool result for LLM — include image for screenshots
					let toolContent: string | (TextBlock | { type: 'image'; data: string; mediaType: string })[];
					if (screenshotImage && provider.supportsVision) {
						const { image, ...rest } = (resultData?.data as Record<string, unknown>) || {};
						toolContent = [
							{ type: 'text' as const, text: JSON.stringify({ success: true, data: rest }) },
							{ type: 'image' as const, data: image as string, mediaType: 'image/jpeg' },
						];
					} else {
						toolContent = JSON.stringify(result);
					}

					toolResults.push({
						type: 'tool_result',
						toolUseId: toolBlock.id,
						content: toolContent as string,
						isError: false,
					});
				} catch (err) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					const duration = Date.now() - stepStart;

					await logAction({
						userId,
						action: name,
						safetyLevel: classification.level,
						approved: true,
						metadata: { args: toolArgs, error: errorMsg, flowRunId },
					});

					const matchingStep = flowSteps.find(
						(s) => s.toolName === name && !stepResults.some((r) => r.stepIndex === s.index),
					);
					if (matchingStep) {
						stepResults.push({
							stepIndex: matchingStep.index,
							success: false,
							toolName: name,
							error: errorMsg,
							duration,
						});
						await onEvent({
							type: 'flow_step_end',
							stepIndex: matchingStep.index,
							success: false,
							error: errorMsg,
						});
					}

					await onEvent({ type: 'tool_end', toolName: name, success: false, error: errorMsg });
					toolResults.push({
						type: 'tool_result',
						toolUseId: toolBlock.id,
						content: JSON.stringify({ success: false, error: errorMsg }),
						isError: true,
					});
				}
			}
		}

		if (!hasToolUse || stopReason === 'end_turn') break;

		// Feed results back for next iteration
		currentMessages = [
			...currentMessages,
			{ role: 'assistant', content },
			{ role: 'user', content: toolResults },
		];
	}

	// Determine final status
	const failedSteps = stepResults.filter((r) => !r.success);
	const finalStatus = flowFailed || failedSteps.length > 0 ? 'failed' : 'completed';
	const errorMsg = failedSteps.length > 0 ? `${failedSteps.length} step(s) failed` : undefined;

	await updateFlowRun(flowRunId, finalStatus, stepsCompleted, stepResults, errorMsg);

	// Update flow's lastRunAt
	await db.update(flows).set({ lastRunAt: new Date() }).where(eq(flows.id, flowRunId));

	await onEvent({ type: 'flow_done', flowRunId, success: finalStatus === 'completed' });
}

async function updateFlowRun(
	flowRunId: string,
	status: string,
	stepsCompleted: number,
	stepResults: StepResult[],
	error?: string,
) {
	await db
		.update(flowRuns)
		.set({
			status,
			stepsCompleted,
			stepResults,
			error: error || null,
			completedAt: new Date(),
		})
		.where(eq(flowRuns.id, flowRunId));
}
