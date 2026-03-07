import { createMiddleware } from 'hono/factory';
import { verifyToken } from '@clerk/backend';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AuthUser {
	id: string;
	clerkId: string;
	email: string;
}

export const requireAuth = createMiddleware<{ Variables: { user: AuthUser } }>(
	async (c, next) => {
		const token = c.req.header('Authorization')?.replace('Bearer ', '');
		if (!token) return c.json({ error: 'Unauthorized' }, 401);

		try {
			const payload = await verifyToken(token, {
				secretKey: process.env.CLERK_SECRET_KEY!,
				authorizedParties: ['http://localhost:3000'],
			});

			const [dbUser] = await db
				.select()
				.from(users)
				.where(eq(users.clerkId, payload.sub))
				.limit(1);

			if (!dbUser) return c.json({ error: 'User not found' }, 401);

			c.set('user', { id: dbUser.id, clerkId: payload.sub, email: dbUser.email });
			await next();
		} catch {
			return c.json({ error: 'Unauthorized' }, 401);
		}
	},
);
