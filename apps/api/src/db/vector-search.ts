/**
 * User memory search — keyword-based scoring.
 * Embeddings removed — domain knowledge now accumulates in S3 (KNOWLEDGE.md, WORKFLOWS.md).
 */

import { and, eq } from 'drizzle-orm';
import { db } from './index.js';
import { userMemory } from './schema.js';

interface UserMemorySearchResult {
	id: string;
	category: string;
	content: string;
	confidence: number;
	timesReinforced: number;
	score: number;
}

/**
 * Search user memories using keyword matching + relevance scoring.
 */
export async function searchUserMemories(
	query: string,
	userId: string,
	domain: string,
	limit = 5,
): Promise<UserMemorySearchResult[]> {
	const queryLower = query.toLowerCase();

	const results = await db
		.select({
			id: userMemory.id,
			category: userMemory.category,
			content: userMemory.content,
			confidence: userMemory.confidence,
			timesReinforced: userMemory.timesReinforced,
		})
		.from(userMemory)
		.where(and(eq(userMemory.userId, userId), eq(userMemory.domain, domain)));

	const scored = results
		.map((r) => {
			const contentLower = r.content.toLowerCase();
			const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
			const matchedWords = words.filter((w) => contentLower.includes(w));
			const wordScore = words.length > 0 ? matchedWords.length / words.length : 0;
			const confidenceScore = (r.confidence ?? 1) / 5;
			const reinforceScore = Math.min(1, (r.timesReinforced ?? 1) / 10);
			return {
				...r,
				confidence: r.confidence ?? 1,
				timesReinforced: r.timesReinforced ?? 1,
				score: wordScore * 0.6 + confidenceScore * 0.25 + reinforceScore * 0.15,
			};
		})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	return scored;
}
