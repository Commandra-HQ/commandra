import { and, eq, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { orgMembers, organizations, users } from '../db/schema.js';

export const syncRoutes = new Hono();

// Auth: shared secret (server-to-server, not user JWT)
syncRoutes.use('*', async (c, next) => {
	const secret = c.req.header('X-Sync-Secret');
	if (!secret || secret !== process.env.SYNC_SECRET) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	await next();
});

/**
 * Full org member sync.
 * Called by the landing-page webhook handler when Clerk org/membership changes.
 * Receives the complete member list and upserts everything — idempotent and self-healing.
 */
syncRoutes.post('/', async (c) => {
	const { externalOrgId, orgName, members } = await c.req.json<{
		externalOrgId: string;
		orgName: string;
		members: { externalUserId: string; email: string; role: string }[];
	}>();

	if (!externalOrgId || !orgName || !Array.isArray(members)) {
		return c.json({ error: 'externalOrgId, orgName, members required' }, 400);
	}

	try {
		// 1. Upsert org
		const slug = orgName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');

		const [org] = await db
			.insert(organizations)
			.values({ externalId: externalOrgId, name: orgName, slug })
			.onConflictDoUpdate({ target: organizations.externalId, set: { name: orgName } })
			.returning();

		// 2. Upsert each member
		const syncedUserIds: string[] = [];
		for (const m of members) {
			const [user] = await db
				.insert(users)
				.values({ externalId: m.externalUserId, email: m.email })
				.onConflictDoUpdate({ target: users.externalId, set: { email: m.email } })
				.returning();

			syncedUserIds.push(user.id);

			const memberRole = m.role === 'admin' ? 'admin' : 'member';
			await db
				.insert(orgMembers)
				.values({ orgId: org.id, userId: user.id, role: memberRole })
				.onConflictDoUpdate({
					target: [orgMembers.orgId, orgMembers.userId],
					set: { role: memberRole },
				});
		}

		// 3. Remove members not in the incoming list
		if (syncedUserIds.length > 0) {
			await db
				.delete(orgMembers)
				.where(and(eq(orgMembers.orgId, org.id), notInArray(orgMembers.userId, syncedUserIds)));
		} else {
			// All members removed — clear org membership
			await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
		}

		return c.json({ ok: true, synced: members.length });
	} catch (err) {
		console.error('Org sync failed:', err);
		return c.json({ error: 'Sync failed' }, 500);
	}
});

/**
 * Delete an org (called when org is deleted in Clerk).
 */
syncRoutes.delete('/', async (c) => {
	const { externalOrgId } = await c.req.json<{ externalOrgId: string }>();

	if (!externalOrgId) {
		return c.json({ error: 'externalOrgId required' }, 400);
	}

	try {
		const [org] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.externalId, externalOrgId))
			.limit(1);

		if (!org) return c.json({ error: 'Org not found' }, 404);

		// Remove all memberships first
		await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
		// Delete org
		await db.delete(organizations).where(eq(organizations.id, org.id));

		return c.json({ ok: true });
	} catch (err) {
		console.error('Org delete failed:', err);
		return c.json({ error: 'Delete failed' }, 500);
	}
});
