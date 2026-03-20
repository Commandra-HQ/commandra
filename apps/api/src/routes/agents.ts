/**
 * Agent CRUD routes — manage agents and their files.
 */

import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
	createAgent,
	deleteAgent,
	listAgents,
	loadAgent,
	updateAgent,
} from '../agent/agent-registry.js';
import { db } from '../db/index.js';
import { agentRuns } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { downloadAgentFile, listAgentFiles, uploadAgentFile } from '../storage/agent-files.js';
import { downloadRunLog, listRunLogs } from '../storage/run-files.js';

export const agentRoutes = new Hono<{ Variables: { user: AuthUser } }>();

agentRoutes.use('*', requireAuth);

// List all agents
agentRoutes.get('/', async (c) => {
	const user = c.get('user');
	const agents = await listAgents(user.id);
	return c.json({ agents });
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
	const { name, description, model, maxIterations, tools, domains, trigger, autonomy } =
		body as {
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
	const limit = Math.min(Number.parseInt(c.req.query('limit') || '20', 10), 100);
	const offset = Number.parseInt(c.req.query('offset') || '0', 10);

	const runs = await db
		.select()
		.from(agentRuns)
		.where(and(eq(agentRuns.agentId, agentId), eq(agentRuns.userId, user.id)))
		.orderBy(desc(agentRuns.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({ runs });
});
