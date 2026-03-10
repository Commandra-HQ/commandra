/**
 * Background Inngest function: embed flow name + step intents for semantic search.
 */

import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { flowEmbeddings, flows } from '../../db/schema.js';
import { embedText, getEmbeddingProvider } from '../../llm/embeddings.js';
import { inngest } from '../client.js';

interface FlowStep {
	intent: string;
}

export const embedFlow = inngest.createFunction(
	{
		id: 'embed-flow',
		concurrency: { limit: 5 },
		retries: 2,
	},
	{ event: 'flow/saved' },
	async ({ event }) => {
		const { flowId } = event.data as { flowId: string };

		const [flow] = await db.select().from(flows).where(eq(flows.id, flowId)).limit(1);
		if (!flow) return { skipped: true, reason: 'flow not found' };

		const steps = (flow.steps as FlowStep[]) || [];
		const stepIntents = steps.map((s) => s.intent).filter(Boolean);

		// Combine flow name + description + step intents into one text
		const text = [
			flow.name,
			flow.description || '',
			...stepIntents,
		]
			.filter(Boolean)
			.join('. ');

		if (text.length < 3) return { skipped: true, reason: 'no meaningful text' };

		const provider = getEmbeddingProvider();
		const vector = await embedText(text);

		// Delete previous embedding for this flow
		await db.delete(flowEmbeddings).where(eq(flowEmbeddings.flowId, flowId));

		// Insert new embedding
		await db.insert(flowEmbeddings).values({
			flowId,
			text,
			embeddingModel: `${provider.id}/${process.env.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
			embedding: vector,
		});

		return { embedded: true, textLength: text.length };
	},
);
