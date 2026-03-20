/**
 * Run log storage — date-wise structured logs for agent runs in Supabase Storage.
 *
 * Bucket: `agents` (reuses existing), path: `runs/{userId}/{YYYY-MM-DD}/{HH-MM}_{agentSlug}_{conversationId}.md`
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';

export interface RunLogData {
	agent: string;
	agentSlug: string;
	domain?: string;
	status: 'completed' | 'failed';
	toolCalls: number;
	tokensUsed?: number;
	durationMs: number;
	conversationId: string;
	summary?: string;
	toolTimeline?: { time: string; tool: string; result: string }[];
}

function runPath(userId: string, date: string, filename?: string): string {
	const base = `runs/${userId}/${date}`;
	return filename ? `${base}/${filename}` : base;
}

function formatRunLog(data: RunLogData): string {
	const lines: string[] = [
		`# Agent Run: ${data.agent}`,
		'',
		`- **Agent:** ${data.agent} (\`${data.agentSlug}\`)`,
		`- **Status:** ${data.status}`,
		`- **Domain:** ${data.domain || 'N/A'}`,
		`- **Tool Calls:** ${data.toolCalls}`,
		`- **Duration:** ${(data.durationMs / 1000).toFixed(1)}s`,
	];

	if (data.tokensUsed) {
		lines.push(`- **Tokens Used:** ${data.tokensUsed}`);
	}

	if (data.summary) {
		lines.push('', '## Summary', '', data.summary);
	}

	if (data.toolTimeline?.length) {
		lines.push('', '## Tool Timeline', '');
		for (const t of data.toolTimeline) {
			lines.push(`- \`${t.time}\` **${t.tool}** → ${t.result}`);
		}
	}

	lines.push('', `<!-- data:${JSON.stringify(data)} -->`);
	return lines.join('\n');
}

export async function writeRunLog(userId: string, data: RunLogData): Promise<void> {
	const supabase = getSupabase();
	const now = new Date();
	const date = now.toISOString().slice(0, 10);
	const time = now.toISOString().slice(11, 16).replace(':', '-');
	const filename = `${time}_${data.agentSlug}_${data.conversationId}.md`;
	const path = runPath(userId, date, filename);
	const content = formatRunLog(data);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'text/plain' });

	if (error) throw new Error(`Failed to write run log ${path}: ${error.message}`);
}

export async function listRunLogs(
	userId: string,
	date: string,
): Promise<{ name: string; size: number }[]> {
	const supabase = getSupabase();
	const prefix = runPath(userId, date);

	const { data, error } = await supabase.storage.from(BUCKET).list(prefix);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return [];
		}
		throw new Error(`Failed to list run logs: ${error.message}`);
	}

	return (data ?? []).map((f) => ({
		name: f.name,
		size: f.metadata?.size ?? 0,
	}));
}

export async function downloadRunLog(
	userId: string,
	date: string,
	filename: string,
): Promise<string | null> {
	const supabase = getSupabase();
	const path = runPath(userId, date, filename);

	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return null;
		}
		throw new Error(`Failed to download run log: ${error.message}`);
	}

	return await data.text();
}
