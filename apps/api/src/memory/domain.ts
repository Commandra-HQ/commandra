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
import { downloadDomainFile, uploadDomainFile } from '../storage/domain-files.js';

// In-memory cache: domain → { result, expiresAt }
const domainMemoryCache = new Map<string, { result: string | null; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function invalidateDomainMemoryCache(domain: string): void {
	domainMemoryCache.delete(domain);
}

export interface DomainKnowledge {
	knownPages: { path: string; description: string; howToReach: string }[];
	elementNotes: { selector: string; note: string }[];
	workflows: { name: string; steps: string[] }[];
	appNotes: string[];
}

/**
 * Format domain knowledge into a readable markdown string for prompt injection.
 */
function formatDomainKnowledge(knowledge: DomainKnowledge): string | null {
	const sections: string[] = [];

	if (knowledge.knownPages?.length) {
		sections.push('### Known Pages');
		for (const p of knowledge.knownPages) {
			sections.push(`- **${p.path}**: ${p.description} (reach via: ${p.howToReach})`);
		}
	}

	if (knowledge.workflows?.length) {
		sections.push('### Known Workflows');
		for (const w of knowledge.workflows) {
			sections.push(`- **${w.name}**: ${w.steps.join(' → ')}`);
		}
	}

	if (knowledge.elementNotes?.length) {
		sections.push('### Element Notes');
		for (const n of knowledge.elementNotes) {
			sections.push(`- \`${n.selector}\`: ${n.note}`);
		}
	}

	if (knowledge.appNotes?.length) {
		sections.push('### App Behavior');
		for (const note of knowledge.appNotes) {
			sections.push(`- ${note}`);
		}
	}

	return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * Load domain memory for a given domain. Returns null if no memory exists.
 * Uses in-memory cache with 5-minute TTL to avoid repeated DB queries.
 * Falls back to pre-seeded knowledge for popular apps.
 */
export async function loadDomainMemory(domain: string): Promise<string | null> {
	// Check cache first
	const cached = domainMemoryCache.get(domain);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.result;
	}

	const [record] = await db
		.select()
		.from(domainMemory)
		.where(eq(domainMemory.domain, domain))
		.limit(1);

	if (!record) {
		domainMemoryCache.set(domain, {
			result: null,
			expiresAt: Date.now() + CACHE_TTL_MS,
		});
		return null;
	}

	const result = formatDomainKnowledge({
		knownPages: record.knownPages || [],
		elementNotes: record.elementNotes || [],
		workflows: record.workflows || [],
		appNotes: record.appNotes || [],
	});
	domainMemoryCache.set(domain, {
		result,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
	return result;
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
		let jsonText = text.trim();
		if (jsonText.startsWith('```')) {
			jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
		}
		learned = JSON.parse(jsonText);
	} catch {
		if (text.trim()) {
			console.warn('[DomainMemory] Failed to parse learnings:', text.slice(0, 200));
		}
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
		const mergedPages = mergeByKey(existing.knownPages || [], learned.knownPages || [], 'path');
		const mergedNotes = mergeByKey(
			existing.elementNotes || [],
			learned.elementNotes || [],
			'selector',
		);
		const mergedWorkflows = mergeByKey(existing.workflows || [], learned.workflows || [], 'name');
		const mergedAppNotes = [
			...new Set([...(existing.appNotes || []), ...(learned.appNotes || [])]),
		];

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

	// Invalidate cache so next load picks up fresh data
	invalidateDomainMemoryCache(domain);
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

// --- S3-backed domain knowledge (per-user, richer than shared Postgres memory) ---

/**
 * Load KNOWLEDGE.md from S3 for a given user + domain.
 */
export async function loadDomainKnowledgeFromS3(
	userId: string,
	domain: string,
): Promise<string | null> {
	try {
		return await downloadDomainFile(userId, domain, 'KNOWLEDGE.md');
	} catch (err) {
		console.warn('[DomainKnowledge] Failed to load from S3:', err);
		return null;
	}
}

const S3_KNOWLEDGE_PROMPT = `You are analyzing a completed browser automation session. Extract two types of information:

1. **KNOWLEDGE** — facts about the web application that would help future sessions:
   - Page structure, navigation patterns, important elements
   - App behavior quirks (loading times, SPA transitions, modals)
   - Useful selectors and element patterns

2. **PREFERENCES** — user-specific preferences for this domain:
   - Preferred export formats, default recipients, shortcuts
   - Custom terminology ("the board" = specific Trello board)
   - Recurring targets or patterns

Return a JSON object:
{
  "knowledge": ["fact1", "fact2", ...],
  "preferences": ["pref1", "pref2", ...]
}

Only include concrete, specific observations. Return valid JSON only.`;

/**
 * Sync domain knowledge to S3 after a conversation. Extracts both knowledge
 * and preferences, writing to KNOWLEDGE.md and MEMORY.md respectively.
 */
export async function syncDomainKnowledgeToS3(
	userId: string,
	domain: string,
	conversationTranscript: string,
	provider: LLMProvider,
	fastModel: string,
): Promise<void> {
	try {
		const stream = provider.chat({
			model: fastModel,
			system: S3_KNOWLEDGE_PROMPT,
			messages: [
				{
					role: 'user',
					content: `Session on ${domain}:\n\n${conversationTranscript.slice(-4000)}`,
				},
			],
			maxTokens: 1000,
		});

		const response = await collectStream(stream);
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { text: string }).text)
			.join('');

		let extracted: { knowledge?: string[]; preferences?: string[] };
		try {
			// Strip markdown fences if present
			let jsonText = text.trim();
			if (jsonText.startsWith('```')) {
				jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
			}
			extracted = JSON.parse(jsonText);
		} catch {
			if (text.trim()) {
				console.warn('[DomainKnowledge] Failed to parse S3 extraction:', text.slice(0, 200));
			}
			return;
		}

		const today = new Date().toISOString().slice(0, 10);

		// Update KNOWLEDGE.md
		if (extracted.knowledge?.length) {
			let existing = await downloadDomainFile(userId, domain, 'KNOWLEDGE.md');
			const newEntries = extracted.knowledge.map((k) => `- [${today}] ${k}`);

			if (existing) {
				// Deduplicate by checking normalized content
				const existingLines = existing.split('\n').filter((l) => l.trim().startsWith('- '));
				const existingNorm = new Set(
					existingLines.map((l) =>
						l
							.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '')
							.toLowerCase()
							.trim(),
					),
				);
				const deduped = newEntries.filter((e) => {
					const norm = e
						.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '')
						.toLowerCase()
						.trim();
					return !existingNorm.has(norm);
				});

				if (deduped.length > 0) {
					const allLines = [...existingLines, ...deduped];
					// Cap at ~200 entries
					const capped = allLines.slice(-200);
					existing = `# Domain Knowledge\n\n${capped.join('\n')}\n`;
					await uploadDomainFile(userId, domain, 'KNOWLEDGE.md', existing);
				}
			} else {
				const content = `# Domain Knowledge\n\n${newEntries.join('\n')}\n`;
				await uploadDomainFile(userId, domain, 'KNOWLEDGE.md', content);
			}
		}

		// Update MEMORY.md (domain-specific preferences)
		if (extracted.preferences?.length) {
			let existing = await downloadDomainFile(userId, domain, 'MEMORY.md');
			const newEntries = extracted.preferences.map((p) => `- [${today}] ${p}`);

			if (existing) {
				const existingLines = existing.split('\n').filter((l) => l.trim().startsWith('- '));
				const existingNorm = new Set(
					existingLines.map((l) =>
						l
							.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '')
							.toLowerCase()
							.trim(),
					),
				);
				const deduped = newEntries.filter((e) => {
					const norm = e
						.replace(/^- \[\d{4}-\d{2}-\d{2}\]\s*/, '')
						.toLowerCase()
						.trim();
					return !existingNorm.has(norm);
				});

				if (deduped.length > 0) {
					const allLines = [...existingLines, ...deduped].slice(-100);
					existing = `# Domain Preferences\n\n${allLines.join('\n')}\n`;
					await uploadDomainFile(userId, domain, 'MEMORY.md', existing);
				}
			} else {
				const content = `# Domain Preferences\n\n${newEntries.join('\n')}\n`;
				await uploadDomainFile(userId, domain, 'MEMORY.md', content);
			}
		}

		console.log(
			`[DomainKnowledge] Synced S3 for ${domain}: +${extracted.knowledge?.length ?? 0} knowledge, +${extracted.preferences?.length ?? 0} preferences`,
		);
	} catch (err) {
		console.warn('[DomainKnowledge] S3 sync failed (non-critical):', err);
	}
}

/**
 * Append a proven workflow to domain WORKFLOWS.md.
 */
export async function appendDomainWorkflow(
	userId: string,
	domain: string,
	workflow: { name: string; steps: string[]; source: string },
): Promise<void> {
	try {
		let existing = await downloadDomainFile(userId, domain, 'WORKFLOWS.md');

		// Check for duplicate workflow name (case-insensitive)
		if (existing) {
			const nameNorm = workflow.name.toLowerCase().trim();
			const existingNames = existing.match(/^## Workflow: .+$/gm) || [];
			const isDuplicate = existingNames.some(
				(h) => h.replace('## Workflow: ', '').toLowerCase().trim() === nameNorm,
			);
			if (isDuplicate) return;

			// Count existing workflows — cap at 30
			const workflowCount = existingNames.length;
			if (workflowCount >= 30) return;
		}

		const today = new Date().toISOString().slice(0, 10);
		const workflowMd = [
			`## Workflow: ${workflow.name}`,
			`_Added: ${today} | Source: ${workflow.source}_`,
			'',
			...workflow.steps.map((s, i) => `${i + 1}. ${s}`),
			'',
		].join('\n');

		if (existing) {
			existing = `${existing.trimEnd()}\n\n${workflowMd}`;
		} else {
			existing = `# Domain Workflows\n\n${workflowMd}`;
		}

		await uploadDomainFile(userId, domain, 'WORKFLOWS.md', existing);
		console.log(`[DomainKnowledge] Added workflow "${workflow.name}" for ${domain}`);
	} catch (err) {
		console.warn('[DomainKnowledge] Workflow append failed:', err);
	}
}
