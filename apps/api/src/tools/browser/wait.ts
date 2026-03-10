import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const waitForElement: ExecutableTool = {
	name: 'wait_for_element',
	description:
		'Wait for an element matching a CSS selector to appear, disappear, or become visible on the page. Use this after navigation, for loading states, AJAX content, modals, or spinner completion.',
	parameters: {
		type: 'object',
		properties: {
			selector: {
				type: 'string',
				description: 'CSS selector to wait for',
			},
			state: {
				type: 'string',
				enum: ['visible', 'hidden', 'attached'],
				description:
					'What state to wait for. "visible" = exists and visible. "hidden" = gone or hidden. "attached" = exists in DOM (may be hidden). Default: "visible".',
			},
			timeout: {
				type: 'number',
				description: 'Max milliseconds to wait (default 10000, max 30000)',
			},
		},
		required: ['selector'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'wait_for_element', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
