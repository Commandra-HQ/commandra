import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const readTable: ExecutableTool = {
	name: 'read_table',
	description:
		'Extract an HTML table as structured JSON data with headers and rows. Works with <table> elements and common data grid patterns (role="grid"). Use this for any tabular data on the page.',
	parameters: {
		type: 'object',
		properties: {
			selector: {
				type: 'string',
				description:
					'CSS selector of the table element, or a container that has a <table> inside it',
			},
			maxRows: {
				type: 'number',
				description:
					'Max rows to return (default 100). Use for large tables to limit payload size.',
			},
			includeLinks: {
				type: 'boolean',
				description:
					'If true, include href values for any links found in table cells. Default: false.',
			},
		},
		required: ['selector'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'read_table', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
