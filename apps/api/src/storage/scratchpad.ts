/**
 * Scratchpad storage — ephemeral shared state for multi-agent tasks.
 *
 * Used by coordinators and sub-agents to pass structured data between each other.
 * Lives in the agents bucket at: {userId}/scratchpad/{conversationId}/{key}.json
 * Auto-cleaned after 24h or when conversation ends.
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';

function scratchpadPath(userId: string, conversationId: string, key: string): string {
	return `${userId}/scratchpad/${conversationId}/${key}.json`;
}

export async function writeScratchpad(
	userId: string,
	conversationId: string,
	key: string,
	data: unknown,
): Promise<void> {
	const supabase = getSupabase();
	const path = scratchpadPath(userId, conversationId, key);
	const content = JSON.stringify(data, null, 2);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'application/json' });

	if (error) throw new Error(`Failed to write scratchpad "${key}": ${error.message}`);
}

export async function readScratchpad(
	userId: string,
	conversationId: string,
	key: string,
): Promise<unknown | null> {
	const supabase = getSupabase();
	const path = scratchpadPath(userId, conversationId, key);

	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return null;
		}
		throw new Error(`Failed to read scratchpad "${key}": ${error.message}`);
	}

	const text = await data.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export async function listScratchpad(
	userId: string,
	conversationId: string,
): Promise<{ key: string; size: number }[]> {
	const supabase = getSupabase();
	const prefix = `${userId}/scratchpad/${conversationId}`;

	const { data, error } = await supabase.storage.from(BUCKET).list(prefix);
	if (error) return [];

	return (data || [])
		.filter((f) => f.name.endsWith('.json'))
		.map((f) => ({
			key: f.name.replace(/\.json$/, ''),
			size: f.metadata?.size || 0,
		}));
}
