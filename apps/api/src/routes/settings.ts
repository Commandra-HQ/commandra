import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const settingsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

settingsRoutes.use('*', requireAuth);

settingsRoutes.get('/', async (c) => {
	const user = c.get('user');

	const [settings] = await db
		.select({
			llmProvider: userSettings.llmProvider,
			llmApiKey: userSettings.llmApiKey,
			llmModelStrong: userSettings.llmModelStrong,
			llmModelFast: userSettings.llmModelFast,
		})
		.from(userSettings)
		.where(eq(userSettings.userId, user.id))
		.limit(1);

	// Mask the API key for security
	const masked = settings
		? {
				...settings,
				llmApiKey: settings.llmApiKey
					? `${settings.llmApiKey.slice(0, 8)}...${settings.llmApiKey.slice(-4)}`
					: '',
			}
		: null;

	return c.json({ settings: masked });
});

settingsRoutes.put('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { llmProvider, llmApiKey, llmModelStrong, llmModelFast } = body as {
		llmProvider?: string;
		llmApiKey?: string;
		llmModelStrong?: string;
		llmModelFast?: string;
	};

	const values = {
		userId: user.id,
		llmProvider: llmProvider || 'anthropic',
		llmApiKey: llmApiKey || null,
		llmModelStrong: llmModelStrong || 'sonnet',
		llmModelFast: llmModelFast || 'haiku',
		updatedAt: new Date(),
	};

	await db
		.insert(userSettings)
		.values(values)
		.onConflictDoUpdate({
			target: userSettings.userId,
			set: {
				llmProvider: values.llmProvider,
				llmApiKey: values.llmApiKey,
				llmModelStrong: values.llmModelStrong,
				llmModelFast: values.llmModelFast,
				updatedAt: values.updatedAt,
			},
		});

	return c.json({ ok: true });
});
