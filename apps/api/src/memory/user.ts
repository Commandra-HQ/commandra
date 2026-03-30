/**
 * Per-user adaptive memory — S3-backed markdown files.
 *
 * All user memory lives in Supabase Storage as markdown files:
 *   domains/{userId}/{domain}/MEMORY.md
 *
 * The agent has full read/write control via save_memory and recall_memory tools.
 * Background extraction appends learnings after each conversation.
 *
 * Format: `- [YYYY-MM-DD] [{category}] {content}`
 * Reinforced entries: `- [YYYY-MM-DD] [{category}] [reinforced:N] {content}`
 */

import { createHash } from 'node:crypto';
import { collectStream } from '../llm/index.js';
import type { LLMProvider } from '../llm/types.js';
import { downloadDomainFile, listDomainFiles, uploadDomainFile } from '../storage/domain-files.js';
import { getSupabase } from '../storage/supabase.js';
import { normalizeEntry, similarity } from '../utils/text-similarity.js';

export type MemoryCategory = 'preference' | 'correction' | 'terminology' | 'workflow';

export interface UserMemoryEntry {
	id: string;
	domain?: string;
	category: MemoryCategory;
	content: string;
	source: 'auto' | 'explicit';
	confidence: number;
	timesReinforced: number;
	createdAt: Date;
}

const MAX_MEMORIES_PER_DOMAIN = 100;
const PRUNE_AGE_DAYS = 90;
const MAX_PROMPT_MEMORIES = 15;
const FILENAME = 'MEMORY.md';

// --- Parsing helpers ---

interface ParsedEntry {
	raw: string;
	date: string;
	category: MemoryCategory;
	content: string;
	reinforced: number;
	source: 'auto' | 'explicit';
}

const ENTRY_RE = /^- \[(\d{4}-\d{2}-\d{2})\]\s*\[(\w+)\]\s*(?:\[reinforced:(\d+)\]\s*)?(.+)$/;

function parseMemoryFile(text: string): ParsedEntry[] {
	if (!text) return [];
	const entries: ParsedEntry[] = [];
	for (const line of text.split('\n')) {
		const m = line.match(ENTRY_RE);
		if (!m) continue;
		const category = m[2] as MemoryCategory;
		if (!['preference', 'correction', 'terminology', 'workflow'].includes(category)) continue;
		entries.push({
			raw: line,
			date: m[1],
			category,
			content: m[4].trim(),
			reinforced: m[3] ? Number.parseInt(m[3], 10) : 1,
			source: 'auto', // Can't distinguish from file; explicit entries look the same
		});
	}
	return entries;
}

function formatEntry(date: string, category: MemoryCategory, content: string, reinforced: number): string {
	const rTag = reinforced > 1 ? `[reinforced:${reinforced}] ` : '';
	return `- [${date}] [${category}] ${rTag}${content}`;
}

function serializeMemoryFile(entries: ParsedEntry[], domain?: string): string {
	// Group by category for readability
	const groups: Record<string, ParsedEntry[]> = {};
	for (const e of entries) {
		if (!groups[e.category]) groups[e.category] = [];
		groups[e.category].push(e);
	}

	const lines: string[] = [];
	if (domain) lines.push(`<!-- domain: ${domain} -->`);
	lines.push('# User Memory', '');
	const order: MemoryCategory[] = ['correction', 'preference', 'terminology', 'workflow'];
	for (const cat of order) {
		const items = groups[cat];
		if (!items?.length) continue;
		const label = cat === 'correction' ? 'Corrections' : cat === 'preference' ? 'Preferences' : cat === 'terminology' ? 'Terminology' : 'Workflows';
		lines.push(`## ${label}`);
		for (const e of items) {
			lines.push(formatEntry(e.date, e.category, e.content, e.reinforced));
		}
		lines.push('');
	}
	return lines.join('\n');
}

function entryId(entry: ParsedEntry): string {
	return createHash('sha256').update(`${entry.category}:${entry.content}`).digest('hex').slice(0, 16);
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

// --- Scoring (same logic as before, adapted for file-based entries) ---

function scoreEntry(entry: ParsedEntry): number {
	const daysSince = (Date.now() - new Date(entry.date).getTime()) / (1000 * 60 * 60 * 24);
	const recencyWeight = daysSince <= 7 ? 1.0 : Math.max(0.3, 1.0 - (daysSince / 90) * 0.7);
	const reinforcementBonus = Math.min(2.0, 1 + 0.1 * entry.reinforced);
	const categoryBoost =
		entry.category === 'correction' ? 2.0
			: entry.category === 'terminology' ? 1.5
				: entry.category === 'preference' ? 1.3 : 1.0;
	return recencyWeight * reinforcementBonus * categoryBoost;
}

// --- Public API (same signatures as before) ---

/**
 * Load user memory for prompt injection. Scores and selects top-K entries.
 */
export async function loadUserMemory(userId: string, domain: string): Promise<string | null> {
	let text: string | null = null;
	try {
		text = await downloadDomainFile(userId, domain, FILENAME);
	} catch {
		return null;
	}
	if (!text) return null;

	const entries = parseMemoryFile(text);
	if (entries.length === 0) return null;

	// Score and rank
	const scored = entries.map((e) => ({ ...e, score: scoreEntry(e) }));
	scored.sort((a, b) => b.score - a.score);

	// Always include all corrections + top-K from others
	const corrections = scored.filter((e) => e.category === 'correction');
	const others = scored.filter((e) => e.category !== 'correction');
	const selected = [...corrections, ...others.slice(0, MAX_PROMPT_MEMORIES - corrections.length)];

	// Group by category for formatted output
	const grouped: Record<string, string[]> = {};
	for (const entry of selected) {
		if (!grouped[entry.category]) grouped[entry.category] = [];
		grouped[entry.category].push(entry.content);
	}

	const sections: string[] = [];
	if (grouped.correction?.length) {
		sections.push('### Corrections (important — follow these)');
		for (const c of grouped.correction) sections.push(`- ${c}`);
	}
	if (grouped.preference?.length) {
		sections.push('### User Preferences');
		for (const p of grouped.preference) sections.push(`- ${p}`);
	}
	if (grouped.terminology?.length) {
		sections.push('### User Terminology');
		for (const t of grouped.terminology) sections.push(`- ${t}`);
	}
	if (grouped.workflow?.length) {
		sections.push('### Workflow Patterns');
		for (const w of grouped.workflow) sections.push(`- ${w}`);
	}

	const totalSkipped = entries.length - selected.length;
	if (totalSkipped > 0) {
		sections.push(`\n_${totalSkipped} additional memories available — use recall_memory to access them._`);
	}

	return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * Save a single memory entry. Deduplicates using similarity matching.
 */
export async function saveUserMemory(
	userId: string,
	domain: string,
	category: MemoryCategory,
	content: string,
	_source: 'auto' | 'explicit' = 'auto',
): Promise<void> {
	let text: string | null = null;
	try {
		text = await downloadDomainFile(userId, domain, FILENAME);
	} catch { /* file doesn't exist yet */ }

	const entries = text ? parseMemoryFile(text) : [];
	const normalizedContent = normalizeEntry(content);

	// Similarity-based dedup
	const dupIdx = entries.findIndex(
		(e) => similarity(normalizedContent, normalizeEntry(e.content)) > 0.75,
	);

	if (dupIdx >= 0) {
		// Reinforce: bump count, update content if new version is longer
		entries[dupIdx].reinforced += 1;
		entries[dupIdx].date = today();
		if (content.length > entries[dupIdx].content.length) {
			entries[dupIdx].content = content;
		}
	} else {
		// Cap enforcement: drop lowest-scored auto entries if at limit
		if (entries.length >= MAX_MEMORIES_PER_DOMAIN) {
			const scored = entries.map((e, i) => ({ i, score: scoreEntry(e) }));
			scored.sort((a, b) => a.score - b.score);
			entries.splice(scored[0].i, 1);
		}
		entries.push({
			raw: '',
			date: today(),
			category,
			content,
			reinforced: 1,
			source: _source,
		});
	}

	await uploadDomainFile(userId, domain, FILENAME, serializeMemoryFile(entries, domain));
}

/**
 * List all user memories, optionally filtered by domain.
 */
export async function listUserMemories(
	userId: string,
	domain?: string,
): Promise<(UserMemoryEntry & { domain: string })[]> {
	if (domain) {
		return listMemoriesForDomain(userId, domain);
	}

	// List all domain folders, then read each MEMORY.md
	try {
		const supabase = getSupabase();
		const { data: folders } = await supabase.storage
			.from('agents')
			.list(`domains/${userId}`, { limit: 200 });

		if (!folders?.length) return [];

		const results: (UserMemoryEntry & { domain: string })[] = [];
		for (const folder of folders) {
			if (!folder.name) continue;
			// Read MEMORY.md directly using the sanitized folder name as path
			// to avoid double-sanitization issues with domain names containing hyphens
			try {
				const path = `domains/${userId}/${folder.name}/MEMORY.md`;
				const { data, error } = await supabase.storage.from('agents').download(path);
				if (error || !data) continue;
				const text = await data.text();
				if (!text) continue;

				// Extract original domain from header comment, or reverse-sanitize as fallback
				const domainMatch = text.match(/^<!-- domain: (.+) -->$/m);
				const domainName = domainMatch?.[1] || folder.name.replace(/_/g, '.');

				const entries = parseMemoryFile(text);
				results.push(...entries.map((e) => ({
					id: entryId(e),
					domain: domainName,
					category: e.category,
					content: e.content,
					source: e.source,
					confidence: Math.min(e.reinforced, 5),
					timesReinforced: e.reinforced,
					createdAt: new Date(e.date),
				})));
			} catch { continue; }
		}
		return results;
	} catch (err) {
		console.warn('[UserMemory] Failed to list all domains:', err);
		return [];
	}
}

async function listMemoriesForDomain(
	userId: string,
	domain: string,
): Promise<(UserMemoryEntry & { domain: string })[]> {
	let text: string | null = null;
	try {
		text = await downloadDomainFile(userId, domain, FILENAME);
	} catch { return []; }
	if (!text) return [];

	return parseMemoryFile(text).map((e) => ({
		id: entryId(e),
		domain,
		category: e.category,
		content: e.content,
		source: e.source,
		confidence: Math.min(e.reinforced, 5),
		timesReinforced: e.reinforced,
		createdAt: new Date(e.date),
	}));
}

/**
 * Delete a single memory by ID (content hash).
 */
export async function deleteUserMemoryById(userId: string, memoryId: string): Promise<boolean> {
	// We need to scan all domains since we don't know which domain the ID belongs to
	const all = await listUserMemories(userId);
	const target = all.find((e) => e.id === memoryId);
	if (!target) return false;

	const text = await downloadDomainFile(userId, target.domain, FILENAME);
	if (!text) return false;

	const entries = parseMemoryFile(text);
	const filtered = entries.filter((e) => entryId(e) !== memoryId);
	if (filtered.length === entries.length) return false;

	await uploadDomainFile(userId, target.domain, FILENAME, serializeMemoryFile(filtered, target.domain));
	return true;
}

/**
 * Clear all memories for a user on a specific domain.
 */
export async function clearUserMemoryForDomain(userId: string, domain: string): Promise<void> {
	await uploadDomainFile(userId, domain, FILENAME, `<!-- domain: ${domain} -->\n# User Memory\n`);
}

/**
 * Update a memory's content by ID.
 */
export async function editUserMemory(
	userId: string,
	memoryId: string,
	content: string,
): Promise<boolean> {
	const all = await listUserMemories(userId);
	const target = all.find((e) => e.id === memoryId);
	if (!target) return false;

	const text = await downloadDomainFile(userId, target.domain, FILENAME);
	if (!text) return false;

	const entries = parseMemoryFile(text);
	const entry = entries.find((e) => entryId(e) === memoryId);
	if (!entry) return false;

	entry.content = content;
	entry.date = today();
	await uploadDomainFile(userId, target.domain, FILENAME, serializeMemoryFile(entries, target.domain));
	return true;
}

/**
 * Prune stale auto-memories (>90 days, never reinforced).
 */
export async function pruneStaleMemories(userId: string, domain: string): Promise<number> {
	let text: string | null = null;
	try {
		text = await downloadDomainFile(userId, domain, FILENAME);
	} catch { return 0; }
	if (!text) return 0;

	const entries = parseMemoryFile(text);
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - PRUNE_AGE_DAYS);
	const cutoffStr = cutoffDate.toISOString().slice(0, 10);

	const kept = entries.filter((e) => {
		if (e.date > cutoffStr) return true; // Recent enough
		if (e.reinforced > 1) return true; // Has been reinforced
		return false; // Stale auto-memory
	});

	const pruned = entries.length - kept.length;
	if (pruned > 0) {
		await uploadDomainFile(userId, domain, FILENAME, serializeMemoryFile(kept, domain));
	}
	return pruned;
}

// --- Auto-extraction from conversations ---

const USER_LEARN_PROMPT = `You are analyzing a browser automation conversation to extract USER-SPECIFIC patterns. Focus on what you learned about how THIS USER prefers to work.

Look for:
- **corrections**: User said "no, not that" or redirected the agent to a different approach
- **preferences**: User stated "I always want...", "use X instead of Y", preferred formats/views
- **terminology**: User's shorthand or domain language ("when I say X, I mean Y")
- **workflow**: Repeated patterns in how the user approaches tasks

Return a JSON array of learnings. Each item has "category" and "content" fields.
Only include concrete, specific observations. Do not guess or include generic advice.
If nothing user-specific was learned, return an empty array [].
Even single interactions can reveal preferences — if the user asked for something in a specific way, that's worth noting.

Example:
[
  { "category": "correction", "content": "The 'Submit' button is at the bottom of the form, not in the header" },
  { "category": "preference", "content": "Always export data as CSV, never JSON" },
  { "category": "terminology", "content": "When user says 'the report', they mean the Weekly Sales Report on /reports/weekly" },
  { "category": "workflow", "content": "User always filters by date range before exporting invoices" }
]

Return valid JSON only.`;

/** Correction signal patterns — if detected, use strong model for extraction */
const CORRECTION_SIGNALS =
	/\b(no[,.]?\s|not that|wrong|actually|instead|don't|stop|use .+ instead|I (always|never|prefer)|that's incorrect)\b/i;

/**
 * Extract user-specific learnings from a conversation and save to user memory.
 * Uses strong model when corrections/feedback detected, fast model otherwise.
 */
export async function extractAndSaveUserMemory(
	userId: string,
	domain: string,
	conversationTranscript: string,
	provider: LLMProvider,
	fastModel: string,
	strongModel?: string,
): Promise<void> {
	const hasCorrections = CORRECTION_SIGNALS.test(conversationTranscript);
	const model = hasCorrections && strongModel ? strongModel : fastModel;
	if (hasCorrections) {
		console.log('[UserMemory] Correction detected — using strong model for extraction');
	}

	const stream = provider.chat({
		model,
		system: USER_LEARN_PROMPT,
		messages: [
			{
				role: 'user',
				content: `Conversation on ${domain}:\n\n${conversationTranscript}`,
			},
		],
		maxTokens: 1000,
	});

	const response = await collectStream(stream);
	const text = response.content
		.filter((b) => b.type === 'text')
		.map((b) => (b as { text: string }).text)
		.join('');

	let learnings: { category: string; content: string }[];
	try {
		let jsonText = text.trim();
		if (jsonText.startsWith('```')) {
			jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
		}
		learnings = JSON.parse(jsonText);
	} catch {
		if (text.trim()) {
			console.warn('[UserMemory] Failed to parse learnings:', text.slice(0, 200));
		}
		return;
	}

	if (!Array.isArray(learnings) || learnings.length === 0) return;

	// Prune stale entries before adding new ones
	await pruneStaleMemories(userId, domain);

	for (const learning of learnings) {
		const category = learning.category as MemoryCategory;
		if (!['preference', 'correction', 'terminology', 'workflow'].includes(category)) continue;
		if (!learning.content?.trim()) continue;
		await saveUserMemory(userId, domain, category, learning.content.trim(), 'auto');
	}

	console.log(`[UserMemory] Saved ${learnings.length} learnings for user on ${domain}`);
}
