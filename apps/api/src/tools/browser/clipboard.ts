import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const clipboardWrite: ExecutableTool = {
	name: 'clipboard_write',
	description:
		'Write text to the system clipboard. Use this to copy data that you can then paste into another tab or application.',
	parameters: {
		type: 'object',
		properties: {
			text: {
				type: 'string',
				description: 'The text to copy to the clipboard',
			},
		},
		required: ['text'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'clipboard_write', args, 5000);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};

export const clipboardRead: ExecutableTool = {
	name: 'clipboard_read',
	description: 'Read the current text content of the system clipboard.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'clipboard_read', args, 5000);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
