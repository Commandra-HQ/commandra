/**
 * Tool registry — central place to register and look up browser tools.
 */

import type { Tool } from '../llm/types.js';
import { clickElement } from './browser/click.js';
import { goBack } from './browser/go-back.js';
import { navigate } from './browser/navigate.js';
import { getPageState } from './browser/page-state.js';
import { readTable } from './browser/read-table.js';
import { readText } from './browser/read-text.js';
import { refreshPageState } from './browser/refresh-page.js';
import { screenshot } from './browser/screenshot.js';
import { scroll } from './browser/scroll.js';
import { selectOption } from './browser/select.js';
import { typeText } from './browser/type.js';
import { waitForElement } from './browser/wait.js';
import { exportData } from './export.js';
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
register(goBack);
register(getPageState);
register(refreshPageState);
register(screenshot);
register(scroll);
register(waitForElement);
register(readText);
register(readTable);
register(exportData);

/**
 * Get tool definitions (for passing to the LLM).
 * If allowedTools is provided, only return tools whose name is in the list.
 */
export function getToolDefinitions(allowedTools?: string[]): Tool[] {
	const allTools = Array.from(tools.values()).map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.parameters,
	}));
	if (!allowedTools) return allTools;
	return allTools.filter((t) => allowedTools.includes(t.name));
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
