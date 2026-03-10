import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const scroll: ExecutableTool = {
	name: 'scroll',
	description:
		'Scroll the page in a direction, or scroll a specific element into view. Use this when content is below the fold, for infinite scroll pages, or to bring an element into the visible viewport.',
	parameters: {
		type: 'object',
		properties: {
			direction: {
				type: 'string',
				enum: ['up', 'down', 'top', 'bottom'],
				description: 'Direction to scroll the page',
			},
			selector: {
				type: 'string',
				description:
					'CSS selector of element to scroll into view. If provided, direction is ignored.',
			},
			amount: {
				type: 'number',
				description: 'Pixels to scroll (default 500). Ignored if selector is provided.',
			},
		},
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'scroll', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
