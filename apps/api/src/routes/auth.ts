import { Hono } from 'hono';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const clerk = createClerkClient({
	secretKey: process.env.CLERK_SECRET_KEY!,
});

export const authRoutes = new Hono();

async function getClerkUser(c: any) {
	const token = c.req.header('Authorization')?.replace('Bearer ', '');
	if (!token) return null;
	try {
		const payload = await verifyToken(token, {
			secretKey: process.env.CLERK_SECRET_KEY!,
		});
		return await clerk.users.getUser(payload.sub);
	} catch {
		return null;
	}
}

authRoutes.get('/me', async (c) => {
	const clerkUser = await getClerkUser(c);
	if (!clerkUser) return c.json({ error: 'Unauthorized' }, 401);

	const [dbUser] = await db.select().from(users).where(eq(users.clerkId, clerkUser.id)).limit(1);

	return c.json({
		id: dbUser?.id,
		clerkId: clerkUser.id,
		email: clerkUser.emailAddresses[0]?.emailAddress,
	});
});

authRoutes.post('/sync', async (c) => {
	const clerkUser = await getClerkUser(c);
	if (!clerkUser) return c.json({ error: 'Unauthorized' }, 401);

	const email = clerkUser.emailAddresses[0]?.emailAddress;
	if (!email) return c.json({ error: 'No email on Clerk account' }, 400);

	const [existing] = await db
		.select()
		.from(users)
		.where(eq(users.clerkId, clerkUser.id))
		.limit(1);

	if (existing) {
		return c.json({ id: existing.id, email: existing.email, created: false });
	}

	const [newUser] = await db
		.insert(users)
		.values({ clerkId: clerkUser.id, email })
		.returning();

	return c.json({ id: newUser.id, email: newUser.email, created: true });
});
