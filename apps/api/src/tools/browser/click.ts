import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const clickElement: ExecutableTool = {
	name: 'click_element',
	description:
		'Click an interactive element on the page. Use the CSS selector from the page index.',
	parameters: {
		type: 'object',
		properties: {
			selector: { type: 'string', description: 'CSS selector of the element to click' },
		},
		required: ['selector'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'click_element', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
