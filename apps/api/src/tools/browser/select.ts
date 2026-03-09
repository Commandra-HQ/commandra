import type { ExecutableTool } from '../types.js';
import { sendActionRequest } from '../../ws/handler.js';

export const selectOption: ExecutableTool = {
	name: 'select_option',
	description: 'Select an option from a dropdown/select element.',
	parameters: {
		type: 'object',
		properties: {
			selector: { type: 'string', description: 'CSS selector of the select element' },
			value: { type: 'string', description: 'Value of the option to select' },
		},
		required: ['selector', 'value'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'select_option', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
