/**
 * Agent CRUD + marketplace routes.
 */

import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { agentInstalls, agentRatings, agents, users } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const agentRoutes = new Hono<{ Variables: { user: AuthUser } }>();

agentRoutes.use('*', requireAuth);

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
}

/** List user's agents (created + installed) */
agentRoutes.get('/', async (c) => {
	const user = c.get('user');

	const [created, installed] = await Promise.all([
		db
			.select()
			.from(agents)
			.where(eq(agents.userId, user.id))
			.orderBy(desc(agents.updatedAt)),
		db
			.select({
				id: agentInstalls.id,
				agentId: agentInstalls.agentId,
				settings: agentInstalls.settings,
				installedAt: agentInstalls.installedAt,
				agent: {
					id: agents.id,
					name: agents.name,
					slug: agents.slug,
					description: agents.description,
					icon: agents.icon,
					category: agents.category,
					domains: agents.domains,
					installs: agents.installs,
					status: agents.status,
				},
			})
			.from(agentInstalls)
			.innerJoin(agents, eq(agentInstalls.agentId, agents.id))
			.where(eq(agentInstalls.userId, user.id))
			.orderBy(desc(agentInstalls.installedAt)),
	]);

	return c.json({ created, installed });
});

/** Get agent detail */
agentRoutes.get('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const [agent] = await db
		.select({
			id: agents.id,
			userId: agents.userId,
			orgId: agents.orgId,
			name: agents.name,
			slug: agents.slug,
			description: agents.description,
			instructions: agents.instructions,
			domains: agents.domains,
			tools: agents.tools,
			safetyRules: agents.safetyRules,
			icon: agents.icon,
			category: agents.category,
			tags: agents.tags,
			isPublic: agents.isPublic,
			version: agents.version,
			forkedFrom: agents.forkedFrom,
			installs: agents.installs,
			status: agents.status,
			createdAt: agents.createdAt,
			updatedAt: agents.updatedAt,
			authorEmail: users.email,
		})
		.from(agents)
		.innerJoin(users, eq(agents.userId, users.id))
		.where(eq(agents.id, agentId))
		.limit(1);

	if (!agent) return c.json({ error: 'Agent not found' }, 404);

	// Only allow viewing if: owner, or public
	if (agent.userId !== user.id && !agent.isPublic) {
		return c.json({ error: 'Not authorized' }, 403);
	}

	// Get ratings
	const ratings = await db
		.select({
			id: agentRatings.id,
			rating: agentRatings.rating,
			review: agentRatings.review,
			createdAt: agentRatings.createdAt,
		})
		.from(agentRatings)
		.where(eq(agentRatings.agentId, agentId))
		.orderBy(desc(agentRatings.createdAt))
		.limit(20);

	const avgRating =
		ratings.length > 0
			? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
			: null;

	return c.json({
		...agent,
		author: { id: agent.userId, email: agent.authorEmail },
		ratings,
		avgRating,
	});
});

/** Create agent */
agentRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { name, description, instructions, domains, tools, safetyRules, icon, category, tags } =
		body as {
			name: string;
			description?: string;
			instructions: string;
			domains?: string[];
			tools?: string[];
			safetyRules?: { allowWrite?: boolean; allowDelete?: boolean };
			icon?: string;
			category?: string;
			tags?: string[];
		};

	if (!name?.trim()) return c.json({ error: 'Name required' }, 400);
	if (!instructions?.trim()) return c.json({ error: 'Instructions required' }, 400);

	// Generate unique slug
	let slug = slugify(name);
	const existing = await db
		.select({ id: agents.id })
		.from(agents)
		.where(eq(agents.slug, slug))
		.limit(1);
	if (existing.length > 0) {
		slug = `${slug}-${Date.now().toString(36)}`;
	}

	const [agent] = await db
		.insert(agents)
		.values({
			userId: user.id,
			orgId: user.orgId || undefined,
			name: name.trim(),
			slug,
			description: description?.trim() || '',
			instructions: instructions.trim(),
			domains: domains || [],
			tools: tools || ['*'],
			safetyRules: safetyRules || {},
			icon: icon || '',
			category: category || 'other',
			tags: tags || [],
		})
		.returning();

	return c.json(agent, 201);
});

/** Update agent */
agentRoutes.put('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const body = await c.req.json();

	// Verify ownership
	const [existing] = await db
		.select({ userId: agents.userId })
		.from(agents)
		.where(eq(agents.id, agentId))
		.limit(1);

	if (!existing) return c.json({ error: 'Agent not found' }, 404);
	if (existing.userId !== user.id) return c.json({ error: 'Not authorized' }, 403);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	const allowed = [
		'name',
		'description',
		'instructions',
		'domains',
		'tools',
		'safetyRules',
		'icon',
		'category',
		'tags',
		'version',
	] as const;

	for (const key of allowed) {
		if (body[key] !== undefined) {
			updates[key] = body[key];
		}
	}

	const [updated] = await db
		.update(agents)
		.set(updates)
		.where(eq(agents.id, agentId))
		.returning();

	return c.json(updated);
});

/** Delete agent */
agentRoutes.delete('/:id', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const [existing] = await db
		.select({ userId: agents.userId })
		.from(agents)
		.where(eq(agents.id, agentId))
		.limit(1);

	if (!existing) return c.json({ error: 'Agent not found' }, 404);
	if (existing.userId !== user.id) return c.json({ error: 'Not authorized' }, 403);

	await db.delete(agents).where(eq(agents.id, agentId));
	return c.json({ ok: true });
});

/** Publish agent to marketplace */
agentRoutes.post('/:id/publish', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const [existing] = await db
		.select({ userId: agents.userId, status: agents.status })
		.from(agents)
		.where(eq(agents.id, agentId))
		.limit(1);

	if (!existing) return c.json({ error: 'Agent not found' }, 404);
	if (existing.userId !== user.id) return c.json({ error: 'Not authorized' }, 403);

	const [updated] = await db
		.update(agents)
		.set({ isPublic: true, status: 'published', updatedAt: new Date() })
		.where(eq(agents.id, agentId))
		.returning();

	return c.json(updated);
});

/** Fork a public agent */
agentRoutes.post('/:id/fork', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const [original] = await db
		.select()
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.isPublic, true)))
		.limit(1);

	if (!original) return c.json({ error: 'Agent not found or not public' }, 404);

	const slug = `${original.slug}-fork-${Date.now().toString(36)}`;

	const [forked] = await db
		.insert(agents)
		.values({
			userId: user.id,
			orgId: user.orgId || undefined,
			name: `${original.name} (fork)`,
			slug,
			description: original.description || '',
			instructions: original.instructions,
			domains: (original.domains as string[]) || [],
			tools: (original.tools as string[]) || ['*'],
			safetyRules: (original.safetyRules as { allowWrite?: boolean; allowDelete?: boolean }) || {},
			icon: original.icon || '',
			category: original.category || 'other',
			tags: (original.tags as string[]) || [],
			forkedFrom: original.id,
			status: 'draft',
		})
		.returning();

	return c.json(forked, 201);
});

/** Browse marketplace — public agents */
agentRoutes.get('/marketplace', async (c) => {
	const query = c.req.query('q');
	const category = c.req.query('category');
	const sort = c.req.query('sort') || 'installs'; // installs | rating | newest
	const limit = Math.min(Number(c.req.query('limit')) || 20, 50);
	const offset = Number(c.req.query('offset')) || 0;

	const conditions = [eq(agents.isPublic, true), eq(agents.status, 'published')];

	if (category) {
		conditions.push(eq(agents.category, category));
	}
	if (query) {
		conditions.push(
			or(
				ilike(agents.name, `%${query}%`),
				ilike(agents.description, `%${query}%`),
			)!,
		);
	}

	const orderBy =
		sort === 'newest'
			? desc(agents.createdAt)
			: sort === 'rating'
				? desc(agents.installs) // TODO: sort by avg rating when we add that
				: desc(agents.installs);

	const results = await db
		.select({
			id: agents.id,
			name: agents.name,
			slug: agents.slug,
			description: agents.description,
			icon: agents.icon,
			category: agents.category,
			domains: agents.domains,
			tags: agents.tags,
			installs: agents.installs,
			version: agents.version,
			authorEmail: users.email,
			authorId: users.id,
			createdAt: agents.createdAt,
		})
		.from(agents)
		.innerJoin(users, eq(agents.userId, users.id))
		.where(and(...conditions))
		.orderBy(orderBy)
		.limit(limit)
		.offset(offset);

	return c.json({
		agents: results.map((r) => ({
			...r,
			author: { id: r.authorId, email: r.authorEmail },
		})),
	});
});

/** Install a public agent */
agentRoutes.post('/:id/install', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const [agent] = await db
		.select({ id: agents.id, isPublic: agents.isPublic })
		.from(agents)
		.where(eq(agents.id, agentId))
		.limit(1);

	if (!agent || !agent.isPublic) return c.json({ error: 'Agent not found or not public' }, 404);

	// Check if already installed
	const [existing] = await db
		.select({ id: agentInstalls.id })
		.from(agentInstalls)
		.where(and(eq(agentInstalls.agentId, agentId), eq(agentInstalls.userId, user.id)))
		.limit(1);

	if (existing) return c.json({ error: 'Already installed' }, 400);

	const [install] = await db
		.insert(agentInstalls)
		.values({ agentId, userId: user.id })
		.returning();

	// Increment install count
	await db
		.update(agents)
		.set({ installs: sql`${agents.installs} + 1` })
		.where(eq(agents.id, agentId));

	return c.json(install, 201);
});

/** Uninstall an agent */
agentRoutes.delete('/:id/install', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');

	const deleted = await db
		.delete(agentInstalls)
		.where(and(eq(agentInstalls.agentId, agentId), eq(agentInstalls.userId, user.id)))
		.returning();

	if (deleted.length > 0) {
		await db
			.update(agents)
			.set({ installs: sql`GREATEST(${agents.installs} - 1, 0)` })
			.where(eq(agents.id, agentId));
	}

	return c.json({ ok: true });
});

/** Rate an agent */
agentRoutes.post('/:id/rate', async (c) => {
	const user = c.get('user');
	const agentId = c.req.param('id');
	const body = await c.req.json();
	const { rating, review } = body as { rating: number; review?: string };

	if (!rating || rating < 1 || rating > 5) {
		return c.json({ error: 'Rating must be 1-5' }, 400);
	}

	// Upsert rating
	const [existing] = await db
		.select({ id: agentRatings.id })
		.from(agentRatings)
		.where(and(eq(agentRatings.agentId, agentId), eq(agentRatings.userId, user.id)))
		.limit(1);

	if (existing) {
		const [updated] = await db
			.update(agentRatings)
			.set({ rating, review: review || null, createdAt: new Date() })
			.where(eq(agentRatings.id, existing.id))
			.returning();
		return c.json(updated);
	}

	const [created] = await db
		.insert(agentRatings)
		.values({ agentId, userId: user.id, rating, review: review || null })
		.returning();

	return c.json(created, 201);
});
