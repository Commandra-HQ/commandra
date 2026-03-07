import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const connections = new Map<string, WebSocket>();

export function handleWsConnection(ws: WebSocket) {
	const connectionId = randomUUID();
	connections.set(connectionId, ws);
	console.log(`Extension connected: ${connectionId}`);

	ws.send(JSON.stringify({ type: 'connected', connectionId }));

	ws.on('message', (raw) => {
		try {
			const message = JSON.parse(raw.toString());
			console.log(`WS message from ${connectionId}:`, message.type);

			// Route messages to the agent or handle directly
			switch (message.type) {
				case 'page_state':
					// Extension is reporting current page state
					break;
				case 'action_result':
					// Extension is reporting result of an action we requested
					break;
				default:
					console.log(`Unknown message type: ${message.type}`);
			}
		} catch (err) {
			console.error('Failed to parse WS message:', err);
		}
	});

	ws.on('close', () => {
		connections.delete(connectionId);
		console.log(`Extension disconnected: ${connectionId}`);
	});
}

export function sendToExtension(connectionId: string, message: unknown) {
	const ws = connections.get(connectionId);
	if (ws && ws.readyState === ws.OPEN) {
		ws.send(JSON.stringify(message));
	}
}

export function getConnections() {
	return connections;
}
