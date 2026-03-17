import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve as inngestServe } from 'inngest/hono';
import { WebSocketServer } from 'ws';
import { embedFlow, embedPageElements, inngest } from './inngest/index.js';
import { auditRoutes } from './routes/audit.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { flowRoutes } from './routes/flows.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { orgRoutes } from './routes/orgs.js';
import { settingsRoutes } from './routes/settings.js';
import { siteRoutes } from './routes/sites.js';
import { statsRoutes } from './routes/stats.js';
import { tokenRoutes } from './routes/token.js';
import { handleWsConnection } from './ws/handler.js';

const app = new Hono();

app.use('*', logger());
// CORS: allow chrome-extension + localhost always; optional CORS_ORIGINS for dashboard (e.g. https://app.example.com)
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
app.use(
	'*',
	cors({
		origin: (origin) => {
			if (!origin) return origin;
			if (origin.startsWith('chrome-extension://')) return origin;
			if (origin.startsWith('http://localhost:')) return origin;
			if (corsOrigins.includes(origin)) return origin;
			return null;
		},
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

app.get('/', (c) => c.json({ name: 'Commandra API', docs: '/health', status: 'ok' }));
app.route('/health', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/token', tokenRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/conversations', conversationRoutes);
app.route('/api/audit', auditRoutes);
app.route('/api/sites', siteRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/flows', flowRoutes);
app.route('/api/memory', memoryRoutes);
app.route('/api/orgs', orgRoutes);

// Inngest handler — serve as middleware
const inngestHandler = inngestServe({ client: inngest, functions: [embedPageElements, embedFlow] });
app.all('/api/inngest', (c) => inngestHandler(c));
app.all('/api/inngest/*', (c) => inngestHandler(c));

const PORT = Number(process.env.PORT) || 3001;
const WS_PORT = Number(process.env.WS_PORT) || 3002;

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`API server running on http://localhost:${info.port}`);
});

// WebSocket: attach to HTTP server on path /ws (single-port mode, e.g. Railway).
// Also listen on WS_PORT if different from PORT (local dev: 3001 vs 3002).
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', handleWsConnection);

server.on('upgrade', (request, socket, head) => {
	const path = request.url?.split('?')[0];
	if (path === '/ws') {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	} else {
		socket.destroy();
	}
});

if (WS_PORT !== PORT) {
	const standaloneWs = new WebSocketServer({ port: WS_PORT });
	standaloneWs.on('connection', handleWsConnection);
	console.log(`WebSocket server also running on ws://localhost:${WS_PORT}`);
}
console.log(`WebSocket server on path /ws (same port as API)`);
