/**
 * Conversation compaction storage — saves full conversation transcripts to S3
 * when the context window fills up, allowing the conversation to continue.
 *
 * Bucket: `agents` (reuses existing), path: `{userId}/compactions/{conversationId}/{timestamp}.md`
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';

export interface CompactionData {
	conversationId: string;
	summary: string;
	messageCount: number;
	timestamp: string;
}

function compactionPath(userId: string, conversationId: string, timestamp: string): string {
	return `${userId}/compactions/${conversationId}/${timestamp}.md`;
}

function formatCompaction(transcript: string, summary: string, conversationId: string): string {
	const lines = [
		'# Conversation Transcript (Compacted)',
		'',
		`_Conversation: ${conversationId}_`,
		`_Compacted: ${new Date().toISOString()}_`,
		'',
		'## Summary',
		'',
		summary,
		'',
		'---',
		'',
		'## Full Transcript',
		'',
		transcript,
	];
	return lines.join('\n');
}

/**
 * Save the full conversation transcript to S3 and return the path + summary.
 */
export async function saveCompaction(
	userId: string,
	conversationId: string,
	transcript: string,
	summary: string,
): Promise<{ path: string; summary: string }> {
	const supabase = getSupabase();
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const path = compactionPath(userId, conversationId, timestamp);
	const content = formatCompaction(transcript, summary, conversationId);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'text/plain' });

	if (error) throw new Error(`Failed to save compaction: ${error.message}`);

	return { path: `${BUCKET}/${path}`, summary };
}
