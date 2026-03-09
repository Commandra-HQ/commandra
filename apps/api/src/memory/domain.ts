/**
 * Per-domain memory — the agent gets better at each web app over time.
 *
 * After each successful task, the orchestrator asks the fast model:
 * "What did you learn about this app?" The response gets merged into
 * the domain's memory record. Next conversation on this domain gets
 * the memory injected into the system prompt.
 *
 * All users on the same domain share the same knowledge base.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { domainMemory } from '../db/schema.js';
import { collectStream } from '../llm/index.js';
import type { LLMProvider } from '../llm/types.js';

export interface DomainKnowledge {
	knownPages: { path: string; description: string; howToReach: string }[];
	elementNotes: { selector: string; note: string }[];
	workflows: { name: string; steps: string[] }[];
	appNotes: string[];
}

/**
 * Load domain memory for a given domain. Returns null if no memory exists.
 */
export async function loadDomainMemory(domain: string): Promise<string | null> {
	const [record] = await db
		.select()
		.from(domainMemory)
		.where(eq(domainMemory.domain, domain))
		.limit(1);

	if (!record) return null;

	const sections: string[] = [];

	if (record.knownPages?.length) {
		sections.push('### Known Pages');
		for (const p of record.knownPages) {
			sections.push(`- **${p.path}**: ${p.description} (reach via: ${p.howToReach})`);
		}
	}

	if (record.workflows?.length) {
		sections.push('### Known Workflows');
		for (const w of record.workflows) {
			sections.push(`- **${w.name}**: ${w.steps.join(' → ')}`);
		}
	}

	if (record.elementNotes?.length) {
		sections.push('### Element Notes');
		for (const n of record.elementNotes) {
			sections.push(`- \`${n.selector}\`: ${n.note}`);
		}
	}

	if (record.appNotes?.length) {
		sections.push('### App Behavior');
		for (const note of record.appNotes) {
			sections.push(`- ${note}`);
		}
	}

	return sections.length > 0 ? sections.join('\n') : null;
}

const LEARN_PROMPT = `You are analyzing a completed browser automation session. Based on the conversation, extract knowledge about the web application that would help future sessions on the same site.

Return a JSON object with these fields (all arrays, include only what you actually learned — empty arrays are fine):
{
  "knownPages": [{ "path": "/invoices", "description": "Invoice listing page", "howToReach": "Click Invoices in sidebar" }],
  "elementNotes": [{ "selector": "#submit-btn", "note": "Takes 2s to respond after click" }],
  "workflows": [{ "name": "Filter invoices by date", "steps": ["Click Filters button", "Select date range", "Click Apply"] }],
  "appNotes": ["Uses React, needs wait after navigation", "Session expires after 30 min idle"]
}

Only include concrete, specific observations. Do not guess or assume. Return valid JSON only.`;

/**
 * Extract learnings from a completed conversation and merge into domain memory.
 */
export async function updateDomainMemory(
	domain: string,
	conversationTranscript: string,
	provider: LLMProvider,
	fastModel: string,
): Promise<void> {
	// Ask the fast model what it learned
	const stream = provider.chat({
		model: fastModel,
		system: LEARN_PROMPT,
		messages: [
			{
				role: 'user',
				content: `Here is the conversation transcript from a session on ${domain}:\n\n${conversationTranscript}`,
			},
		],
		maxTokens: 1000,
	});

	const response = await collectStream(stream);
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => (b as { text: string }).text)
		.join('');

	let learned: DomainKnowledge;
	try {
		learned = JSON.parse(text);
	} catch {
		console.warn('[DomainMemory] Failed to parse learnings:', text.slice(0, 200));
		return;
	}

	// Check if anything was learned
	const hasContent =
		learned.knownPages?.length ||
		learned.elementNotes?.length ||
		learned.workflows?.length ||
		learned.appNotes?.length;

	if (!hasContent) return;

	// Load existing memory
	const [existing] = await db
		.select()
		.from(domainMemory)
		.where(eq(domainMemory.domain, domain))
		.limit(1);

	if (existing) {
		// Merge — deduplicate by path/selector/name
		const mergedPages = mergeByKey(
			existing.knownPages || [],
			learned.knownPages || [],
			'path',
		);
		const mergedNotes = mergeByKey(
			existing.elementNotes || [],
			learned.elementNotes || [],
			'selector',
		);
		const mergedWorkflows = mergeByKey(
			existing.workflows || [],
			learned.workflows || [],
			'name',
		);
		const mergedAppNotes = [...new Set([...(existing.appNotes || []), ...(learned.appNotes || [])])];

		await db
			.update(domainMemory)
			.set({
				knownPages: mergedPages,
				elementNotes: mergedNotes,
				workflows: mergedWorkflows,
				appNotes: mergedAppNotes.slice(0, 50), // Cap at 50 notes
				updatedAt: new Date(),
			})
			.where(eq(domainMemory.domain, domain));
	} else {
		await db.insert(domainMemory).values({
			domain,
			knownPages: learned.knownPages || [],
			elementNotes: learned.elementNotes || [],
			workflows: learned.workflows || [],
			appNotes: learned.appNotes || [],
		});
	}

	console.log(`[DomainMemory] Updated memory for ${domain}`);
}

/**
 * Merge two arrays by a key field. New items with matching keys replace old ones.
 */
function mergeByKey<T extends Record<string, unknown>>(
	existing: T[],
	incoming: T[],
	key: string,
): T[] {
	const map = new Map<unknown, T>();
	for (const item of existing) map.set(item[key], item);
	for (const item of incoming) map.set(item[key], item); // new replaces old
	return [...map.values()].slice(0, 100); // cap at 100 entries
}
