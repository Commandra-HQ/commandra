/**
 * Plan file storage — persists execution plans per conversation in Supabase Storage.
 *
 * Bucket: `agents` (reuses existing), path: `{userId}/plans/{conversationId}/PLAN.md`
 */

import { getSupabase } from './supabase.js';

const BUCKET = 'agents';

export interface StoredPlan {
	description: string;
	steps: {
		label: string;
		status: 'pending' | 'in_progress' | 'completed' | 'failed';
		error?: string;
	}[];
}

function planPath(userId: string, conversationId: string): string {
	return `${userId}/plans/${conversationId}/PLAN.md`;
}

function planToMarkdown(plan: StoredPlan): string {
	const lines: string[] = ['# Plan', ''];
	if (plan.description) {
		lines.push(plan.description, '');
	}
	lines.push('## Steps', '');
	for (const step of plan.steps) {
		const icon =
			step.status === 'completed'
				? '[x]'
				: step.status === 'failed'
					? '[!]'
					: step.status === 'in_progress'
						? '[~]'
						: '[ ]';
		const suffix = step.error ? ` — ${step.error}` : '';
		lines.push(`- ${icon} ${step.label}${suffix}`);
	}
	lines.push('', `<!-- data:${JSON.stringify(plan)} -->`);
	return lines.join('\n');
}

function markdownToPlan(md: string): StoredPlan | null {
	const match = md.match(/<!-- data:(.*?) -->/s);
	if (!match) return null;
	try {
		return JSON.parse(match[1]) as StoredPlan;
	} catch {
		return null;
	}
}

export async function savePlan(
	userId: string,
	conversationId: string,
	plan: StoredPlan,
): Promise<void> {
	const supabase = getSupabase();
	const path = planPath(userId, conversationId);
	const content = planToMarkdown(plan);

	const { error } = await supabase.storage
		.from(BUCKET)
		.upload(path, content, { upsert: true, contentType: 'text/plain' });

	if (error) throw new Error(`Failed to save plan: ${error.message}`);
}

export async function loadPlan(
	userId: string,
	conversationId: string,
): Promise<StoredPlan | null> {
	const supabase = getSupabase();
	const path = planPath(userId, conversationId);

	const { data, error } = await supabase.storage.from(BUCKET).download(path);
	if (error) {
		if (error.message?.includes('not found') || error.message?.includes('Not Found')) {
			return null;
		}
		throw new Error(`Failed to load plan: ${error.message}`);
	}

	const md = await data.text();
	return markdownToPlan(md);
}

export async function updatePlanStep(
	userId: string,
	conversationId: string,
	stepIndex: number,
	status: 'in_progress' | 'completed' | 'failed',
	error?: string,
): Promise<StoredPlan | null> {
	const plan = await loadPlan(userId, conversationId);
	if (!plan || stepIndex < 0 || stepIndex >= plan.steps.length) return null;

	plan.steps[stepIndex].status = status;
	if (error) plan.steps[stepIndex].error = error;

	await savePlan(userId, conversationId, plan);
	return plan;
}
