import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';

export const authRoutes = new Hono();

/**
 * Verify a JWT and return user info.
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
			email: payload.email,
		});
	} catch {
		return c.json({ error: 'Unauthorized' }, 401);
	}
});

/**
 * Register a new user with email + password.
 * For self-hosted / OSS deployments.
 */
authRoutes.post('/register', async (c) => {
	const { email, password } = await c.req.json<{ email: string; password: string }>();
	if (!email || !password) return c.json({ error: 'Email and password required' }, 400);
	if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

	try {
		// Hash password using Web Crypto API (no extra dependency)
		const passwordHash = await hashPassword(password);

		const [user] = await db
			.insert(users)
			.values({ email, passwordHash })
			.onConflictDoNothing()
			.returning();

		if (!user) return c.json({ error: 'Email already registered' }, 409);

		const token = await issueJwt(user.id, email);
		return c.json({ token, userId: user.id, email });
	} catch (err) {
		console.error('Registration failed:', err);
		return c.json({ error: 'Registration failed' }, 500);
	}
});

/**
 * Login with email + password.
 * Returns a long-lived JWT for the dashboard and extension.
 */
authRoutes.post('/login', async (c) => {
	const { email, password } = await c.req.json<{ email: string; password: string }>();
	if (!email || !password) return c.json({ error: 'Email and password required' }, 400);

	try {
		const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (!user || !user.passwordHash) return c.json({ error: 'Invalid credentials' }, 401);

		const valid = await verifyPassword(password, user.passwordHash);
		if (!valid) return c.json({ error: 'Invalid credentials' }, 401);

		const token = await issueJwt(user.id, email);
		return c.json({ token, userId: user.id, email });
	} catch (err) {
		console.error('Login failed:', err);
		return c.json({ error: 'Login failed' }, 500);
	}
});

// --- Helpers ---

async function issueJwt(userId: string, email: string): Promise<string> {
	const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
	return new SignJWT({ userId, email })
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime('30d')
		.sign(secret);
}

async function hashPassword(password: string): Promise<string> {
	const encoder = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
		'deriveBits',
	]);
	const hash = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
		keyMaterial,
		256,
	);
	const saltHex = Buffer.from(salt).toString('hex');
	const hashHex = Buffer.from(hash).toString('hex');
	return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [saltHex, hashHex] = stored.split(':');
	const salt = Buffer.from(saltHex, 'hex');
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
		'deriveBits',
	]);
	const hash = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
		keyMaterial,
		256,
	);
	return Buffer.from(hash).toString('hex') === hashHex;
}
