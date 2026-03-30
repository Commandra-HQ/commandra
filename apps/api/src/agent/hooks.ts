/**
 * Hook evaluation engine for browser agents.
 *
 * Hooks are deterministic lifecycle checks — they run every time, not at the LLM's discretion.
 * Two types:
 * - Rule hooks: pattern matching on tool name/args. Zero latency.
 * - LLM hooks: single fast-model call for verification. ~1s latency.
 */

import type { AgentHooks, HookRule } from '@afe/shared';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';

/**
 * Check if a hook rule matches the current tool call.
 */
function ruleMatches(
	rule: HookRule,
	toolName: string,
	toolArgs: Record<string, unknown>,
): boolean {
	if (!rule.match) return true; // No match criteria = matches everything

	const { tools, labelPattern, urlPattern } = rule.match;

	// Check tool name
	if (tools && tools.length > 0 && !tools.includes(toolName)) {
		return false;
	}

	// Check label pattern (regex against element label/description/selector)
	if (labelPattern) {
		const label =
			(toolArgs.description as string) ||
			(toolArgs.label as string) ||
			(toolArgs.selector as string) ||
			'';
		try {
			if (!new RegExp(labelPattern, 'i').test(label)) return false;
		} catch {
			// Invalid regex — skip this check
		}
	}

	// Check URL pattern (regex against target URL)
	if (urlPattern) {
		const url = (toolArgs.url as string) || '';
		try {
			if (!new RegExp(urlPattern, 'i').test(url)) return false;
		} catch {
			// Invalid regex — skip
		}
	}

	return true;
}

/**
 * Evaluate PreToolUse hooks. Returns whether the tool call is allowed.
 */
export function evaluatePreToolUse(
	hooks: AgentHooks | undefined,
	toolName: string,
	toolArgs: Record<string, unknown>,
): { allowed: boolean; reason?: string } {
	if (!hooks?.preToolUse?.length) return { allowed: true };

	for (const rule of hooks.preToolUse) {
		if (!ruleMatches(rule, toolName, toolArgs)) continue;

		if (rule.action.type === 'block') {
			console.log(
				`[Hooks] PreToolUse BLOCKED: ${toolName} — ${rule.action.reason}`,
			);
			return { allowed: false, reason: rule.action.reason };
		}
	}

	return { allowed: true };
}

/**
 * Evaluate PostToolUse hooks. Returns side effects to execute.
 */
export function evaluatePostToolUse(
	hooks: AgentHooks | undefined,
	toolName: string,
	toolArgs: Record<string, unknown>,
): { screenshot: boolean; logMessages: string[] } {
	const result = { screenshot: false, logMessages: [] as string[] };
	if (!hooks?.postToolUse?.length) return result;

	for (const rule of hooks.postToolUse) {
		if (!ruleMatches(rule, toolName, toolArgs)) continue;

		if (rule.action.type === 'screenshot') {
			result.screenshot = true;
		} else if (rule.action.type === 'log') {
			result.logMessages.push(rule.action.message);
		}
	}

	return result;
}

/**
 * Evaluate OnComplete hooks. Returns whether the agent should stop or continue.
 * LLM-driven checks call the fast model with the hook's prompt.
 */
export async function evaluateOnComplete(
	hooks: AgentHooks | undefined,
	response: string,
	toolCallSummary: string,
): Promise<{ done: boolean; reason?: string }> {
	if (!hooks?.onComplete?.length) return { done: true };

	for (const rule of hooks.onComplete) {
		if (rule.action.type === 'llm_check') {
			try {
				const provider = getProvider();
				const model = getFastModel();
				const stream = provider.chat({
					model,
					system:
						'You are a task verification assistant. Answer ONLY with JSON: {"done": true} or {"done": false, "reason": "what is still missing"}.',
					messages: [
						{
							role: 'user',
							content: `${rule.action.prompt}\n\nAgent response: ${response.slice(0, 2000)}\nTool calls: ${toolCallSummary.slice(0, 1000)}`,
						},
					],
					maxTokens: 100,
				});

				const result = await collectStream(stream);
				const text = result.content
					.filter((b: { type: string }) => b.type === 'text')
					.map((b: { type: string; text?: string }) => (b as { text: string }).text)
					.join('')
					.trim();

				try {
					const parsed = JSON.parse(text);
					if (parsed.done === false) {
						console.log(
							`[Hooks] OnComplete LLM check FAILED: ${parsed.reason}`,
						);
						return { done: false, reason: parsed.reason };
					}
				} catch {
					// Couldn't parse — treat as "done"
				}
			} catch (err) {
				console.warn('[Hooks] OnComplete LLM check error:', err);
				// On error, let the agent stop (don't loop forever)
			}
		} else if (rule.action.type === 'require_screenshot') {
			// Check if any tool call was a screenshot
			if (!toolCallSummary.includes('screenshot')) {
				return {
					done: false,
					reason: 'Take a screenshot to verify the task was completed before finishing.',
				};
			}
		}
	}

	return { done: true };
}
