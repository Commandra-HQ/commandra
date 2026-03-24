/**
 * Self-improvement loop — post-execution analysis that appends to
 * SKILLS.md, LEARNINGS.md, and ERRORS.md after every non-coordinator agent run.
 * Also records runs in the agent_runs table.
 *
 * Includes deduplication, pruning, and LLM-powered consolidation to prevent
 * unbounded file growth.
 */

import type { AgentConfig } from '@afe/shared';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import { downloadAgentFile, uploadAgentFile } from '../storage/agent-files.js';
import { downloadDomainFile, uploadDomainFile } from '../storage/domain-files.js';
import { writeRunLog } from '../storage/run-files.js';
import { normalizeEntry, similarity } from '../utils/text-similarity.js';
import type { ToolCallRecord } from './orchestrator.js';

// Defaults — overrideable per agent via agentConfig.limits.selfImproveCap
const DEFAULT_SOFT_CAP = 40; // Trigger consolidation
const DEFAULT_HARD_CAP = 60; // Force-trim oldest before append
const DEFAULT_TARGET = 30; // Post-consolidation target

/**
 * Insert a row into the agent_runs table.
 */
export async function recordAgentRun(params: {
	agentId: string;
	userId: string;
	conversationId?: string;
	status: 'running' | 'completed' | 'failed';
	toolCalls?: number;
	tokensUsed?: number;
	durationMs?: number;
	error?: string;
}): Promise<void> {
	try {
		await db.insert(agentRuns).values({
			agentId: params.agentId,
			userId: params.userId,
			conversationId: params.conversationId,
			status: params.status,
			toolCalls: params.toolCalls ?? 0,
			tokensUsed: params.tokensUsed ?? 0,
			durationMs: params.durationMs,
			error: params.error,
		});
	} catch (err) {
		console.warn('[SelfImprove] Failed to record agent run:', err);
	}
}

/**
 * Consolidate a file's entries using the fast model.
 */
async function consolidateFile(
	userId: string,
	agentSlug: string,
	filename: string,
	entries: string[],
): Promise<void> {
	try {
		const provider = getProvider();
		const model = getFastModel();

		const stream = provider.chat({
			model,
			system:
				'You are a concise editor. Return only a list of entries, one per line, starting with "- ".',
			messages: [
				{
					role: 'user',
					content: `Merge these ${entries.length} entries into the ${DEFAULT_TARGET} most valuable. Remove duplicates, merge overlapping entries, drop outdated ones. Keep the most specific and actionable entries.\n\nEntries:\n${entries.join('\n')}`,
				},
			],
			maxTokens: 2000,
		});

		const response = await collectStream(stream);
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { text: string }).text)
			.join('');

		const consolidated = text
			.split('\n')
			.filter((l) => l.trim().startsWith('- '))
			.slice(0, DEFAULT_TARGET);

		if (consolidated.length === 0) return;

		const today = new Date().toISOString().slice(0, 10);
		const header = `# ${filename.replace('.md', '')}`;
		const content = `${header}\n\n${consolidated.join('\n')}\n\n<!-- consolidated: ${today} -->\n`;

		await uploadAgentFile(userId, agentSlug, filename, content);
		console.log(
			`[SelfImprove] Consolidated ${filename} for ${agentSlug}: ${entries.length} → ${consolidated.length} entries`,
		);
	} catch (err) {
		console.warn(`[SelfImprove] Consolidation failed for ${filename}:`, err);
	}
}

/**
 * Analyze an agent run and append new insights to SKILLS.md, LEARNINGS.md, ERRORS.md.
 * Only writes an S3 run log when the AI found something noteworthy — no mechanical per-run logging.
 * Runs in the background — never propagates errors.
 */
export async function analyzeAndImprove(params: {
	userId: string;
	agentConfig: AgentConfig;
	toolCalls: ToolCallRecord[];
	transcript: string;
	duration: number;
	domain?: string;
	conversationId?: string;
}): Promise<void> {
	try {
		const { userId, agentConfig, toolCalls, transcript } = params;

		// Build tool call summary
		const toolSummary = toolCalls
			.map((t) => `${t.name}: ${t.success ? 'success' : 'failed'}`)
			.join('\n');

		const provider = getProvider();
		const model = getFastModel();

		const analysisPrompt = `Analyze this agent run. Agent: "${agentConfig.name}" — ${agentConfig.description}.

Transcript (last messages):
${transcript.slice(-3000)}

Tool calls:
${toolSummary || 'None'}

Return JSON with these fields:
- skills: new techniques that worked well (array of strings, for SKILLS.md)
- learnings: corrections or discoveries about the domain/app (array of strings, for LEARNINGS.md)
- errors: failure patterns to avoid in the future (array of strings, for ERRORS.md)
- summary: a 1-2 sentence summary of what happened and what was accomplished. Only include this if the run did something meaningful (completed a task, learned something, hit an interesting failure). Set to null for routine/trivial runs.

Only include genuinely new and useful insights. Return empty arrays if nothing new.
Respond ONLY with valid JSON, no markdown fencing.`;

		const stream = provider.chat({
			model,
			system: 'You are a concise analysis assistant. Return only valid JSON.',
			messages: [{ role: 'user', content: analysisPrompt }],
			maxTokens: 1000,
		});

		const response = await collectStream(stream);
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { text: string }).text)
			.join('');

		let analysis: {
			skills?: string[];
			learnings?: string[];
			errors?: string[];
			summary?: string | null;
		};
		try {
			let jsonText = text.trim();
			if (jsonText.startsWith('```')) {
				jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
			}
			analysis = JSON.parse(jsonText);
		} catch {
			if (text.trim()) {
				console.warn('[SelfImprove] Failed to parse analysis JSON:', text.slice(0, 200));
			}
			return;
		}

		const today = new Date().toISOString().slice(0, 10);

		// Append to each file if there are new entries
		if (analysis.skills?.length) {
			await appendToAgentFile(
				userId,
				agentConfig.slug,
				'SKILLS.md',
				analysis.skills.map((s) => `- [${today}] ${s}`),
			);
		}
		if (analysis.learnings?.length) {
			await appendToAgentFile(
				userId,
				agentConfig.slug,
				'LEARNINGS.md',
				analysis.learnings.map((l) => `- [${today}] ${l}`),
			);
		}
		if (analysis.errors?.length) {
			await appendToAgentFile(
				userId,
				agentConfig.slug,
				'ERRORS.md',
				analysis.errors.map((e) => `- [${today}] ${e}`),
			);
		}

		const insightCount =
			(analysis.skills?.length ?? 0) +
			(analysis.learnings?.length ?? 0) +
			(analysis.errors?.length ?? 0);

		// Update MEMORY.md with a concise run summary (agent's own notes)
		if (analysis.summary && insightCount > 0) {
			await appendToAgentFile(
				userId,
				agentConfig.slug,
				'MEMORY.md',
				[`- [${today}] ${analysis.summary}`],
			);
		}

		console.log(
			`[SelfImprove] Agent "${agentConfig.slug}": +${analysis.skills?.length ?? 0} skills, +${analysis.learnings?.length ?? 0} learnings, +${analysis.errors?.length ?? 0} errors`,
		);

		// Write S3 run log only when the AI found something worth recording
		if (analysis.summary && params.conversationId) {
			writeRunLog(userId, {
				agent: agentConfig.name,
				agentSlug: agentConfig.slug,
				domain: params.domain,
				status: 'completed',
				toolCalls: toolCalls.length,
				durationMs: params.duration,
				conversationId: params.conversationId,
				summary: analysis.summary,
				insights:
					insightCount > 0
						? {
								skills: analysis.skills?.length ?? 0,
								learnings: analysis.learnings?.length ?? 0,
								errors: analysis.errors?.length ?? 0,
							}
						: undefined,
			}).catch((err) => console.warn('[RunLog] writeRunLog failed:', err));
		}

		// Update domain AGENTS.md (fire-and-forget)
		if (params.domain) {
			updateDomainAgentsFile(userId, params.domain, agentConfig).catch(() => {});
		}
	} catch (err) {
		console.warn('[SelfImprove] Analysis failed (non-critical):', err);
	}
}

/**
 * Append lines to an agent file with deduplication and pruning.
 */
async function appendToAgentFile(
	userId: string,
	agentSlug: string,
	filename: string,
	newLines: string[],
): Promise<void> {
	let existing = '';
	try {
		const content = await downloadAgentFile(userId, agentSlug, filename);
		if (content) existing = content;
	} catch {
		// File doesn't exist yet — will create
	}

	// Extract existing entries
	const existingEntries = existing.split('\n').filter((l) => l.trim().startsWith('- '));

	// Build set of normalized existing entries for dedup
	const normalizedExisting = existingEntries.map(normalizeEntry);

	// Filter out duplicates from new lines
	const dedupedNewLines: string[] = [];
	for (const line of newLines) {
		const norm = normalizeEntry(line);
		if (!norm) continue;

		// Skip exact normalized match
		if (normalizedExisting.includes(norm)) continue;

		// Skip if too similar to any existing entry
		const tooSimilar = normalizedExisting.some((ex) => similarity(norm, ex) > 0.8);
		if (tooSimilar) continue;

		// Also check against already-accepted new lines
		const tooSimilarToNew = dedupedNewLines.some(
			(nl) => similarity(norm, normalizeEntry(nl)) > 0.8,
		);
		if (tooSimilarToNew) continue;

		dedupedNewLines.push(line);
	}

	if (dedupedNewLines.length === 0) return;

	const allEntries = [...existingEntries, ...dedupedNewLines];

	// Check if consolidation is needed
	if (allEntries.length > DEFAULT_SOFT_CAP) {
		await consolidateFile(userId, agentSlug, filename, allEntries);
		return;
	}

	// Hard cap: drop oldest entries if too many
	const trimmedEntries =
		allEntries.length > DEFAULT_HARD_CAP ? allEntries.slice(allEntries.length - DEFAULT_HARD_CAP) : allEntries;

	const header = `# ${filename.replace('.md', '')}`;
	const updated = `${header}\n\n${trimmedEntries.join('\n')}\n`;
	await uploadAgentFile(userId, agentSlug, filename, updated);
}

/**
 * Update domain AGENTS.md with info about which agents operate on this domain.
 */
async function updateDomainAgentsFile(
	userId: string,
	domain: string,
	agentConfig: AgentConfig,
): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	const content = await downloadDomainFile(userId, domain, 'AGENTS.md');

	interface AgentEntry {
		slug: string;
		name: string;
		lastRun: string;
		runs: number;
		description: string;
	}

	let agents: AgentEntry[] = [];

	if (content) {
		// Parse existing entries (format: "- **slug** (name) — description | Last: YYYY-MM-DD | Runs: N")
		const lines = content.split('\n').filter((l) => l.trim().startsWith('- **'));
		for (const line of lines) {
			const slugMatch = line.match(/\*\*([^*]+)\*\*/);
			const nameMatch = line.match(/\(([^)]+)\)/);
			const lastMatch = line.match(/Last: (\d{4}-\d{2}-\d{2})/);
			const runsMatch = line.match(/Runs: (\d+)/);
			const descMatch = line.match(/— ([^|]+)/);
			if (slugMatch) {
				agents.push({
					slug: slugMatch[1],
					name: nameMatch?.[1] || slugMatch[1],
					lastRun: lastMatch?.[1] || today,
					runs: Number.parseInt(runsMatch?.[1] || '0', 10),
					description: descMatch?.[1]?.trim() || '',
				});
			}
		}
	}

	// Upsert this agent
	const idx = agents.findIndex((a) => a.slug === agentConfig.slug);
	if (idx >= 0) {
		agents[idx].lastRun = today;
		agents[idx].runs += 1;
		agents[idx].name = agentConfig.name;
		agents[idx].description = agentConfig.description || '';
	} else {
		agents.push({
			slug: agentConfig.slug,
			name: agentConfig.name,
			lastRun: today,
			runs: 1,
			description: agentConfig.description || '',
		});
	}

	// Cap at 20 agents, keep most recently run
	agents.sort((a, b) => b.lastRun.localeCompare(a.lastRun));
	agents = agents.slice(0, 20);

	const lines = ['# Domain Agents', ''];
	for (const a of agents) {
		lines.push(
			`- **${a.slug}** (${a.name}) — ${a.description} | Last: ${a.lastRun} | Runs: ${a.runs}`,
		);
	}
	lines.push('');

	await uploadDomainFile(userId, domain, 'AGENTS.md', lines.join('\n'));
}
