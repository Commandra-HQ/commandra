import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { orgMembers, organizations, users } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const orgRoutes = new Hono<{ Variables: { user: AuthUser } }>();

orgRoutes.use('*', requireAuth);

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

	// Check admin
	const [membership] = await db
		.select()
		.from(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
		.limit(1);
	if (!membership || membership.role !== 'admin') {
		return c.json({ error: 'Admin access required' }, 403);
	}

	// Find user by email
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

	if (!role || !['admin', 'member', 'viewer'].includes(role)) {
		return c.json({ error: 'Valid role required (admin, member, viewer)' }, 400);
	}

	// Check admin
	const [membership] = await db
		.select()
		.from(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
		.limit(1);
	if (!membership || membership.role !== 'admin') {
		return c.json({ error: 'Admin access required' }, 403);
	}

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

	// Check admin
	const [membership] = await db
		.select()
		.from(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
		.limit(1);
	if (!membership || membership.role !== 'admin') {
		return c.json({ error: 'Admin access required' }, 403);
	}

	// Prevent removing self
	if (targetUserId === user.id) {
		return c.json({ error: 'Cannot remove yourself' }, 400);
	}

	const result = await db
		.delete(orgMembers)
		.where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
		.returning();

	if (!result.length) return c.json({ error: 'Member not found' }, 404);
	return c.json({ ok: true });
});
