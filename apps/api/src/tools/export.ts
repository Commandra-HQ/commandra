import type { ExecutableTool } from './types.js';

export const exportData: ExecutableTool = {
	name: 'export_data',
	description:
		'Convert structured data (e.g. from read_table) to CSV or JSON format. Returns formatted content that the user can download. Use this after extracting data when the user wants to export or download it.',
	parameters: {
		type: 'object',
		properties: {
			data: {
				type: 'array',
				description: 'Array of objects to export (e.g. rows from read_table)',
				items: { type: 'object' },
			},
			format: {
				type: 'string',
				enum: ['csv', 'json'],
				description: 'Output format. Default: csv.',
			},
			filename: {
				type: 'string',
				description: 'Suggested filename without extension. Default: "export".',
			},
		},
		required: ['data'],
	},
	async execute(args) {
		const data = args.data as Record<string, unknown>[];
		const format = (args.format as string) || 'csv';
		const filename = (args.filename as string) || 'export';

		if (!Array.isArray(data) || data.length === 0) {
			return { success: false, error: 'No data provided or data is empty' };
		}

		let content: string;
		let ext: string;

		if (format === 'json') {
			content = JSON.stringify(data, null, 2);
			ext = 'json';
		} else {
			content = toCsv(data);
			ext = 'csv';
		}

		return {
			success: true,
			data: {
				content,
				filename: `${filename}.${ext}`,
				format: ext,
				rowCount: data.length,
			},
		};
	},
};

function toCsv(data: Record<string, unknown>[]): string {
	// Collect all unique headers across all rows
	const headerSet = new Set<string>();
	for (const row of data) {
		for (const key of Object.keys(row)) {
			headerSet.add(key);
		}
	}
	const headers = Array.from(headerSet);

	const lines: string[] = [headers.map(csvEscape).join(',')];

	for (const row of data) {
		const values = headers.map((h) => {
			const val = row[h];
			if (val === null || val === undefined) return '';
			return csvEscape(String(val));
		});
		lines.push(values.join(','));
	}

	return lines.join('\n');
}

function csvEscape(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}
