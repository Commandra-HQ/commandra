/**
 * One-time backfill: trigger embedding jobs for all existing pages and flows.
 * Run with: pnpm --filter @afe/api tsx src/scripts/backfill-embeddings.ts
 */

import '../env.js';
import { db } from '../db/index.js';
import { flows, pages } from '../db/schema.js';
import { inngest } from '../inngest/client.js';

async function backfill() {
	// Embed all pages
	const allPages = await db.select({ id: pages.id, url: pages.url }).from(pages);
	console.log(`Found ${allPages.length} pages to embed`);

	for (const page of allPages) {
		await inngest.send({ name: 'page/upserted', data: { pageId: page.id } });
		console.log(`  Queued: ${page.url}`);
	}

	// Embed all flows
	const allFlows = await db.select({ id: flows.id, name: flows.name }).from(flows);
	console.log(`Found ${allFlows.length} flows to embed`);

	for (const flow of allFlows) {
		await inngest.send({ name: 'flow/saved', data: { flowId: flow.id } });
		console.log(`  Queued: ${flow.name}`);
	}

	console.log('Done! Check Inngest dashboard at http://localhost:8288');
	process.exit(0);
}

backfill().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
