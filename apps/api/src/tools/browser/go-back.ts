import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const goBack: ExecutableTool = {
	name: 'go_back',
	description:
		'Go back to the previous page in the browser history. Equivalent to clicking the browser back button.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'go_back', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
