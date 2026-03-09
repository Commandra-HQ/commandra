import type { ExecutableTool } from '../types.js';
import { sendActionRequest } from '../../ws/handler.js';

export const screenshot: ExecutableTool = {
	name: 'screenshot',
	description: 'Capture a screenshot of the current page. Returns a JPEG image. Use to verify actions worked, understand visual layout, or read content not available in the DOM.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	async execute(args, context) {
		// Screenshot has a longer timeout (30s) since captureVisibleTab can be slow
		const result = await sendActionRequest(context.connectionId, 'screenshot', args, 30000);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
