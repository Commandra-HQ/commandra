import { sendActionRequest } from '../../ws/handler.js';
import type { ExecutableTool } from '../types.js';

export const waitForDownload: ExecutableTool = {
	name: 'wait_for_download',
	description:
		'Wait for a file download to complete. Call this AFTER clicking a download button. Returns the filename, path, size, and MIME type of the downloaded file.',
	parameters: {
		type: 'object',
		properties: {
			timeout: {
				type: 'number',
				description: 'Max time to wait in milliseconds (default: 30000)',
			},
		},
		required: [],
	},
	async execute(args, context) {
		const result = await sendActionRequest(
			context.connectionId,
			'wait_for_download',
			args,
			(args.timeout as number) || 30000,
		);
		return result as { success: boolean; data?: unknown; error?: string };
	},
};
