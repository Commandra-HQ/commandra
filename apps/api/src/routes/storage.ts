import { Hono } from 'hono';
import { type AuthUser, requireAuth } from '../middleware/auth.js';
import {
	type StorageCategory,
	deleteLocalFile,
	getLocalFile,
	getStorageStats,
	listLocalFiles,
} from '../storage/local.js';

export const storageRoutes = new Hono<{ Variables: { user: AuthUser } }>();

storageRoutes.use('*', requireAuth);

const VALID_CATEGORIES = ['screenshots', 'exports', 'context'];

// GET /api/storage/stats
storageRoutes.get('/stats', async (c) => {
	const stats = getStorageStats();
	return c.json(stats);
});

// GET /api/storage/:category - list files
storageRoutes.get('/:category', async (c) => {
	const category = c.req.param('category');
	if (!VALID_CATEGORIES.includes(category)) {
		return c.json({ error: 'Invalid category' }, 400);
	}
	const domain = c.req.query('domain');
	const files = listLocalFiles(category as StorageCategory, domain || undefined);
	return c.json({ files });
});

// GET /api/storage/:category/* - read/download file
storageRoutes.get('/:category/:domain/:filename', async (c) => {
	const category = c.req.param('category');
	const domain = c.req.param('domain');
	const filename = c.req.param('filename');
	if (!VALID_CATEGORIES.includes(category)) {
		return c.json({ error: 'Invalid category' }, 400);
	}

	const filePath = `${category}/${domain}/${filename}`;
	const data = getLocalFile(filePath);
	if (!data) {
		return c.json({ error: 'File not found' }, 404);
	}

	// Set appropriate content type
	const ext = filename.split('.').pop()?.toLowerCase();
	const contentTypes: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		json: 'application/json',
		txt: 'text/plain',
		csv: 'text/csv',
		md: 'text/markdown',
	};

	c.header('Content-Type', contentTypes[ext || ''] || 'application/octet-stream');
	c.header('Content-Disposition', `attachment; filename="${filename}"`);
	return new Response(new Uint8Array(data), { headers: c.res.headers });
});

// DELETE /api/storage/:category/:domain/:filename
storageRoutes.delete('/:category/:domain/:filename', async (c) => {
	const category = c.req.param('category');
	const domain = c.req.param('domain');
	const filename = c.req.param('filename');
	if (!VALID_CATEGORIES.includes(category)) {
		return c.json({ error: 'Invalid category' }, 400);
	}

	const filePath = `${category}/${domain}/${filename}`;
	const deleted = deleteLocalFile(filePath);
	if (!deleted) {
		return c.json({ error: 'File not found or could not be deleted' }, 404);
	}
	return c.json({ ok: true });
});
