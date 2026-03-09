/**
 * Tool registry — central place to register and look up browser tools.
 */

import type { Tool } from '../llm/types.js';
import { clickElement } from './browser/click.js';
import { navigate } from './browser/navigate.js';
import { getPageState } from './browser/page-state.js';
import { screenshot } from './browser/screenshot.js';
import { selectOption } from './browser/select.js';
import { typeText } from './browser/type.js';
import type { ExecutableTool, ToolContext, ToolResult } from './types.js';

const tools = new Map<string, ExecutableTool>();

function register(tool: ExecutableTool) {
	tools.set(tool.name, tool);
}

// Register all browser tools
register(clickElement);
register(typeText);
register(selectOption);
register(navigate);
register(getPageState);
register(screenshot);

/**
 * Get all tool definitions (for passing to the LLM).
 */
export function getToolDefinitions(): Tool[] {
	return Array.from(tools.values()).map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	}));
}

/**
 * Execute a tool by name.
 */
export async function executeTool(
	name: string,
	args: Record<string, unknown>,
	context: ToolContext,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) {
		return { success: false, error: `Unknown tool: ${name}` };
	}
	return tool.execute(args, context);
}

/**
 * Check if a tool exists.
 */
export function hasTool(name: string): boolean {
	return tools.has(name);
}
