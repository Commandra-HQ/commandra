/**
 * Agent CRUD routes — manage agents and their files.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
	createAgent,
	deleteAgent,
	listAgents,
	loadAgent,
	updateAgent,
} from '../agent/agent-registry.js';
import { runAgentNow } from '../agent/scheduler.js';
import { db } from '../db/index.js';
import { agentRuns, agents, scheduledTasks } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { downloadAgentFile, listAgentFiles, uploadAgentFile } from '../storage/agent-files.js';
import { downloadRunLog, listRunLogs } from '../storage/run-files.js';
import { paginateArray, parsePagination } from '../utils/pagination.js';

export const agentRoutes = new Hono<{ Variables: { user: AuthUser } }>();

agentRoutes.use('*', requireAuth);

// List all agents (paginated)
agentRoutes.get('/', async (c) => {
	const user = c.get('user');
	const pagination = parsePagination(c);
	const allAgents = await listAgents(user.id);
	const { data, total } = paginateArray(allAgents, pagination);
	return c.json({ agents: data, total });
});

// Create agent
agentRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { slug, name, description, model, maxIterations, tools, domains, trigger, autonomy } =
		body as {
			slug: string;
			name: string;
			description?: string;
			model?: string;
			maxIterations?: number;
			tools?: string[];
			domains?: string[];
			trigger?: { cron?: string; enabled?: boolean };
			autonomy?: 'supervised' | 'trusted' | 'autonomous';
		};

	if (!slug?.trim() || !name?.trim()) {
		return c.json({ error: 'slug and name are required' }, 400);
	}

	if (!/^[a-z0-9_-]+$/.test(slug)) {
		return c.json({ error: 'slug must be lowercase alphanumeric with hyphens/underscores' }, 400);
	}

	const agent = await createAgent(user.id, {
		slug,
		name,
		description,
		model,
		maxIterations,
		tools,
		domains,
		trigger,
		autonomy,
		orgId: user.orgId,
	});

	return c.json({ agent }, 201);
});

// --- Run log routes (before /:id to avoid catch-all) ---

// List S3 run logs by date (all agents)
agentRoutes.get('/runs/:date', async (c) => {
	const user = c.get('user');
	const date = c.req.param('date');

	// Validate date format
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return c.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, 400);
	}

	const logs = await listRunLogs(user.id, date);
	return c.json({ logs });
});

// Download specific S3 run log
agentRoutes.get('/runs/:date/:filename', async (c) => {
	const user = c.get('user');
	const date = c.req.param('date');
	const filename = c.req.param('filename');

	const content = await downloadRunLog(user.id, date, filename);
	if (content === null) return c.json({ error: 'Run log not found' }, 404);

	return c.text(content);
});

// --- Agent CRUD routes ---

// Get agent (hydrated with files)
agentRoutes.get('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const agent = await loadAgent(agentId, user.id);

	if (!agent) return c.json({ error: 'Agent not found' }, 404);
	return c.json({ agent });
});

// Update agent metadata
agentRoutes.put('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const body = await c.req.json();
	const { name, description, model, maxIterations, tools, domains, trigger, autonomy } = body as {
		name?: string;
		description?: string;
		model?: string;
		maxIterations?: number;
		tools?: string[];
		domains?: string[];
		trigger?: { cron?: string; enabled?: boolean };
		autonomy?: 'supervised' | 'trusted' | 'autonomous';
	};

	const agent = await updateAgent(agentId, user.id, {
		name,
		description,
		model,
		maxIterations,
		tools,
		domains,
		trigger,
		autonomy,
	});

	if (!agent) return c.json({ error: 'Agent not found' }, 404);
	return c.json({ agent });
});

// Delete agent + files
agentRoutes.delete('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const deleted = await deleteAgent(agentId, user.id);

	if (!deleted) return c.json({ error: 'Agent not found' }, 404);
	return c.json({ success: true });
});

// Upload agent file (SOUL.md, SKILLS.md, LEARNINGS.md, etc.)
agentRoutes.put('/:id/files/:filename', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const filename = c.req.param('filename');

	const agent = await loadAgent(agentId, user.id);
	if (!agent) return c.json({ error: 'Agent not found' }, 404);

	const content = await c.req.text();
	if (!content) return c.json({ error: 'File content required' }, 400);

	await uploadAgentFile(user.id, agent.slug, filename, content);
	return c.json({ success: true, filename });
});

// Download agent file
agentRoutes.get('/:id/files/:filename', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const filename = c.req.param('filename');

	const agent = await loadAgent(agentId, user.id);
	if (!agent) return c.json({ error: 'Agent not found' }, 404);

	const content = await downloadAgentFile(user.id, agent.slug, filename);
	if (content === null) return c.json({ error: 'File not found' }, 404);

	return c.text(content);
});

// List agent files
agentRoutes.get('/:id/files', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const agent = await loadAgent(agentId, user.id);
	if (!agent) return c.json({ error: 'Agent not found' }, 404);

	const files = await listAgentFiles(user.id, agent.slug);
	return c.json({ files });
});

// List runs for a specific agent (from Postgres)
agentRoutes.get('/:id/runs', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const { limit, offset } = parsePagination(c, { limit: 20 });

	const where = and(eq(agentRuns.agentId, agentId), eq(agentRuns.userId, user.id));

	const [totalResult] = await db.select({ count: count() }).from(agentRuns).where(where);

	const runs = await db
		.select()
		.from(agentRuns)
		.where(where)
		.orderBy(desc(agentRuns.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({ runs, total: totalResult?.count ?? 0 });
});

// Run agent now (manual trigger)
agentRoutes.post('/:id/run-now', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const result = await runAgentNow(agentId, user.id);
	if ('error' in result) return c.json(result, 400);
	return c.json(result);
});

// List all scheduled agents with their latest run
agentRoutes.get('/scheduled', async (c) => {
	const user = c.get('user');
	const allAgents = await listAgents(user.id);
	const scheduled = allAgents.filter(
		(a) => (a.trigger as { cron?: string } | null)?.cron,
	);

	// Get latest run for each scheduled agent
	const result = await Promise.all(
		scheduled.map(async (agent) => {
			const [latestRun] = await db
				.select()
				.from(agentRuns)
				.where(eq(agentRuns.agentId, agent.id))
				.orderBy(desc(agentRuns.createdAt))
				.limit(1);
			return { ...agent, latestRun: latestRun ?? null };
		}),
	);

	// Also get one-time scheduled tasks
	const tasks = await db
		.select({
			id: scheduledTasks.id,
			agentId: scheduledTasks.agentId,
			task: scheduledTasks.task,
			runAt: scheduledTasks.runAt,
			status: scheduledTasks.status,
			error: scheduledTasks.error,
			createdAt: scheduledTasks.createdAt,
		})
		.from(scheduledTasks)
		.where(eq(scheduledTasks.userId, user.id))
		.orderBy(desc(scheduledTasks.runAt))
		.limit(20);

	return c.json({ data: result, tasks });
});
