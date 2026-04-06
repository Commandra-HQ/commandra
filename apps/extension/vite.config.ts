import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import manifest from './manifest.json';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Values from `commandra/.env` only (not overridden by shell), so the file stays authoritative. */
function readRootDotEnv(): Record<string, string> {
	const p = join(monorepoRoot, '.env');
	if (!existsSync(p)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(p, 'utf8').split('\n')) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const i = t.indexOf('=');
		if (i === -1) continue;
		const k = t.slice(0, i).trim();
		out[k] = t.slice(i + 1).trim();
	}
	return out;
}

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
	const env = loadEnv(mode, monorepoRoot, ['VITE_', 'API_', 'WS_', 'DASHBOARD_', 'LANDING_', 'GOODBYE_']);
	const fileEnv = readRootDotEnv();
	const API_URL = fileEnv.API_URL || env.API_URL || process.env.API_URL || 'http://localhost:3001';
	const WS_URL = fileEnv.WS_URL || env.WS_URL || process.env.WS_URL || deriveWsUrl(API_URL);
	const DASHBOARD_URL =
		fileEnv.DASHBOARD_URL || env.DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3000';
	const landingBase = (
		fileEnv.LANDING_URL ||
		env.LANDING_URL ||
		process.env.LANDING_URL ||
		'http://localhost:3003'
	).replace(/\/$/, '');
	const GOODBYE_URL =
		fileEnv.GOODBYE_URL ||
		env.GOODBYE_URL ||
		process.env.GOODBYE_URL ||
		`${landingBase}/goodbye`;
	const viteSentryDsn =
		fileEnv.VITE_SENTRY_DSN || env.VITE_SENTRY_DSN || process.env.VITE_SENTRY_DSN || '';

	return {
		plugins: [react(), crx({ manifest })],
		define: {
			'process.env.API_URL': JSON.stringify(API_URL),
			'process.env.WS_URL': JSON.stringify(WS_URL),
			'process.env.DASHBOARD_URL': JSON.stringify(DASHBOARD_URL),
			'process.env.GOODBYE_URL': JSON.stringify(GOODBYE_URL),
			'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(viteSentryDsn),
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
