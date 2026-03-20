/**
 * Agent registry — CRUD, resolution, and loading of agents.
 *
 * Default coordinator: hardcoded AgentConfig returned when no agent exists.
 * Zero setup required for existing users.
 */

import type { AgentAutonomy, AgentConfig } from '@afe/shared';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents } from '../db/schema.js';
import { downloadAgentFile, deleteAgentFolder } from '../storage/agent-files.js';

const VALID_AUTONOMY: AgentAutonomy[] = ['supervised', 'trusted', 'autonomous'];

const DEFAULT_COORDINATOR: AgentConfig = {
	id: '_coordinator',
	slug: '_coordinator',
	userId: '',
	name: 'Coordinator',
	description: 'Default agent — general-purpose browser assistant',
};

/**
 * Resolve which agent to use for a request.
 * Priority: explicit agentId > domain match > default coordinator.
 */
export async function resolveAgent(
	userId: string,
	agentId?: string,
	domain?: string,
): Promise<AgentConfig> {
	// Explicit agent ID
	if (agentId && agentId !== '_coordinator') {
		const agent = await loadAgent(agentId, userId);
		if (agent) return agent;
	}

	// Domain match
	if (domain) {
		const userAgents = await db
			.select()
			.from(agents)
			.where(eq(agents.userId, userId));

		for (const agent of userAgents) {
			const domains = agent.domains as string[] | null;
			if (domains?.some((pattern) => matchDomain(pattern, domain))) {
				return await hydrateAgent(agent);
			}
		}
	}

	// Default coordinator
	return { ...DEFAULT_COORDINATOR, userId };
}

/**
 * Load a single agent by ID — DB row + Supabase Storage files (SOUL.md, SKILLS.md, LEARNINGS.md, ERRORS.md).
 */
export async function loadAgent(agentId: string, userId: string): Promise<AgentConfig | null> {
	const [row] = await db
		.select()
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
		.limit(1);

	if (!row) return null;
	return hydrateAgent(row);
}

/**
 * Load a single agent by slug — DB row + Supabase Storage files.
 */
export async function loadAgentBySlug(slug: string, userId: string): Promise<AgentConfig | null> {
	const [row] = await db
		.select()
		.from(agents)
		.where(and(eq(agents.slug, slug), eq(agents.userId, userId)))
		.limit(1);

	if (!row) return null;
	return hydrateAgent(row);
}

/**
 * List all agents for a user (DB only, no file hydration).
 */
export async function listAgents(userId: string): Promise<AgentConfig[]> {
	const rows = await db
		.select()
		.from(agents)
		.where(eq(agents.userId, userId));

	return rows.map((row) => rowToConfig(row));
}

/**
 * Create a new agent — insert DB row.
 * Scheduled agents (cron trigger) must be at least 'trusted' autonomy.
 */
export async function createAgent(
	userId: string,
	config: {
		slug: string;
		name: string;
		description?: string;
		model?: string;
		maxIterations?: number;
		tools?: string[];
		domains?: string[];
		orgId?: string;
		trigger?: { cron?: string; enabled?: boolean };
		autonomy?: AgentAutonomy;
	},
): Promise<AgentConfig> {
	// Scheduled agents must be at least trusted — there's no human to approve actions
	let autonomy = config.autonomy ?? 'supervised';
	if (config.trigger?.cron && autonomy === 'supervised') {
		autonomy = 'trusted';
	}

	const [row] = await db
		.insert(agents)
		.values({
			userId,
			orgId: config.orgId,
			slug: config.slug,
			name: config.name,
			description: config.description ?? '',
			model: config.model,
			maxIterations: config.maxIterations,
			tools: config.tools,
			domains: config.domains,
			trigger: config.trigger,
			autonomy,
		})
		.returning();

	return rowToConfig(row);
}

/**
 * Update agent metadata.
 */
export async function updateAgent(
	agentId: string,
	userId: string,
	partial: Partial<{
		name: string;
		description: string;
		model: string;
		maxIterations: number;
		tools: string[];
		domains: string[];
		trigger: { cron?: string; enabled?: boolean };
		autonomy: AgentAutonomy;
	}>,
): Promise<AgentConfig | null> {
	// Validate autonomy value if provided
	if (partial.autonomy && !VALID_AUTONOMY.includes(partial.autonomy)) {
		partial.autonomy = 'supervised';
	}

	const [row] = await db
		.update(agents)
		.set({ ...partial, updatedAt: new Date() })
		.where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
		.returning();

	if (!row) return null;
	return rowToConfig(row);
}

/**
 * Delete agent — DB row + storage folder.
 */
export async function deleteAgent(agentId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ slug: agents.slug })
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
		.limit(1);

	if (!row) return false;

	await db.delete(agents).where(eq(agents.id, agentId));
	try {
		await deleteAgentFolder(userId, row.slug);
	} catch {
		// Storage cleanup failure is non-critical
	}
	return true;
}

/**
 * Match a domain pattern against a domain.
 * Supports wildcards: `*.github.com` matches `docs.github.com`.
 */
export function matchDomain(pattern: string, domain: string): boolean {
	if (pattern === domain) return true;
	if (pattern.startsWith('*.')) {
		const suffix = pattern.slice(2);
		return domain === suffix || domain.endsWith(`.${suffix}`);
	}
	return false;
}

// --- Internal ---

function parseAutonomy(value: string | null | undefined): AgentAutonomy | undefined {
	if (value && VALID_AUTONOMY.includes(value as AgentAutonomy)) {
		return value as AgentAutonomy;
	}
	return undefined;
}

function rowToConfig(row: typeof agents.$inferSelect): AgentConfig {
	return {
		id: row.id,
		slug: row.slug,
		userId: row.userId,
		name: row.name,
		description: row.description,
		model: row.model ?? undefined,
		maxIterations: row.maxIterations ?? undefined,
		tools: (row.tools as string[] | null) ?? undefined,
		domains: (row.domains as string[] | null) ?? undefined,
		trigger: (row.trigger as { cron?: string; enabled?: boolean } | null) ?? undefined,
		autonomy: parseAutonomy(row.autonomy),
	};
}

async function hydrateAgent(row: typeof agents.$inferSelect): Promise<AgentConfig> {
	const config = rowToConfig(row);

	// Load agent files from Supabase Storage
	try {
		const [soul, skills, learnings, errors] = await Promise.all([
			downloadAgentFile(row.userId, row.slug, 'SOUL.md'),
			downloadAgentFile(row.userId, row.slug, 'SKILLS.md'),
			downloadAgentFile(row.userId, row.slug, 'LEARNINGS.md'),
			downloadAgentFile(row.userId, row.slug, 'ERRORS.md'),
		]);
		if (soul) config.soul = soul;
		if (skills) config.skills = skills;
		if (learnings) config.learnings = learnings;
		if (errors) config.errors = errors;
	} catch {
		// Storage not configured or files don't exist — agent works without them
	}

	return config;
}
