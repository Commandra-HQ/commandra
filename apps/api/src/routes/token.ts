import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { verifyToken, createClerkClient } from '@clerk/backend';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let _clerk: ReturnType<typeof createClerkClient> | null = null;
function getClerk() {
	if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
	return _clerk;
}

export const tokenRoutes = new Hono();

/**
 * Exchange a short-lived Clerk session token for a long-lived extension JWT.
 * Called by the dashboard when user clicks "Generate Extension Token."
 */
tokenRoutes.post('/exchange', async (c) => {
	const { clerkToken } = await c.req.json<{ clerkToken: string }>();
	if (!clerkToken) return c.json({ error: 'clerkToken required' }, 400);

	try {
		// Verify the Clerk token
		const payload = await verifyToken(clerkToken, {
			secretKey: process.env.CLERK_SECRET_KEY!,
			authorizedParties: ['http://localhost:3000'],
		});

		// Get/create user
		const clerkUser = await getClerk().users.getUser(payload.sub);
		const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';

		const [dbUser] = await db
			.insert(users)
			.values({ clerkId: clerkUser.id, email })
			.onConflictDoUpdate({ target: users.clerkId, set: { email } })
			.returning();

		// Issue a long-lived JWT (30 days)
		const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
		const jwt = await new SignJWT({
			userId: dbUser.id,
			clerkId: clerkUser.id,
			email,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setExpirationTime('30d')
			.sign(secret);

		return c.json({ token: jwt, userId: dbUser.id, email });
	} catch (err) {
		console.error('Token exchange failed:', err);
		return c.json({ error: 'Invalid Clerk token' }, 401);
	}
});
