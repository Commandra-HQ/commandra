/**
 * Tool definition types.
 * Tools are provider-agnostic — they describe what they do and how to execute.
 * The LLM provider layer translates these to vendor-specific formats.
 */

import type { JsonSchema } from '../llm/types.js';

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: JsonSchema;
}

export interface ToolContext {
	connectionId: string;
	userId: string;
	tabId?: number;
}

export interface ToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface ExecutableTool extends ToolDefinition {
	execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
