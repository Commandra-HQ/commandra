import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { organizations, orgMembers, users } from '../db/schema.js';

export const tokenRoutes = new Hono();

/**
 * Exchange an external auth token for a long-lived extension JWT.
 *
 * This is the bridge for external auth providers (Clerk, OIDC, etc.).
 * The external provider verifies the token and passes us { externalId, email }.
 * Optionally includes { orgExternalId, orgName, role } for org context.
 *
 * In cloud mode, the website repo calls this after verifying a Clerk session.
 * In enterprise mode, an OIDC callback handler calls this after verifying the IdP token.
 *
 * For simple self-hosted deployments, use /api/auth/login instead.
 */
tokenRoutes.post('/exchange', async (c) => {
	const { externalId, email, orgExternalId, orgName, role } = await c.req.json<{
		externalId: string;
		email: string;
		orgExternalId?: string;
		orgName?: string;
		role?: string;
	}>();
	if (!externalId || !email) {
		return c.json({ error: 'externalId and email required' }, 400);
	}

	try {
		// Upsert user by externalId
		const [dbUser] = await db
			.insert(users)
			.values({ externalId, email })
			.onConflictDoUpdate({ target: users.externalId, set: { email } })
			.returning();

		// Build JWT payload
		const jwtPayload: Record<string, string> = {
			userId: dbUser.id,
			email,
		};

		// If org info provided, upsert org and membership
		if (orgExternalId) {
			const slug = (orgName || orgExternalId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

			const [org] = await db
				.insert(organizations)
				.values({
					externalId: orgExternalId,
					name: orgName || orgExternalId,
					slug,
				})
				.onConflictDoUpdate({
					target: organizations.externalId,
					set: { name: orgName || orgExternalId },
				})
				.returning();

			// Upsert membership
			const memberRole = role || 'member';
			const [existingMember] = await db
				.select()
				.from(orgMembers)
				.where(eq(orgMembers.orgId, org.id))
				.limit(1);

			// Check if this user already has a membership
			const existingUserMember = existingMember
				? await db
						.select()
						.from(orgMembers)
						.where(eq(orgMembers.userId, dbUser.id))
						.limit(1)
				: [];

			if (existingUserMember.length > 0 && existingUserMember[0].orgId === org.id) {
				// Update role if changed
				await db
					.update(orgMembers)
					.set({ role: memberRole })
					.where(eq(orgMembers.id, existingUserMember[0].id));
			} else if (!existingUserMember.length || existingUserMember[0].orgId !== org.id) {
				await db.insert(orgMembers).values({
					orgId: org.id,
					userId: dbUser.id,
					role: memberRole,
				}).onConflictDoNothing();
			}

			jwtPayload.orgId = org.id;
			jwtPayload.role = memberRole;
		}

		// Issue a long-lived JWT (30 days)
		const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
		const jwt = await new SignJWT(jwtPayload)
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('30d')
			.sign(secret);

		return c.json({ token: jwt, userId: dbUser.id, email });
	} catch (err) {
		console.error('Token exchange failed:', err);
		return c.json({ error: 'Token exchange failed' }, 500);
	}
});
