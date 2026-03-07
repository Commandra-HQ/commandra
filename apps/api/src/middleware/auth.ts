import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

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
			const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
			const { payload } = await jwtVerify(token, secret);

			c.set('user', {
				id: payload.userId as string,
				clerkId: payload.clerkId as string,
				email: payload.email as string,
			});
			await next();
		} catch {
			return c.json({ error: 'Unauthorized' }, 401);
		}
	},
);
