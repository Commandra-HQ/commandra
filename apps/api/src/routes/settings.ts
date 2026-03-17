import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { userSettings } from '../db/schema.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const settingsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

settingsRoutes.use('*', requireAuth);

function maskKey(key: string | null | undefined): string {
	if (!key) return '';
	return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

settingsRoutes.get('/', async (c) => {
	const user = c.get('user');

	const [settings] = await db
		.select({
			llmProvider: userSettings.llmProvider,
			llmApiKey: userSettings.llmApiKey,
			llmModelStrong: userSettings.llmModelStrong,
			llmModelFast: userSettings.llmModelFast,
			embeddingProvider: userSettings.embeddingProvider,
			embeddingApiKey: userSettings.embeddingApiKey,
			embeddingModel: userSettings.embeddingModel,
		})
		.from(userSettings)
		.where(eq(userSettings.userId, user.id))
		.limit(1);

	const masked = settings
		? {
				...settings,
				llmApiKey: maskKey(settings.llmApiKey),
				embeddingApiKey: maskKey(settings.embeddingApiKey),
			}
		: null;

	return c.json({ settings: masked });
});

settingsRoutes.put('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const {
		llmProvider,
		llmApiKey,
		llmModelStrong,
		llmModelFast,
		embeddingProvider,
		embeddingApiKey,
		embeddingModel,
	} = body as {
		llmProvider?: string;
		llmApiKey?: string;
		llmModelStrong?: string;
		llmModelFast?: string;
		embeddingProvider?: string;
		embeddingApiKey?: string;
		embeddingModel?: string;
	};

	const values = {
		userId: user.id,
		llmProvider: llmProvider || 'anthropic',
		llmApiKey: llmApiKey || null,
		llmModelStrong: llmModelStrong || 'sonnet',
		llmModelFast: llmModelFast || 'haiku',
		embeddingProvider: embeddingProvider || 'voyage',
		embeddingApiKey: embeddingApiKey || null,
		embeddingModel: embeddingModel || 'voyage-3.5',
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
				embeddingProvider: values.embeddingProvider,
				embeddingApiKey: values.embeddingApiKey,
				embeddingModel: values.embeddingModel,
				updatedAt: values.updatedAt,
			},
		});

	return c.json({ ok: true });
});
