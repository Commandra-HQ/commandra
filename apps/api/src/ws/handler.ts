import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import type { WebSocket } from 'ws';
import { getAllRunsByUser, getRun, killRun, resumeRun, updateConnectionId } from '../agent/run-registry.js';
import { onUserReconnected } from '../agent/scheduler.js';
import { db } from '../db/index.js';
import { sites } from '../db/schema.js';
import { getOrCreateSite, updateSiteTotals, upsertPage } from '../routes/sites.js';
import { updateSitemap } from '../storage/sitemap.js';

interface Connection {
	ws: WebSocket;
	userId?: string;
	authenticated: boolean;
	killed?: boolean;
}

const connections = new Map<string, Connection>();
const pendingRequests = new Map<
	string,
	{
		resolve: (result: unknown) => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}
>();

// Listeners for action status updates (side panel activity feed)
const statusListeners = new Map<string, (update: unknown) => void>();

// Conversation ↔ Connection mapping — tracks which WS connection owns which conversation
const conversationConnections = new Map<string, string>(); // convId → connectionId
const connectionConversations = new Map<string, Set<string>>(); // connectionId → Set<convId>

export function registerConversationConnection(convId: string, connectionId: string) {
	conversationConnections.set(convId, connectionId);
	let convs = connectionConversations.get(connectionId);
	if (!convs) {
		convs = new Set();
		connectionConversations.set(connectionId, convs);
	}
	convs.add(convId);
}

export function getConnectionForConversation(convId: string): string | null {
	const connId = conversationConnections.get(convId);
	if (!connId) return null;
	const conn = connections.get(connId);
	if (!conn || conn.ws.readyState !== conn.ws.OPEN) return null;
	return connId;
}

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
						// Resume ALL paused orchestrator runs for this user
						const pausedRuns = getAllRunsByUser(conn.userId).filter(r => r.status === 'paused');
						for (const run of pausedRuns) {
							console.log(`[WS] Resuming paused run ${run.conversationId} for user ${conn.userId}`);
							updateConnectionId(run.conversationId, connectionId);
							registerConversationConnection(run.conversationId, connectionId);
							resumeRun(run.conversationId);
						}
						// Process any queued scheduled runs for this user
						onUserReconnected(conn.userId, connectionId).catch((err) =>
							console.warn('[WS] Failed to process queued runs on reconnect:', err),
						);
					} catch {
						ws.send(JSON.stringify({ type: 'auth_result', success: false, timestamp: Date.now() }));
					}
					break;
				}

				case 'action_result': {
					const { requestId } = message;
					console.log(
						`[WS] Received action_result for ${requestId}:`,
						JSON.stringify(message.payload),
					);
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
					} else {
						console.warn(`[WS] No pending request for ${requestId} (already timed out?)`);
					}
					break;
				}

				case 'approval_response': {
					const { requestId } = message;
					console.log(`[WS] Received approval_response for ${requestId}:`, message.approved);
					const pending = pendingRequests.get(requestId);
					if (pending) {
						clearTimeout(pending.timer);
						pendingRequests.delete(requestId);
						pending.resolve({ approved: !!message.approved, reason: message.reason });
					}
					break;
				}

				case 'kill': {
					console.log(`[WS] Kill received from ${connectionId}`, message.conversationId ? `for conv ${message.conversationId}` : '(all)');
					cancelAllPending(connectionId);
					const conn = connections.get(connectionId);
					if (conn) {
						conn.killed = true;
						// Kill specific conversation if provided, otherwise all runs for this user
						if (message.conversationId) {
							const run = getRun(message.conversationId);
							if (run) {
								console.log(`[WS] Killing run ${run.conversationId} via registry`);
								killRun(run.conversationId);
							}
						} else if (conn.userId) {
							const runs = getAllRunsByUser(conn.userId);
							for (const run of runs) {
								console.log(`[WS] Killing run ${run.conversationId} via registry`);
								killRun(run.conversationId);
							}
						}
					}
					broadcastStatus(connectionId, {
						requestId: 'kill',
						action: 'kill',
						status: 'failed',
						error: 'Agent stopped by user',
						timestamp: Date.now(),
					});
					break;
				}

				case 'page_indexed': {
					// Extension pushed a page index — store in Postgres
					const conn = connections.get(connectionId);
					if (!conn?.userId) break;

					const { domain, pageIndex } = message as {
						domain: string;
						pageIndex: {
							url: string;
							urlPattern?: string;
							title?: string;
							pageType?: string;
							elements?: unknown[];
							navigationLinks?: unknown[];
						};
					};

					if (!domain || !pageIndex?.url) break;

					// Async — don't block WS
					(async () => {
						try {
							const site = await getOrCreateSite(conn.userId!, domain);

							await upsertPage(site.id, pageIndex);
							await updateSiteTotals(site.id);

							// Update navigation graph (fire-and-forget)
							updateSitemap(conn.userId!, domain, {
								url: pageIndex.url,
								urlPattern: pageIndex.urlPattern,
								title: pageIndex.title,
								pageType: pageIndex.pageType,
								elements: pageIndex.elements,
								navigationLinks: pageIndex.navigationLinks as
									| { label: string; href: string }[]
									| undefined,
							}).catch((err) => console.error('[sitemap] Failed to update:', err));

							console.log(`[WS] Page indexed: ${domain} ${pageIndex.urlPattern || pageIndex.url}`);
						} catch (err) {
							console.error('[WS] Failed to store page index:', err);
						}
					})();
					break;
				}

				case 'find_element': {
					// Element search removed (embeddings removed) — return null
					const { requestId: feReqId } = message as { requestId: string };
					ws.send(
						JSON.stringify({ type: 'find_element_result', requestId: feReqId, result: null }),
					);
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
		// Clean up conversation-connection mappings
		const convs = connectionConversations.get(connectionId);
		if (convs) {
			for (const convId of convs) {
				conversationConnections.delete(convId);
			}
			connectionConversations.delete(connectionId);
		}
		connections.delete(connectionId);
		statusListeners.delete(connectionId);
		console.log(`WS disconnected: ${connectionId}`);
	});
}

/**
 * Send an action request to an extension connection and wait for the result.
 * Returns a Promise that resolves with the action result or rejects on timeout.
 * If tabId is provided, the extension targets that specific tab (for sub-agents).
 */
export function sendActionRequest(
	connectionId: string,
	action: string,
	args: Record<string, unknown>,
	timeoutMs = 10000,
): Promise<unknown> {
	const conn = connections.get(connectionId);
	if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
		console.error(
			`[WS] sendActionRequest failed: connection ${connectionId} not open (state: ${conn?.ws.readyState})`,
		);
		return Promise.reject(new Error('Extension not connected'));
	}

	const requestId = randomUUID();
	console.log(`[WS] Sending action: ${action} (${requestId})`, args);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(requestId);
			console.error(`[WS] Action timed out: ${action} (${requestId})`);
			broadcastStatus(connectionId, {
				requestId,
				action,
				status: 'failed',
				error: `Timed out after ${timeoutMs}ms`,
				timestamp: Date.now(),
			});
			reject(new Error(`Action timed out after ${timeoutMs}ms: ${action}`));
		}, timeoutMs);

		pendingRequests.set(requestId, { resolve, reject, timer });

		conn.ws.send(
			JSON.stringify({
				type: 'action_request',
				requestId,
				payload: { action, ...args },
				timestamp: Date.now(),
			}),
		);

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

/**
 * Send an approval request to the extension and wait for user response.
 * Returns { approved: boolean, reason?: string }
 */
export function sendApprovalRequest(
	connectionId: string,
	details: Record<string, unknown> & { action?: string; type?: string; reason?: string },
	timeoutMs = 600000, // 10 minutes — durable orchestrator means users may navigate away
	explicitRequestId?: string,
): Promise<{ approved: boolean; reason?: string }> {
	const conn = connections.get(connectionId);
	if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
		return Promise.reject(new Error('Extension not connected'));
	}

	const requestId = explicitRequestId || randomUUID();
	console.log(
		`[WS] Sending approval request: ${details.action || details.type} "${details.label || ''}" (${requestId})`,
	);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pendingRequests.delete(requestId);
			console.log(`[WS] Approval timed out: ${requestId}`);
			broadcastStatus(connectionId, {
				requestId,
				action: details.action,
				label: details.label,
				status: 'failed',
				error: 'Approval timed out',
				timestamp: Date.now(),
			});
			resolve({ approved: false, reason: 'Timed out waiting for approval' });
		}, timeoutMs);

		pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });

		conn.ws.send(
			JSON.stringify({
				type: 'approval_request',
				requestId,
				payload: details,
				timestamp: Date.now(),
			}),
		);

		broadcastStatus(connectionId, {
			requestId,
			action: details.action,
			label: details.label || details.selector,
			status: 'pending',
			timestamp: Date.now(),
		});
	});
}

/** Check if user has killed the agent for this connection */
export function isKilled(connectionId: string): boolean {
	const conn = connections.get(connectionId);
	return !!conn?.killed;
}

/** Reset the kill flag (call when starting a new chat message) */
export function resetKill(connectionId: string): void {
	const conn = connections.get(connectionId);
	if (conn) conn.killed = false;
}

/** Cancel all pending requests/approvals for a connection */
function cancelAllPending(connectionId: string) {
	for (const [reqId, pending] of pendingRequests) {
		clearTimeout(pending.timer);
		pending.reject(new Error('Cancelled by user'));
		pendingRequests.delete(reqId);
	}
}

export function getConnections() {
	return connections;
}
