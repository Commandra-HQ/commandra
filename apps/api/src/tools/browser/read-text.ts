import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const readText: ExecutableTool = {
	name: 'read_text',
	description:
		'Extract the visible text content from one or more elements matching a CSS selector. Use this to read specific content on the page — paragraphs, headings, labels, cell values, status messages, etc.',
	parameters: {
		type: 'object',
		properties: {
			selector: {
				type: 'string',
				description: 'CSS selector of element(s) to read text from',
			},
			all: {
				type: 'boolean',
				description:
					'If true, read text from ALL matching elements (querySelectorAll). Default: false (first match only).',
			},
			maxLength: {
				type: 'number',
				description: 'Max characters to return per element (default 2000). Prevents huge payloads.',
			},
		},
		required: ['selector'],
	},
	async execute(args, context) {
		const result = await sendActionRequest(context.connectionId, 'read_text', args);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
