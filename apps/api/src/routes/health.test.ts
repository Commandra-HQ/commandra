import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { healthRoutes } from './health.js';

describe('health route', () => {
	const app = new Hono();
	app.route('/health', healthRoutes);

	it('returns 200 with status ok', async () => {
		const res = await app.request('/health');
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.timestamp).toBeDefined();
		expect(typeof body.timestamp).toBe('number');
	});
});
