import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const getPageState: ExecutableTool = {
	name: 'get_page_state',
	description:
		'Get the current page structure including all interactive elements and selectors. Use after navigating or clicking to see the updated page.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'get_page_state', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
