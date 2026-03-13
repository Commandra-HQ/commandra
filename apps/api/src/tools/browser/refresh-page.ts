import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const refreshPageState: ExecutableTool = {
	name: 'refresh_page_state',
	description:
		'Re-index the current page to get fresh element data. Use this after actions that dynamically change the page (SPA navigation, modals, AJAX updates) when get_page_state returns stale data.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'refresh_page_state', args, 15000);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
