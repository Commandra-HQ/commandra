import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const typeText: ExecutableTool = {
	name: 'type_text',
	description: 'Type text into an input, textarea, or contenteditable element (rich text editors, compose fields, etc.). Clears existing content first. Works with Gmail compose, Slack messages, Notion blocks, and other modern editors.',
	parameters: {
		type: 'object',
		properties: {
			selector: { type: 'string', description: 'CSS selector of the input element' },
			text: { type: 'string', description: 'Text to type into the field' },
		},
		required: ['selector', 'text'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'type_text', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
