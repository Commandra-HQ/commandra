/**
 * Per-user adaptive memory — the agent learns each user's preferences,
 * corrections, terminology, and workflow habits over time.
 *
 * Two memory layers:
 * - Domain memory (domain.ts): shared app knowledge, all users
 * - User memory (this file): personal per-user-per-domain learnings
 *
 * Inspired by Claude Code's auto-memory system.
 */

import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userMemory } from '../db/schema.js';
import { collectStream } from '../llm/index.js';
import type { LLMProvider } from '../llm/types.js';

export type MemoryCategory = 'preference' | 'correction' | 'terminology' | 'workflow';

export interface UserMemoryEntry {
	id: string;
	category: MemoryCategory;
	content: string;
	source: 'auto' | 'explicit';
	confidence: number;
	timesReinforced: number;
	createdAt: Date;
}

const MAX_MEMORIES_PER_DOMAIN = 50;
const PRUNE_AGE_DAYS = 90;

/**
 * Load user memory for a given user + domain. Returns formatted string for prompt injection.
 */
export async function loadUserMemory(userId: string, domain: string): Promise<string | null> {
	const entries = await db
		.select()
		.from(userMemory)
		.where(and(eq(userMemory.userId, userId), eq(userMemory.domain, domain)));

	if (!entries.length) return null;

	// Update lastUsedAt for loaded memories
	const ids = entries.map((e) => e.id);
	for (const id of ids) {
		await db
			.update(userMemory)
			.set({ lastUsedAt: new Date() })
			.where(eq(userMemory.id, id));
	}

	// Group by category
	const grouped: Record<string, string[]> = {};
	for (const entry of entries) {
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

	return sections.length > 0 ? sections.join('\n') : null;
}

/**
 * Save a single memory entry (from explicit user request or save_memory tool).
 */
export async function saveUserMemory(
	userId: string,
	domain: string,
	category: MemoryCategory,
	content: string,
	source: 'auto' | 'explicit' = 'auto',
): Promise<void> {
	// Check for duplicates or similar entries
	const existing = await db
		.select()
		.from(userMemory)
		.where(and(eq(userMemory.userId, userId), eq(userMemory.domain, domain)));

	// Simple duplicate check — exact match
	const duplicate = existing.find(
		(e) => e.content.toLowerCase().trim() === content.toLowerCase().trim(),
	);
	if (duplicate) {
		// Reinforce existing memory
		await db
			.update(userMemory)
			.set({
				timesReinforced: (duplicate.timesReinforced ?? 1) + 1,
				confidence: Math.min((duplicate.confidence ?? 1) + 1, 5),
				updatedAt: new Date(),
			})
			.where(eq(userMemory.id, duplicate.id));
		return;
	}

	// Enforce limit — remove lowest confidence if at cap
	if (existing.length >= MAX_MEMORIES_PER_DOMAIN) {
		const autoEntries = existing
			.filter((e) => e.source === 'auto')
			.sort((a, b) => (a.confidence ?? 1) - (b.confidence ?? 1));
		if (autoEntries.length > 0) {
			await db.delete(userMemory).where(eq(userMemory.id, autoEntries[0].id));
		}
	}

	await db.insert(userMemory).values({
		userId,
		domain,
		category,
		content,
		source,
		confidence: source === 'explicit' ? 3 : 1,
	});
}

/**
 * List all user memories, optionally filtered by domain.
 */
export async function listUserMemories(
	userId: string,
	domain?: string,
): Promise<UserMemoryEntry[]> {
	const conditions = [eq(userMemory.userId, userId)];
	if (domain) conditions.push(eq(userMemory.domain, domain));

	const entries = await db
		.select()
		.from(userMemory)
		.where(and(...conditions));

	return entries.map((e) => ({
		id: e.id,
		category: e.category as MemoryCategory,
		content: e.content,
		source: e.source as 'auto' | 'explicit',
		confidence: e.confidence ?? 1,
		timesReinforced: e.timesReinforced ?? 1,
		createdAt: e.createdAt,
	}));
}

/**
 * Delete a single memory by ID (must belong to user).
 */
export async function deleteUserMemoryById(userId: string, memoryId: string): Promise<boolean> {
	// Check existence first, then delete
	const [existing] = await db
		.select({ id: userMemory.id })
		.from(userMemory)
		.where(and(eq(userMemory.id, memoryId), eq(userMemory.userId, userId)))
		.limit(1);
	if (!existing) return false;
	await db
		.delete(userMemory)
		.where(and(eq(userMemory.id, memoryId), eq(userMemory.userId, userId)));
	return true;
}

/**
 * Clear all memories for a user on a specific domain.
 */
export async function clearUserMemoryForDomain(userId: string, domain: string): Promise<void> {
	await db
		.delete(userMemory)
		.where(and(eq(userMemory.userId, userId), eq(userMemory.domain, domain)));
}

/**
 * Update a memory's content.
 */
export async function editUserMemory(
	userId: string,
	memoryId: string,
	content: string,
): Promise<boolean> {
	const [existing] = await db
		.select({ id: userMemory.id })
		.from(userMemory)
		.where(and(eq(userMemory.id, memoryId), eq(userMemory.userId, userId)))
		.limit(1);
	if (!existing) return false;
	await db
		.update(userMemory)
		.set({ content, updatedAt: new Date() })
		.where(eq(userMemory.id, memoryId));
	return true;
}

/**
 * Prune stale auto-memories (>90 days, never reinforced).
 */
export async function pruneStaleMemories(userId: string, domain: string): Promise<number> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - PRUNE_AGE_DAYS);

	const stale = await db
		.select({ id: userMemory.id })
		.from(userMemory)
		.where(
			and(
				eq(userMemory.userId, userId),
				eq(userMemory.domain, domain),
				eq(userMemory.source, 'auto'),
				eq(userMemory.timesReinforced, 1),
				lt(userMemory.createdAt, cutoff),
			),
		);
	for (const entry of stale) {
		await db.delete(userMemory).where(eq(userMemory.id, entry.id));
	}
	return stale.length;
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

Example:
[
  { "category": "correction", "content": "The 'Submit' button is at the bottom of the form, not in the header" },
  { "category": "preference", "content": "Always export data as CSV, never JSON" },
  { "category": "terminology", "content": "When user says 'the report', they mean the Weekly Sales Report on /reports/weekly" },
  { "category": "workflow", "content": "User always filters by date range before exporting invoices" }
]

Return valid JSON only.`;

/**
 * Extract user-specific learnings from a conversation and save to user memory.
 * Called in the background after each conversation, alongside domain memory updates.
 */
export async function extractAndSaveUserMemory(
	userId: string,
	domain: string,
	conversationTranscript: string,
	provider: LLMProvider,
	fastModel: string,
): Promise<void> {
	const stream = provider.chat({
		model: fastModel,
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
		learnings = JSON.parse(text);
	} catch {
		console.warn('[UserMemory] Failed to parse learnings:', text.slice(0, 200));
		return;
	}

	if (!Array.isArray(learnings) || learnings.length === 0) return;

	// Prune stale entries before adding new ones
	await pruneStaleMemories(userId, domain);

	// Save each learning
	for (const learning of learnings) {
		const category = learning.category as MemoryCategory;
		if (!['preference', 'correction', 'terminology', 'workflow'].includes(category)) continue;
		if (!learning.content?.trim()) continue;

		await saveUserMemory(userId, domain, category, learning.content.trim(), 'auto');
	}

	console.log(`[UserMemory] Saved ${learnings.length} learnings for user on ${domain}`);
}
