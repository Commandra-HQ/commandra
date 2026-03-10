/**
 * Background Inngest function: embed page elements after a page is upserted.
 * Runs async — never blocks the indexing pipeline.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { elementEmbeddings, pages } from '../../db/schema.js';
import { embedTexts, getEmbeddingProvider } from '../../llm/embeddings.js';
import { inngest } from '../client.js';

interface PageElement {
	label: string;
	type: string;
	selector: string;
}

function hashLabel(label: string, type: string): string {
	return createHash('sha256').update(`${type}:${label}`).digest('hex').slice(0, 16);
}

export const embedPageElements = inngest.createFunction(
	{
		id: 'embed-page-elements',
		concurrency: { limit: 3 }, // Max 3 concurrent embedding jobs
		retries: 2,
	},
	{ event: 'page/upserted' },
	async ({ event }) => {
		const { pageId } = event.data as { pageId: string };

		// Load the page and its elements
		const [page] = await db.select().from(pages).where(eq(pages.id, pageId)).limit(1);
		if (!page) return { skipped: true, reason: 'page not found' };

		const elements = (page.elements as PageElement[]) || [];
		if (elements.length === 0) return { skipped: true, reason: 'no elements' };

		// Filter to elements with meaningful labels
		const meaningful = elements.filter(
			(el) => el.label && el.label.length > 1 && el.label.length < 200,
		);
		if (meaningful.length === 0) return { skipped: true, reason: 'no meaningful labels' };

		// Check which elements already have current embeddings (by labelHash)
		const labelHashes = meaningful.map((el) => hashLabel(el.label, el.type));
		const existing = await db
			.select({ labelHash: elementEmbeddings.labelHash })
			.from(elementEmbeddings)
			.where(
				and(
					eq(elementEmbeddings.pageId, pageId),
					inArray(elementEmbeddings.labelHash, labelHashes),
				),
			);

		const existingHashes = new Set(existing.map((e) => e.labelHash));
		const toEmbed = meaningful.filter(
			(el) => !existingHashes.has(hashLabel(el.label, el.type)),
		);

		if (toEmbed.length === 0) return { skipped: true, reason: 'all elements already embedded' };

		// Delete stale embeddings for this page (elements that no longer exist)
		const currentHashes = new Set(labelHashes);
		const stale = await db
			.select({ id: elementEmbeddings.id, labelHash: elementEmbeddings.labelHash })
			.from(elementEmbeddings)
			.where(eq(elementEmbeddings.pageId, pageId));

		const staleIds = stale
			.filter((e) => e.labelHash && !currentHashes.has(e.labelHash))
			.map((e) => e.id);

		if (staleIds.length > 0) {
			await db
				.delete(elementEmbeddings)
				.where(inArray(elementEmbeddings.id, staleIds));
		}

		// Batch embed — combine type + label for better semantic signal
		const texts = toEmbed.map((el) => `${el.type}: ${el.label}`);
		const provider = getEmbeddingProvider();
		const vectors = await embedTexts(texts);

		// Insert new embeddings
		const rows = toEmbed.map((el, i) => ({
			pageId,
			elementLabel: el.label,
			elementType: el.type,
			selector: el.selector,
			labelHash: hashLabel(el.label, el.type),
			embeddingModel: `${provider.id}/${process.env.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
			embedding: vectors[i],
		}));

		// Insert in batches of 100
		for (let i = 0; i < rows.length; i += 100) {
			await db.insert(elementEmbeddings).values(rows.slice(i, i + 100));
		}

		return {
			embedded: toEmbed.length,
			staleRemoved: staleIds.length,
			total: meaningful.length,
		};
	},
);
