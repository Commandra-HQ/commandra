import { Hono } from 'hono';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let _clerk: ReturnType<typeof createClerkClient> | null = null;
function getClerk() {
	if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
	return _clerk;
}

export const authRoutes = new Hono();

async function getClerkUser(c: any) {
	const token = c.req.header('Authorization')?.replace('Bearer ', '');
	if (!token) return null;
	try {
		const payload = await verifyToken(token, {
			secretKey: process.env.CLERK_SECRET_KEY!,
			authorizedParties: ['http://localhost:3000'],
		});
		return await getClerk().users.getUser(payload.sub);
	} catch (err) {
		console.error('Token verification failed:', err);
		return null;
	}
}

authRoutes.get('/me', async (c) => {
	const clerkUser = await getClerkUser(c);
	if (!clerkUser) return c.json({ error: 'Unauthorized' }, 401);

	const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';

	// Auto-upsert: create user on first auth, no separate sync needed
	const [dbUser] = await db
		.insert(users)
		.values({ clerkId: clerkUser.id, email })
		.onConflictDoUpdate({ target: users.clerkId, set: { email } })
		.returning();

	return c.json({
		id: dbUser.id,
		clerkId: clerkUser.id,
		email,
	});
});
