import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { WebSocketServer } from 'ws';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { healthRoutes } from './routes/health.js';
import { tokenRoutes } from './routes/token.js';
import { handleWsConnection } from './ws/handler.js';

const app = new Hono();

app.use('*', logger());
app.use(
	'*',
	cors({
		origin: ['chrome-extension://*', 'http://localhost:*'],
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
	}),
);

app.route('/health', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/token', tokenRoutes);
app.route('/api/chat', chatRoutes);

const PORT = Number(process.env.PORT) || 3001;
const WS_PORT = Number(process.env.WS_PORT) || 3002;

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`API server running on http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', handleWsConnection);
console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);
