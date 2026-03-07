import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
	plugins: [react(), crx({ manifest })],
	define: {
		'process.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(
			process.env.VITE_CLERK_PUBLISHABLE_KEY,
		),
		'process.env.API_URL': JSON.stringify(process.env.API_URL || 'http://localhost:3001'),
	},
	build: {
		outDir: 'dist',
	},
});
