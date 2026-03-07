import { Hono } from 'hono';
import { jwtVerify } from 'jose';

export const authRoutes = new Hono();

/**
 * Verify an extension JWT and return user info.
 * Used by the extension on startup to check if the stored token is still valid.
 */
authRoutes.get('/me', async (c) => {
	const token = c.req.header('Authorization')?.replace('Bearer ', '');
	if (!token) return c.json({ error: 'Unauthorized' }, 401);

	try {
		const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
		const { payload } = await jwtVerify(token, secret);

		return c.json({
			id: payload.userId,
			clerkId: payload.clerkId,
			email: payload.email,
		});
	} catch {
		return c.json({ error: 'Unauthorized' }, 401);
	}
});
