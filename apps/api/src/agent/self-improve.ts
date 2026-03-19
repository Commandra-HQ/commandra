/**
 * Self-improvement loop — post-execution analysis that appends to
 * SKILLS.md, LEARNINGS.md, and ERRORS.md after every non-coordinator agent run.
 * Also records runs in the agent_runs table.
 */

import type { AgentConfig } from '@afe/shared';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import { downloadAgentFile, uploadAgentFile } from '../storage/agent-files.js';
import type { ToolCallRecord } from './orchestrator.js';

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
 * Analyze an agent run and append new insights to SKILLS.md, LEARNINGS.md, ERRORS.md.
 * Runs in the background — never propagates errors.
 */
export async function analyzeAndImprove(params: {
	userId: string;
	agentConfig: AgentConfig;
	toolCalls: ToolCallRecord[];
	transcript: string;
	duration: number;
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

Return JSON with three arrays:
- skills: new techniques that worked well (for SKILLS.md)
- learnings: corrections or discoveries about the domain/app (for LEARNINGS.md)
- errors: failure patterns to avoid in the future (for ERRORS.md)

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

		let analysis: { skills?: string[]; learnings?: string[]; errors?: string[] };
		try {
			analysis = JSON.parse(text.trim());
		} catch {
			console.warn('[SelfImprove] Failed to parse analysis JSON:', text.slice(0, 200));
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

		console.log(
			`[SelfImprove] Agent "${agentConfig.slug}": +${analysis.skills?.length ?? 0} skills, +${analysis.learnings?.length ?? 0} learnings, +${analysis.errors?.length ?? 0} errors`,
		);
	} catch (err) {
		console.warn('[SelfImprove] Analysis failed (non-critical):', err);
	}
}

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

	const updated = existing
		? `${existing.trimEnd()}\n${newLines.join('\n')}\n`
		: `# ${filename.replace('.md', '')}\n\n${newLines.join('\n')}\n`;

	await uploadAgentFile(userId, agentSlug, filename, updated);
}
