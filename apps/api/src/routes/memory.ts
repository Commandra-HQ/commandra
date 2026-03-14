/**
 * Memory management API routes — CRUD for user adaptive memory.
 */

import { Hono } from 'hono';
import {
	type MemoryCategory,
	clearUserMemoryForDomain,
	deleteUserMemoryById,
	editUserMemory,
	listUserMemories,
	saveUserMemory,
} from '../memory/user.js';
import { type AuthUser, requireAuth } from '../middleware/auth.js';

export const memoryRoutes = new Hono<{ Variables: { user: AuthUser } }>();

memoryRoutes.use('*', requireAuth);

// List all memories (optionally filtered by domain)
memoryRoutes.get('/', async (c) => {
	const user = c.get('user');
	const domain = c.req.query('domain');
	const entries = await listUserMemories(user.id, domain || undefined);

	// Group by domain for the response
	const byDomain: Record<string, typeof entries> = {};
	for (const entry of entries) {
		// We need the domain from the DB — extend query if needed
		// For now, if domain filter is set, use it; otherwise group won't have domain
		const key = domain || 'all';
		if (!byDomain[key]) byDomain[key] = [];
		byDomain[key].push(entry);
	}

	return c.json({ memories: entries });
});

// Add a memory explicitly
memoryRoutes.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json();
	const { domain, category, content } = body as {
		domain: string;
		category: MemoryCategory;
		content: string;
	};

	if (!domain?.trim()) return c.json({ error: 'Domain required' }, 400);
	if (!content?.trim()) return c.json({ error: 'Content required' }, 400);
	if (!['preference', 'correction', 'terminology', 'workflow'].includes(category)) {
		return c.json({ error: 'Invalid category' }, 400);
	}

	await saveUserMemory(user.id, domain, category, content, 'explicit');
	return c.json({ ok: true });
});

// Edit a memory
memoryRoutes.put('/:id', async (c) => {
	const user = c.get('user');
	const memoryId = c.req.param('id');
	const body = await c.req.json();
	const { content } = body as { content: string };

	if (!content?.trim()) return c.json({ error: 'Content required' }, 400);

	const updated = await editUserMemory(user.id, memoryId, content);
	if (!updated) return c.json({ error: 'Memory not found' }, 404);
	return c.json({ ok: true });
});

// Delete a single memory
memoryRoutes.delete('/:id', async (c) => {
	const user = c.get('user');
	const memoryId = c.req.param('id');
	const deleted = await deleteUserMemoryById(user.id, memoryId);
	if (!deleted) return c.json({ error: 'Memory not found' }, 404);
	return c.json({ ok: true });
});

// Clear all memories for a domain
memoryRoutes.delete('/domain/:domain', async (c) => {
	const user = c.get('user');
	const domain = c.req.param('domain');
	await clearUserMemoryForDomain(user.id, domain);
	return c.json({ ok: true });
});
