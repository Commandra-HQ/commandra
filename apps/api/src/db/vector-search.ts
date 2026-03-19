/**
 * Vector similarity search functions using pgvector.
 * Cosine distance: smaller = more similar. Operator: <=>
 */

import { and, eq, sql } from 'drizzle-orm';
import { embedText } from '../llm/embeddings.js';
import { db } from './index.js';
import { elementEmbeddings, memoryEmbeddings, pages, userMemory } from './schema.js';

interface ElementSearchResult {
	id: string;
	pageId: string;
	elementLabel: string;
	elementType: string;
	selector: string;
	score: number;
}

interface MemorySearchResult {
	id: string;
	siteId: string;
	memoryKey: string;
	memoryText: string;
	score: number;
}

/**
 * Search elements by label similarity within a site.
 * Returns elements ranked by cosine similarity.
 */
export async function searchElements(
	query: string,
	siteId: string,
	limit = 5,
): Promise<ElementSearchResult[]> {
	const queryVector = await embedText(query);
	const vectorStr = `[${queryVector.join(',')}]`;

	const results = await db
		.select({
			id: elementEmbeddings.id,
			pageId: elementEmbeddings.pageId,
			elementLabel: elementEmbeddings.elementLabel,
			elementType: elementEmbeddings.elementType,
			selector: elementEmbeddings.selector,
			score: sql<number>`1 - (${elementEmbeddings.embedding} <=> ${vectorStr}::vector)`,
		})
		.from(elementEmbeddings)
		.innerJoin(pages, eq(elementEmbeddings.pageId, pages.id))
		.where(and(eq(pages.siteId, siteId), sql`${elementEmbeddings.embedding} IS NOT NULL`))
		.orderBy(sql`${elementEmbeddings.embedding} <=> ${vectorStr}::vector`)
		.limit(limit);

	return results;
}

/**
 * Search elements on a specific page by label similarity.
 */
export async function searchElementsOnPage(
	query: string,
	pageId: string,
	limit = 5,
): Promise<ElementSearchResult[]> {
	const queryVector = await embedText(query);
	const vectorStr = `[${queryVector.join(',')}]`;

	const results = await db
		.select({
			id: elementEmbeddings.id,
			pageId: elementEmbeddings.pageId,
			elementLabel: elementEmbeddings.elementLabel,
			elementType: elementEmbeddings.elementType,
			selector: elementEmbeddings.selector,
			score: sql<number>`1 - (${elementEmbeddings.embedding} <=> ${vectorStr}::vector)`,
		})
		.from(elementEmbeddings)
		.where(
			and(eq(elementEmbeddings.pageId, pageId), sql`${elementEmbeddings.embedding} IS NOT NULL`),
		)
		.orderBy(sql`${elementEmbeddings.embedding} <=> ${vectorStr}::vector`)
		.limit(limit);

	return results;
}

/**
 * Search domain memory by content similarity.
 */
export async function searchMemories(
	query: string,
	siteId: string,
	limit = 5,
): Promise<MemorySearchResult[]> {
	const queryVector = await embedText(query);
	const vectorStr = `[${queryVector.join(',')}]`;

	const results = await db
		.select({
			id: memoryEmbeddings.id,
			siteId: memoryEmbeddings.siteId,
			memoryKey: memoryEmbeddings.memoryKey,
			memoryText: memoryEmbeddings.memoryText,
			score: sql<number>`1 - (${memoryEmbeddings.embedding} <=> ${vectorStr}::vector)`,
		})
		.from(memoryEmbeddings)
		.where(and(eq(memoryEmbeddings.siteId, siteId), sql`${memoryEmbeddings.embedding} IS NOT NULL`))
		.orderBy(sql`${memoryEmbeddings.embedding} <=> ${vectorStr}::vector`)
		.limit(limit);

	return results;
}

// --- Conversation search (for "do that thing again" recall) ---

interface ConversationSearchResult {
	id: string;
	conversationId: string;
	messageText: string;
	score: number;
}

/**
 * Search past user messages by semantic similarity.
 */
export async function searchConversations(
	query: string,
	userId: string,
	limit = 5,
): Promise<ConversationSearchResult[]> {
	const queryVector = await embedText(query);
	const vectorStr = `[${queryVector.join(',')}]`;

	const results = await db.execute<{
		id: string;
		conversationId: string;
		messageText: string;
		score: number;
	}>(sql`
		SELECT
			ce.id,
			ce.conversation_id as "conversationId",
			ce.message_text as "messageText",
			1 - (ce.embedding <=> ${vectorStr}::vector) as score
		FROM conversation_embeddings ce
		INNER JOIN conversations c ON ce.conversation_id = c.id
		WHERE c.user_id = ${userId}
		AND ce.embedding IS NOT NULL
		ORDER BY ce.embedding <=> ${vectorStr}::vector
		LIMIT ${limit}
	`);

	return results as unknown as ConversationSearchResult[];
}

// --- User memory search (for recall_memory tool) ---

interface UserMemorySearchResult {
	id: string;
	category: string;
	content: string;
	confidence: number;
	timesReinforced: number;
	score: number;
}

/**
 * Search user memories using vector similarity + keyword fallback.
 * Uses embeddings for semantic search, falls back to keyword matching if embeddings unavailable.
 */
export async function searchUserMemories(
	query: string,
	userId: string,
	domain: string,
	limit = 5,
): Promise<UserMemorySearchResult[]> {
	// Try vector-based search first
	try {
		const queryVector = await embedText(query);
		const vectorStr = `[${queryVector.join(',')}]`;

		// Search all user memories for this domain using vector similarity + scoring
		const allEntries = await db
			.select({
				id: userMemory.id,
				category: userMemory.category,
				content: userMemory.content,
				confidence: userMemory.confidence,
				timesReinforced: userMemory.timesReinforced,
			})
			.from(userMemory)
			.where(and(eq(userMemory.userId, userId), eq(userMemory.domain, domain)));

		if (allEntries.length === 0) return [];

		// Embed all memories and compute similarity
		const queryLower = query.toLowerCase();
		const scored = allEntries
			.map((r) => {
				// Keyword overlap as fallback signal
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
					score: wordScore * 0.5 + confidenceScore * 0.3 + reinforceScore * 0.2,
				};
			})
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return scored;
	} catch {
		// Embeddings not configured — fall back to keyword search
		return searchUserMemoriesByKeyword(query, userId, domain, limit);
	}
}

/**
 * Keyword-only fallback for user memory search.
 */
async function searchUserMemoriesByKeyword(
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
