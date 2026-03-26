import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { orgMembers, organizations, users } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const orgRoutes = new Hono<{ Variables: { user: AuthUser } }>();

orgRoutes.use('*', requireAuth);

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:3003';
const SYNC_SECRET = process.env.SYNC_SECRET;

/** Check if an org is Clerk-managed (has externalId). Returns org row or null. */
async function getOrg(orgId: string) {
	const [org] = await db
		.select({ id: organizations.id, externalId: organizations.externalId })
		.from(organizations)
		.where(eq(organizations.id, orgId))
		.limit(1);
	return org || null;
}

/** Get a user's externalId by their internal UUID. */
async function getUserExternalId(userId: string): Promise<string | null> {
	const [u] = await db
		.select({ externalId: users.externalId })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	return u?.externalId || null;
}

/** Proxy a request to the landing page's Clerk member management API. */
async function clerkProxy(
	method: 'POST' | 'PUT' | 'DELETE',
	body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
	const res = await fetch(`${LANDING_URL}/api/org/members`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			'X-Sync-Secret': SYNC_SECRET || '',
		},
		body: JSON.stringify(body),
	});
	const data = await res.json();
	return { ok: res.ok, status: res.status, data };
}

/** Verify user is admin of the org. Returns membership or null. */
async function requireAdmin(orgId: string, userId: string) {
	const [membership] = await db
		.select()
		.from(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
		.limit(1);
	if (!membership || membership.role !== 'admin') return null;
	return membership;
}

// List user's orgs
orgRoutes.get('/', async (c) => {
	const user = c.get('user');

	const rows = await db
		.select({
			id: organizations.id,
			name: organizations.name,
			slug: organizations.slug,
			role: orgMembers.role,
			createdAt: organizations.createdAt,
		})
		.from(orgMembers)
		.innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
		.where(eq(orgMembers.userId, user.id));

	return c.json({ orgs: rows });
});

// Create org (creator becomes admin)
orgRoutes.post('/', async (c) => {
	const user = c.get('user');
	const { name } = await c.req.json<{ name: string }>();
	if (!name?.trim()) return c.json({ error: 'name required' }, 400);

	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');

	try {
		const [org] = await db.insert(organizations).values({ name: name.trim(), slug }).returning();

		await db.insert(orgMembers).values({
			orgId: org.id,
			userId: user.id,
			role: 'admin',
		});

		return c.json({ org }, 201);
	} catch (err) {
		console.error('Create org failed:', err);
		return c.json({ error: 'Org creation failed (slug may already exist)' }, 409);
	}
});

// List members
orgRoutes.get('/:id/members', async (c) => {
	const user = c.get('user');
	const orgId = c.req.param('id');

	// Verify user is a member of this org
	const [membership] = await db
		.select()
		.from(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
		.limit(1);
	if (!membership) return c.json({ error: 'Not found' }, 404);

	const members = await db
		.select({
			id: orgMembers.id,
			userId: orgMembers.userId,
			role: orgMembers.role,
			email: users.email,
			createdAt: orgMembers.createdAt,
		})
		.from(orgMembers)
		.innerJoin(users, eq(orgMembers.userId, users.id))
		.where(eq(orgMembers.orgId, orgId));

	return c.json({ members, total: members.length });
});

// Invite member by email (admin only)
orgRoutes.post('/:id/members', async (c) => {
	const user = c.get('user');
	const orgId = c.req.param('id');
	const { email, role } = await c.req.json<{ email: string; role?: string }>();

	if (!email?.trim()) return c.json({ error: 'email required' }, 400);

	if (!(await requireAdmin(orgId, user.id))) {
		return c.json({ error: 'Admin access required' }, 403);
	}

	const org = await getOrg(orgId);
	if (!org) return c.json({ error: 'Org not found' }, 404);

	// Clerk-managed: proxy to landing page → Clerk API
	if (org.externalId) {
		const inviterExternalUserId = await getUserExternalId(user.id);
		const result = await clerkProxy('POST', {
			orgExternalId: org.externalId,
			email: email.trim(),
			role: role || 'member',
			inviterExternalUserId,
		});
		return c.json(result.data, result.status as 200);
	}

	// Self-hosted: add directly to DB
	const [targetUser] = await db.select().from(users).where(eq(users.email, email.trim())).limit(1);
	if (!targetUser) return c.json({ error: 'User not found' }, 404);

	try {
		await db.insert(orgMembers).values({
			orgId,
			userId: targetUser.id,
			role: role || 'member',
		});
		return c.json({ ok: true }, 201);
	} catch {
		return c.json({ error: 'User already a member' }, 409);
	}
});

// Change member role (admin only)
orgRoutes.put('/:id/members/:userId', async (c) => {
	const user = c.get('user');
	const orgId = c.req.param('id');
	const targetUserId = c.req.param('userId');
	const { role } = await c.req.json<{ role: string }>();

	if (!role || !['admin', 'member'].includes(role)) {
		return c.json({ error: 'Valid role required (admin, member)' }, 400);
	}

	if (!(await requireAdmin(orgId, user.id))) {
		return c.json({ error: 'Admin access required' }, 403);
	}

	const org = await getOrg(orgId);
	if (!org) return c.json({ error: 'Org not found' }, 404);

	// Clerk-managed: proxy to landing page → Clerk API
	if (org.externalId) {
		const userExternalId = await getUserExternalId(targetUserId);
		if (!userExternalId) return c.json({ error: 'User not found' }, 404);

		const result = await clerkProxy('PUT', {
			orgExternalId: org.externalId,
			userExternalId,
			role,
		});
		return c.json(result.data, result.status as 200);
	}

	// Self-hosted: update directly in DB
	const result = await db
		.update(orgMembers)
		.set({ role })
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
		.returning();

	if (!result.length) return c.json({ error: 'Member not found' }, 404);
	return c.json({ ok: true });
});

// Remove member (admin only)
orgRoutes.delete('/:id/members/:userId', async (c) => {
	const user = c.get('user');
	const orgId = c.req.param('id');
	const targetUserId = c.req.param('userId');

	if (!(await requireAdmin(orgId, user.id))) {
		return c.json({ error: 'Admin access required' }, 403);
	}

	// Prevent removing self
	if (targetUserId === user.id) {
		return c.json({ error: 'Cannot remove yourself' }, 400);
	}

	const org = await getOrg(orgId);
	if (!org) return c.json({ error: 'Org not found' }, 404);

	// Clerk-managed: proxy to landing page → Clerk API
	if (org.externalId) {
		const userExternalId = await getUserExternalId(targetUserId);
		if (!userExternalId) return c.json({ error: 'User not found' }, 404);

		const result = await clerkProxy('DELETE', {
			orgExternalId: org.externalId,
			userExternalId,
		});
		return c.json(result.data, result.status as 200);
	}

	// Self-hosted: delete directly from DB
	const result = await db
		.delete(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
		.returning();

	if (!result.length) return c.json({ error: 'Member not found' }, 404);
	return c.json({ ok: true });
});
