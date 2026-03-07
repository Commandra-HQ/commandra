/**
 * MCP Browser Bridge
 *
 * Exposes browser actions as MCP tools that the Agent SDK can call.
 * Each tool call gets forwarded to the Chrome extension via WebSocket.
 *
 * Tools:
 * - click_element: Click an element by selector
 * - type_text: Type text into an input field
 * - navigate: Go to a URL
 * - extract_table: Extract table data from the page
 * - get_page_state: Get current page structure
 * - screenshot: Capture visible page
 */

import type { ActionType } from '@afe/shared';
import { sendToExtension } from '../ws/handler.js';

export interface McpToolCall {
	tool: ActionType;
	args: Record<string, unknown>;
	connectionId: string;
}

export async function executeBrowserTool(call: McpToolCall): Promise<unknown> {
	const { tool, args, connectionId } = call;

	// Send action request to extension via WebSocket
	sendToExtension(connectionId, {
		type: 'action_request',
		payload: { action: tool, ...args },
		timestamp: Date.now(),
	});

	// In the real implementation, we'll await the action_result message
	// from the extension. For now, return a placeholder.
	return { status: 'sent', tool, args };
}
