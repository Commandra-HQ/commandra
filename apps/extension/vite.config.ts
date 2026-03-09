import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import manifest from './manifest.json';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '../../', ['VITE_', 'API_']);

	return {
		plugins: [react(), crx({ manifest })],
		define: {
			'process.env.API_URL': JSON.stringify(env.API_URL || 'http://localhost:3001'),
		},
		build: {
			outDir: 'dist',
		},
		server: {
			port: 5173,
			strictPort: true,
			hmr: {
				port: 5173,
			},
		},
	};
});
