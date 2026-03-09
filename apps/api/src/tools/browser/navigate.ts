import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const navigate: ExecutableTool = {
	name: 'navigate',
	description: 'Navigate the browser to a specific URL.',
	parameters: {
		type: 'object',
		properties: {
			url: { type: 'string', description: 'The URL to navigate to' },
		},
		required: ['url'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'navigate', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
