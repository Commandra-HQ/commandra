import { Hono } from 'hono';

export const chatRoutes = new Hono();

// Placeholder — agent orchestration will wire in here
chatRoutes.post('/', async (c) => {
	const body = await c.req.json();
	return c.json({
		message: 'Chat endpoint ready. Agent SDK integration coming next.',
		received: body,
	});
});
