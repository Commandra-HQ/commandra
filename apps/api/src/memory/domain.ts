/**
 * Per-domain knowledge — S3-backed markdown files.
 *
 * All domain knowledge lives in Supabase Storage:
 *   domains/{userId}/{domain}/KNOWLEDGE.md  — app facts, selectors, quirks
 *   domains/{userId}/{domain}/WORKFLOWS.md  — proven multi-step procedures
 *   domains/{userId}/{domain}/MEMORY.md     — user corrections + preferences (managed by memory/user.ts)
 *
 * The shared Postgres `domain_memory` table is deprecated — each user has their own
 * S3 knowledge, managed by the agent via save_knowledge/read_knowledge tools.
 */

import { collectStream } from '../llm/index.js';
import type { LLMProvider } from '../llm/types.js';
import { downloadDomainFile, uploadDomainFile } from '../storage/domain-files.js';
import { deduplicateLines, normalizeEntry } from '../utils/text-similarity.js';

/**
 * Load domain memory. DEPRECATED — returns null.
 * All domain knowledge is now loaded from S3 via loadDomainKnowledgeFromS3().
 * Kept as a stub for backward compatibility with callers that haven't been updated.
 */
export async function loadDomainMemory(_domain: string): Promise<string | null> {
	return null;
}

// --- S3-backed domain knowledge (per-user) ---

/**
 * Load KNOWLEDGE.md from S3 for a given user + domain.
 * This is the primary source of domain knowledge.
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

// --- Post-conversation sync ---

const SYNC_PROMPT = `You are analyzing a completed browser automation session. Extract knowledge about the web application.

Return a JSON object:
{
  "knowledge": ["fact about the app, selector, behavior, or navigation pattern"],
  "workflows": [{ "name": "workflow name", "steps": ["step 1", "step 2"] }]
}

Only include concrete, specific observations. Empty arrays are fine. Return valid JSON only.`;

/**
 * Sync domain knowledge to S3 after a conversation. Extracts app knowledge
 * and writes to KNOWLEDGE.md and WORKFLOWS.md.
 *
 * User-specific preferences/corrections are handled separately by memory/user.ts.
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
			system: SYNC_PROMPT,
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

		let extracted: { knowledge?: string[]; workflows?: { name: string; steps: string[] }[] };
		try {
			let jsonText = text.trim();
			if (jsonText.startsWith('```')) {
				jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
			}
			extracted = JSON.parse(jsonText);
		} catch {
			if (text.trim()) {
				console.warn('[DomainKnowledge] Failed to parse extraction:', text.slice(0, 200));
			}
			return;
		}

		const today = new Date().toISOString().slice(0, 10);

		// Update KNOWLEDGE.md
		if (extracted.knowledge?.length) {
			const existing = await downloadDomainFile(userId, domain, 'KNOWLEDGE.md');
			const newEntries = extracted.knowledge.map((k) => `- [${today}] ${k}`);

			if (existing) {
				const existingLines = existing.split('\n').filter((l) => l.trim().startsWith('- '));
				const genuinelyNew = deduplicateLines(existingLines, newEntries);
				if (genuinelyNew.length > 0) {
					const allLines = [...existingLines, ...genuinelyNew].slice(-200);
					await uploadDomainFile(userId, domain, 'KNOWLEDGE.md', `# Domain Knowledge\n\n${allLines.join('\n')}\n`);
				}
			} else {
				await uploadDomainFile(userId, domain, 'KNOWLEDGE.md', `# Domain Knowledge\n\n${newEntries.join('\n')}\n`);
			}
		}

		// Append workflows
		if (extracted.workflows?.length) {
			for (const wf of extracted.workflows) {
				if (wf.name && wf.steps?.length) {
					await appendDomainWorkflow(userId, domain, { name: wf.name, steps: wf.steps, source: 'auto-extract' });
				}
			}
		}

		console.log(
			`[DomainKnowledge] Synced S3 for ${domain}: +${extracted.knowledge?.length ?? 0} knowledge, +${extracted.workflows?.length ?? 0} workflows`,
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

		if (existing) {
			const nameNorm = workflow.name.toLowerCase().trim();
			const existingNames = existing.match(/^## Workflow: .+$/gm) || [];
			const isDuplicate = existingNames.some(
				(h) => h.replace('## Workflow: ', '').toLowerCase().trim() === nameNorm,
			);
			if (isDuplicate) return;
			if (existingNames.length >= 30) return;
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
