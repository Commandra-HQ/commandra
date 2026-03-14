import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import manifest from './manifest.json';

function deriveWsUrl(apiUrl: string): string {
	try {
		const u = new URL(apiUrl);
		const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
		// Production often uses same host; WS on 3002 or same port with path. Default: same host, port 3002.
		const port = u.port === '3001' || u.port === '80' || u.port === '443' ? '3002' : u.port;
		return `${protocol}//${u.hostname}:${port}`;
	} catch {
		return 'ws://localhost:3002';
	}
}

export default defineConfig(({ mode }: ConfigEnv) => {
	const env = loadEnv(mode, '../../', ['VITE_', 'API_', 'WS_']);
	const API_URL = process.env.API_URL || env.API_URL || 'http://localhost:3001';
	const WS_URL = process.env.WS_URL || env.WS_URL || deriveWsUrl(API_URL);

	return {
		plugins: [react(), crx({ manifest })],
		define: {
			'process.env.API_URL': JSON.stringify(API_URL),
			'process.env.WS_URL': JSON.stringify(WS_URL),
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
