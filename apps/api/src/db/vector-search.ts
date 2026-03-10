/**
 * Vector similarity search functions using pgvector.
 * Cosine distance: smaller = more similar. Operator: <=>
 */

import { and, eq, sql } from 'drizzle-orm';
import { embedText } from '../llm/embeddings.js';
import { db } from './index.js';
import { elementEmbeddings, flowEmbeddings, memoryEmbeddings, pages } from './schema.js';

interface ElementSearchResult {
	id: string;
	pageId: string;
	elementLabel: string;
	elementType: string;
	selector: string;
	score: number;
}

interface FlowSearchResult {
	id: string;
	flowId: string;
	text: string;
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
		.where(
			and(
				eq(pages.siteId, siteId),
				sql`${elementEmbeddings.embedding} IS NOT NULL`,
			),
		)
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
			and(
				eq(elementEmbeddings.pageId, pageId),
				sql`${elementEmbeddings.embedding} IS NOT NULL`,
			),
		)
		.orderBy(sql`${elementEmbeddings.embedding} <=> ${vectorStr}::vector`)
		.limit(limit);

	return results;
}

/**
 * Search flows by intent/name similarity.
 */
export async function searchFlows(
	query: string,
	userId: string,
	limit = 5,
): Promise<FlowSearchResult[]> {
	const queryVector = await embedText(query);
	const vectorStr = `[${queryVector.join(',')}]`;

	// We need to join through flows to filter by userId
	const results = await db.execute<{
		id: string;
		flowId: string;
		text: string;
		score: number;
	}>(sql`
		SELECT
			fe.id,
			fe.flow_id as "flowId",
			fe.text,
			1 - (fe.embedding <=> ${vectorStr}::vector) as score
		FROM flow_embeddings fe
		INNER JOIN flows f ON fe.flow_id = f.id
		WHERE f.user_id = ${userId}
		AND fe.embedding IS NOT NULL
		ORDER BY fe.embedding <=> ${vectorStr}::vector
		LIMIT ${limit}
	`);

	return results as unknown as FlowSearchResult[];
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
		.where(
			and(
				eq(memoryEmbeddings.siteId, siteId),
				sql`${memoryEmbeddings.embedding} IS NOT NULL`,
			),
		)
		.orderBy(sql`${memoryEmbeddings.embedding} <=> ${vectorStr}::vector`)
		.limit(limit);

	return results;
}
