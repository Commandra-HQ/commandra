import type { FlowStep } from '@afe/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runFlowExecution } from '../agent/flow-executor.js';
import { db } from '../db/index.js';
import { flowRuns, flows, sites } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import { getConnectionByUser, resetKill } from '../ws/handler.js';

export const flowRoutes = new Hono<{ Variables: { user: AuthUser } }>();

flowRoutes.use('*', requireAuth);

// List flows (optionally filter by domain)
flowRoutes.get('/', async (c) => {
	const user = c.get('user');
	const domain = c.req.query('domain');

	const rows = await db
		.select({
			id: flows.id,
			name: flows.name,
			description: flows.description,
			status: flows.status,
			steps: flows.steps,
			parameters: flows.parameters,
			lastRunAt: flows.lastRunAt,
			createdAt: flows.createdAt,
			domain: sites.domain,
		})
		.from(flows)
		.innerJoin(sites, eq(flows.siteId, sites.id))
		.where(eq(flows.userId, user.id))
		.orderBy(desc(flows.updatedAt));

	const filtered = domain ? rows.filter((r) => r.domain === domain) : rows;

	return c.json({
		flows: filtered.map((r) => ({
			...r,
			stepCount: (r.steps as unknown[])?.length ?? 0,
		})),
	});
});

// Get flow detail
flowRoutes.get('/:id', async (c) => {
	const user = c.get('user');
	const flowId = c.req.param('id');

	const [flow] = await db
		.select({
			id: flows.id,
			name: flows.name,
			description: flows.description,
			status: flows.status,
			steps: flows.steps,
			parameters: flows.parameters,
			lastRunAt: flows.lastRunAt,
			createdAt: flows.createdAt,
			updatedAt: flows.updatedAt,
			domain: sites.domain,
		})
		.from(flows)
		.innerJoin(sites, eq(flows.siteId, sites.id))
		.where(eq(flows.id, flowId))
		.limit(1);

	if (!flow) return c.json({ error: 'Not found' }, 404);

	// Check ownership via the flows table
	const [owned] = await db
		.select({ userId: flows.userId })
		.from(flows)
		.where(eq(flows.id, flowId))
		.limit(1);
	if (owned?.userId !== user.id) return c.json({ error: 'Not found' }, 404);

	// Get recent runs
	const runs = await db
		.select({
			id: flowRuns.id,
			status: flowRuns.status,
			stepsCompleted: flowRuns.stepsCompleted,
			totalSteps: flowRuns.totalSteps,
			error: flowRuns.error,
			startedAt: flowRuns.startedAt,
			completedAt: flowRuns.completedAt,
		})
		.from(flowRuns)
		.where(eq(flowRuns.flowId, flowId))
		.orderBy(desc(flowRuns.startedAt))
		.limit(5);

	return c.json({ flow, runs });
});

// Create flow
flowRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { name, description, domain, steps, parameters } = body as {
		name: string;
		description?: string;
		domain: string;
		steps: FlowStep[];
		parameters?: unknown[];
	};

	if (!name?.trim() || !domain?.trim() || !steps?.length) {
		return c.json({ error: 'name, domain, and steps are required' }, 400);
	}

	// Find or create site for this domain
	let [site] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);

	if (!site) {
		[site] = await db
			.insert(sites)
			.values({ userId: user.id, domain })
			.returning();
	}

	const [flow] = await db
		.insert(flows)
		.values({
			userId: user.id,
			siteId: site.id,
			name: name.trim(),
			description: description?.trim() || null,
			steps,
			parameters: parameters || [],
			status: 'ready',
		})
		.returning();

	return c.json({ flow }, 201);
});

// Update flow
flowRoutes.put('/:id', async (c) => {
	const user = c.get('user');
	const flowId = c.req.param('id');
	const body = await c.req.json();

	const [existing] = await db.select().from(flows).where(eq(flows.id, flowId)).limit(1);
	if (!existing || existing.userId !== user.id) return c.json({ error: 'Not found' }, 404);

	const { name, description, steps, parameters, status } = body as {
		name?: string;
		description?: string;
		steps?: FlowStep[];
		parameters?: unknown[];
		status?: string;
	};

	await db
		.update(flows)
		.set({
			...(name && { name: name.trim() }),
			...(description !== undefined && { description: description?.trim() || null }),
			...(steps && { steps }),
			...(parameters && { parameters }),
			...(status && { status }),
			updatedAt: new Date(),
		})
		.where(eq(flows.id, flowId));

	return c.json({ ok: true });
});

// Delete flow
flowRoutes.delete('/:id', async (c) => {
	const user = c.get('user');
	const flowId = c.req.param('id');

	const [existing] = await db.select().from(flows).where(eq(flows.id, flowId)).limit(1);
	if (!existing || existing.userId !== user.id) return c.json({ error: 'Not found' }, 404);

	// Delete runs first (FK constraint)
	await db.delete(flowRuns).where(eq(flowRuns.flowId, flowId));
	await db.delete(flows).where(eq(flows.id, flowId));

	return c.json({ ok: true });
});

// Execute flow (SSE stream)
flowRoutes.post('/:id/run', async (c) => {
	const user = c.get('user');
	const flowId = c.req.param('id');
	const body = await c.req.json();
	const { parameterValues } = body as { parameterValues?: Record<string, string> };

	const [flow] = await db.select().from(flows).where(eq(flows.id, flowId)).limit(1);
	if (!flow || flow.userId !== user.id) return c.json({ error: 'Not found' }, 404);

	const connectionId = getConnectionByUser(user.id);
	if (!connectionId) return c.json({ error: 'Extension not connected' }, 400);

	resetKill(connectionId);

	const flowSteps = flow.steps as FlowStep[];
	const signal = c.req.raw.signal;

	// Create the flow run record
	const [run] = await db
		.insert(flowRuns)
		.values({
			flowId,
			userId: user.id,
			parameterValues: parameterValues || {},
			status: 'running',
			totalSteps: flowSteps.length,
		})
		.returning();

	// Get site domain for context
	const [site] = await db.select().from(sites).where(eq(sites.id, flow.siteId)).limit(1);

	return streamSSE(c, async (stream) => {
		const onEvent = async (event: unknown) => {
			if (signal.aborted) return;
			const e = event as { type: string };
			await stream.writeSSE({ event: e.type, data: JSON.stringify(event) });
		};

		try {
			await runFlowExecution({
				userId: user.id,
				connectionId,
				flowRunId: run.id,
				flowSteps,
				parameters: (flow.parameters as unknown[]) || [],
				parameterValues: parameterValues || {},
				domain: site?.domain || '',
				onEvent,
				signal,
			});
		} catch (err) {
			if (!signal.aborted) {
				console.error('Flow execution error:', err);
				await onEvent({ type: 'error', message: 'Flow execution failed' });
			}
		}
	});
});

// List runs for a flow
flowRoutes.get('/:id/runs', async (c) => {
	const user = c.get('user');
	const flowId = c.req.param('id');

	const [flow] = await db
		.select({ userId: flows.userId })
		.from(flows)
		.where(eq(flows.id, flowId))
		.limit(1);
	if (!flow || flow.userId !== user.id) return c.json({ error: 'Not found' }, 404);

	const runs = await db
		.select()
		.from(flowRuns)
		.where(eq(flowRuns.flowId, flowId))
		.orderBy(desc(flowRuns.startedAt))
		.limit(20);

	return c.json({ runs });
});
