import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';

interface Connection {
	ws: WebSocket;
	userId?: string;
	authenticated: boolean;
}

const connections = new Map<string, Connection>();
const pendingRequests = new Map<string, {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}>();

// Listeners for action status updates (side panel activity feed)
const statusListeners = new Map<string, (update: unknown) => void>();

export function handleWsConnection(ws: WebSocket) {
	const connectionId = randomUUID();
	connections.set(connectionId, { ws, authenticated: false });
	console.log(`WS connected: ${connectionId}`);

	ws.send(JSON.stringify({ type: 'connected', connectionId, timestamp: Date.now() }));

	ws.on('message', async (raw) => {
		try {
			const message = JSON.parse(raw.toString());

			switch (message.type) {
				case 'auth': {
					const conn = connections.get(connectionId);
					if (!conn) break;
					try {
						const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
						const { payload } = await jwtVerify(message.token, secret);
						conn.userId = payload.userId as string;
						conn.authenticated = true;
						ws.send(JSON.stringify({ type: 'auth_result', success: true, timestamp: Date.now() }));
						console.log(`WS authenticated: ${connectionId} (user: ${conn.userId})`);
					} catch {
						ws.send(JSON.stringify({ type: 'auth_result', success: false, timestamp: Date.now() }));
					}
					break;
				}

				case 'action_result': {
					const { requestId } = message;
					const pending = pendingRequests.get(requestId);
					if (pending) {
						clearTimeout(pending.timer);
						pendingRequests.delete(requestId);
						const result = message.payload as { success?: boolean; error?: string } | null;
						broadcastStatus(connectionId, {
							requestId,
							action: '',
							status: result?.success ? 'done' : 'failed',
							error: result?.error,
							timestamp: Date.now(),
						});
						pending.resolve(result);
					}
					break;
				}

				case 'page_state':
					break;

				default:
					console.log(`Unknown WS message: ${message.type}`);
			}
		} catch (err) {
			console.error('Failed to parse WS message:', err);
		}
	});

	ws.on('close', () => {
		connections.delete(connectionId);
		statusListeners.delete(connectionId);
		console.log(`WS disconnected: ${connectionId}`);
	});
}

/**
 * Send an action request to an extension connection and wait for the result.
 * Returns a Promise that resolves with the action result or rejects on timeout.
 */
export function sendActionRequest(
	connectionId: string,
	action: string,
	args: Record<string, unknown>,
	timeoutMs = 10000,
): Promise<unknown> {
	const conn = connections.get(connectionId);
	if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
		console.error(`[WS] sendActionRequest failed: connection ${connectionId} not open (state: ${conn?.ws.readyState})`);
		return Promise.reject(new Error('Extension not connected'));
	}

	const requestId = randomUUID();
	console.log(`[WS] Sending action: ${action} (${requestId})`, args);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(requestId);
			console.error(`[WS] Action timed out: ${action} (${requestId})`);
			reject(new Error(`Action timed out after ${timeoutMs}ms: ${action}`));
		}, timeoutMs);

		pendingRequests.set(requestId, { resolve, reject, timer });

		conn.ws.send(JSON.stringify({
			type: 'action_request',
			requestId,
			payload: { action, ...args },
			timestamp: Date.now(),
		}));

		// Broadcast status update to any listening side panels
		broadcastStatus(connectionId, {
			requestId,
			action,
			label: (args.selector as string) || (args.url as string) || '',
			status: 'pending',
			timestamp: Date.now(),
		});
	});
}

/** Find a connection by userId */
export function getConnectionByUser(userId: string): string | null {
	for (const [connId, conn] of connections) {
		if (conn.userId === userId && conn.authenticated && conn.ws.readyState === conn.ws.OPEN) {
			return connId;
		}
	}
	return null;
}

export function sendToExtension(connectionId: string, message: unknown) {
	const conn = connections.get(connectionId);
	if (conn && conn.ws.readyState === conn.ws.OPEN) {
		conn.ws.send(JSON.stringify(message));
	}
}

export function onStatusUpdate(connectionId: string, listener: (update: unknown) => void) {
	statusListeners.set(connectionId, listener);
}

export function removeStatusListener(connectionId: string) {
	statusListeners.delete(connectionId);
}

function broadcastStatus(connectionId: string, update: unknown) {
	// Send to the connection's side panel listener
	const listener = statusListeners.get(connectionId);
	if (listener) listener(update);

	// Also send over the WS connection itself (extension can forward to side panel)
	const conn = connections.get(connectionId);
	if (conn && conn.ws.readyState === conn.ws.OPEN) {
		conn.ws.send(JSON.stringify({ type: 'action_status', payload: update, timestamp: Date.now() }));
	}
}

export function getConnections() {
	return connections;
}
