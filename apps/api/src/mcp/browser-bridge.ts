/**
 * MCP Browser Bridge
 *
 * Defines browser action tools that the agentic loop can call.
 * Each tool call gets forwarded to the Chrome extension via WebSocket.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { sendActionRequest } from '../ws/handler.js';

/** Tool definitions for Claude's tool_use */
export const browserTools: Anthropic.Tool[] = [
	{
		name: 'click_element',
		description: 'Click an interactive element on the page (button, link, checkbox, etc). Use the CSS selector from the page index.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: {
					type: 'string',
					description: 'CSS selector of the element to click',
				},
				description: {
					type: 'string',
					description: 'Human-readable description of what is being clicked (e.g. "the Submit button")',
				},
			},
			required: ['selector'],
		},
	},
	{
		name: 'type_text',
		description: 'Type text into an input field or textarea. Clears existing content first.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: {
					type: 'string',
					description: 'CSS selector of the input element',
				},
				text: {
					type: 'string',
					description: 'Text to type into the field',
				},
			},
			required: ['selector', 'text'],
		},
	},
	{
		name: 'select_option',
		description: 'Select an option from a dropdown/select element.',
		input_schema: {
			type: 'object' as const,
			properties: {
				selector: {
					type: 'string',
					description: 'CSS selector of the select element',
				},
				value: {
					type: 'string',
					description: 'Value of the option to select',
				},
			},
			required: ['selector', 'value'],
		},
	},
	{
		name: 'navigate',
		description: 'Navigate the browser to a specific URL.',
		input_schema: {
			type: 'object' as const,
			properties: {
				url: {
					type: 'string',
					description: 'The URL to navigate to',
				},
			},
			required: ['url'],
		},
	},
	{
		name: 'get_page_state',
		description: 'Get the current page structure including all interactive elements, their labels, and selectors. Use this after navigating or clicking to see the updated page.',
		input_schema: {
			type: 'object' as const,
			properties: {},
			required: [],
		},
	},
];

/**
 * Execute a browser tool by forwarding it to the extension via WebSocket.
 */
export async function executeBrowserTool(
	connectionId: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const result = await sendActionRequest(connectionId, toolName, args);
	return result;
}
