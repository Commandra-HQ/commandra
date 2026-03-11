import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export const tokenRoutes = new Hono();

/**
 * Exchange an external auth token for a long-lived extension JWT.
 *
 * This is the bridge for external auth providers (Clerk, OIDC, etc.).
 * The external provider verifies the token and passes us { externalId, email }.
 * In cloud mode, the website repo calls this after verifying a Clerk session.
 * In enterprise mode, an OIDC callback handler calls this after verifying the IdP token.
 *
 * For simple self-hosted deployments, use /api/auth/login instead.
 */
tokenRoutes.post('/exchange', async (c) => {
	const { externalId, email } = await c.req.json<{ externalId: string; email: string }>();
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

		// Issue a long-lived JWT (30 days)
		const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
		const jwt = await new SignJWT({
			userId: dbUser.id,
			email,
		})
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
