import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import manifest from './manifest.json';

function deriveWsUrl(apiUrl: string): string {
	try {
		const u = new URL(apiUrl);
		const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
		// HTTPS (production): same host/port, path /ws. HTTP localhost: use port 3002.
		if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.port === '443' || u.port === ''))) {
			const port = u.port ? `:${u.port}` : '';
			return `${protocol}//${u.hostname}${port}/ws`;
		}
		const port = u.port === '3001' || u.port === '80' ? '3002' : u.port || '3002';
		return `${protocol}//${u.hostname}:${port}`;
	} catch {
		return 'ws://localhost:3002';
	}
}

export default defineConfig(({ mode }: ConfigEnv) => {
	const env = loadEnv(mode, '../../', ['VITE_', 'API_', 'WS_', 'DASHBOARD_', 'LANDING_', 'GOODBYE_']);
	const API_URL = process.env.API_URL || env.API_URL || 'http://localhost:3001';
	const WS_URL = process.env.WS_URL || env.WS_URL || deriveWsUrl(API_URL);
	const DASHBOARD_URL = process.env.DASHBOARD_URL || env.DASHBOARD_URL || 'http://localhost:3000';
	const landingBase = (process.env.LANDING_URL || env.LANDING_URL || 'http://localhost:3003').replace(
		/\/$/,
		'',
	);
	const GOODBYE_URL =
		process.env.GOODBYE_URL || env.GOODBYE_URL || `${landingBase}/goodbye`;

	return {
		plugins: [react(), crx({ manifest })],
		define: {
			'process.env.API_URL': JSON.stringify(API_URL),
			'process.env.WS_URL': JSON.stringify(WS_URL),
			'process.env.DASHBOARD_URL': JSON.stringify(DASHBOARD_URL),
			'process.env.GOODBYE_URL': JSON.stringify(GOODBYE_URL),
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
