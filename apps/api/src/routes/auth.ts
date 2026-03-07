import { Hono } from 'hono';
import { createClerkClient, verifyToken } from '@clerk/backend';

const clerk = createClerkClient({
	secretKey: process.env.CLERK_SECRET_KEY!,
});

export const authRoutes = new Hono();

// Clerk handles sign-up/login via their frontend components.
// This endpoint verifies the session token from the extension.
authRoutes.get('/me', async (c) => {
	const token = c.req.header('Authorization')?.replace('Bearer ', '');
	if (!token) {
		return c.json({ error: 'No token provided' }, 401);
	}

	try {
		const payload = await verifyToken(token, {
			secretKey: process.env.CLERK_SECRET_KEY!,
		});
		const user = await clerk.users.getUser(payload.sub);
		return c.json({ id: user.id, email: user.emailAddresses[0]?.emailAddress });
	} catch {
		return c.json({ error: 'Invalid token' }, 401);
	}
});
