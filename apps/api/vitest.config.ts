import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'api',
		include: ['src/**/*.test.ts'],
		// registry → ws/handler → db; db/index validates DATABASE_URL at import time.
		env: {
			DATABASE_URL: 'postgresql://127.0.0.1:1/postgres?sslmode=disable',
		},
	},
});
