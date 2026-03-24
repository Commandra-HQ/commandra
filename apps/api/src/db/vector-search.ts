/**
 * User memory search — keyword-based scoring against S3 MEMORY.md files.
 * No Postgres dependency — reads directly from Supabase Storage.
 */

import { downloadDomainFile } from '../storage/domain-files.js';

interface UserMemorySearchResult {
	id: string;
	category: string;
	content: string;
	confidence: number;
	timesReinforced: number;
	score: number;
}

const ENTRY_RE = /^- \[(\d{4}-\d{2}-\d{2})\]\s*\[(\w+)\]\s*(?:\[reinforced:(\d+)\]\s*)?(.+)$/;

/**
 * Search user memories using keyword matching + relevance scoring.
 * Reads from S3 MEMORY.md instead of Postgres.
 */
export async function searchUserMemories(
	query: string,
	userId: string,
	domain: string,
	limit = 5,
): Promise<UserMemorySearchResult[]> {
	let text: string | null = null;
	try {
		text = await downloadDomainFile(userId, domain, 'MEMORY.md');
	} catch {
		return [];
	}
	if (!text) return [];

	const queryLower = query.toLowerCase();
	const words = queryLower.split(/\s+/).filter((w) => w.length > 2);

	const results: UserMemorySearchResult[] = [];

	for (const line of text.split('\n')) {
		const m = line.match(ENTRY_RE);
		if (!m) continue;

		const category = m[2];
		const reinforced = m[3] ? Number.parseInt(m[3], 10) : 1;
		const content = m[4].trim();
		const contentLower = content.toLowerCase();

		// Keyword scoring
		const matchedWords = words.filter((w) => contentLower.includes(w));
		const wordScore = words.length > 0 ? matchedWords.length / words.length : 0;
		if (wordScore === 0) continue;

		// Category boost
		const categoryBoost =
			category === 'correction' ? 1.3 : category === 'terminology' ? 1.2 : 1.0;

		// Reinforcement score
		const reinforceScore = Math.min(1, reinforced / 10);

		const score = wordScore * 0.6 * categoryBoost + reinforceScore * 0.15 + 0.25;

		results.push({
			id: `${category}:${content.slice(0, 20)}`,
			category,
			content,
			confidence: Math.min(reinforced, 5),
			timesReinforced: reinforced,
			score,
		});
	}

	return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
