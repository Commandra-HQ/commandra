/**
 * Zustand conversation store — per-conversation state isolation.
 *
 * Each conversation gets its own slice of state (messages, blocks, streaming, plan, etc.).
 * Tab switching just changes `activeConvId` — no state destruction.
 * SSE events are always scoped to a conversation ID, never shared refs.
 */

import type { SSEEvent } from '@afe/shared';
import { create } from 'zustand';
import type {
	ApprovalRequest,
	ChatMessage,
	MessageBlock,
} from '../tabs/chat-types.js';
import { API_URL, parseSSEBuffer } from '../tabs/chat-types.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UsageTotal {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	thinkingTokens: number;
	estimatedCostUsd: number;
}

export interface ContextStatus {
	used: number;
	limit: number;
	percent: number;
}

export interface PlanState {
	description: string;
	steps: { label: string; status: string }[];
}

export interface ConversationSlice {
	messages: ChatMessage[];
	// Live streaming state
	blocks: MessageBlock[];
	textAccum: string;
	thinkingAccum: string;
	assistantMsgId: string;
	isActive: boolean;
	// Metadata
	contextStatus: ContextStatus | null;
	usageTotal: UsageTotal | null;
	planState: PlanState | null;
	showPlanPanel: boolean;
	pendingApprovals: ApprovalRequest[];
	// SSE connection
	sseController: AbortController | null;
	// Browser tab this conversation targets (locked on first message)
	tabId: number | null;
}

function createEmptySlice(): ConversationSlice {
	return {
		messages: [],
		blocks: [],
		textAccum: '',
		thinkingAccum: '',
		assistantMsgId: '',
		isActive: false,
		contextStatus: null,
		tabId: null,
		usageTotal: null,
		planState: null,
		showPlanPanel: false,
		pendingApprovals: [],
		sseController: null,
	};
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface ConversationStore {
	conversations: Map<string, ConversationSlice>;
	activeConvId: string | null;

	// Core actions
	setActiveConv: (convId: string | null) => void;
	getOrCreate: (convId: string) => ConversationSlice;
	updateConv: (convId: string, partial: Partial<ConversationSlice>) => void;
	clearConv: (convId: string) => void;
	removeConv: (convId: string) => void;

	// Message actions
	setMessages: (convId: string, msgs: ChatMessage[]) => void;
	appendMessage: (convId: string, msg: ChatMessage) => void;
	updateMessage: (convId: string, msgId: string, partial: Partial<ChatMessage>) => void;

	// Streaming actions
	startAssistantMessage: (convId: string) => string; // returns new msgId
	flushBlocks: (convId: string) => void;
	processSSEEvent: (convId: string, event: SSEEvent, navigate: (path: string, opts?: { replace?: boolean }) => void) => void;

	// Stream lifecycle
	startStream: (convId: string, controller: AbortController) => void;
	stopStream: (convId: string) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
	conversations: new Map(),
	activeConvId: null,

	setActiveConv: (convId) => set({ activeConvId: convId }),

	getOrCreate: (convId) => {
		const { conversations } = get();
		const existing = conversations.get(convId);
		if (existing) return existing;
		const slice = createEmptySlice();
		const next = new Map(conversations);
		next.set(convId, slice);
		set({ conversations: next });
		return slice;
	},

	updateConv: (convId, partial) => {
		const { conversations } = get();
		const existing = conversations.get(convId);
		if (!existing) return;
		const next = new Map(conversations);
		next.set(convId, { ...existing, ...partial });
		set({ conversations: next });
	},

	clearConv: (convId) => {
		const { conversations } = get();
		const next = new Map(conversations);
		next.set(convId, createEmptySlice());
		set({ conversations: next });
	},

	removeConv: (convId) => {
		const { conversations } = get();
		const existing = conversations.get(convId);
		if (existing?.sseController) existing.sseController.abort();
		const next = new Map(conversations);
		next.delete(convId);
		set({ conversations: next });
	},

	// ── Messages ─────────────────────────────────────────────────────────────

	setMessages: (convId, msgs) => {
		const store = get();
		store.getOrCreate(convId);
		store.updateConv(convId, { messages: msgs });
	},

	appendMessage: (convId, msg) => {
		const store = get();
		const conv = store.getOrCreate(convId);
		store.updateConv(convId, { messages: [...conv.messages, msg] });
	},

	updateMessage: (convId, msgId, partial) => {
		const { conversations } = get();
		const conv = conversations.get(convId);
		if (!conv) return;
		const next = new Map(conversations);
		next.set(convId, {
			...conv,
			messages: conv.messages.map((m) =>
				m.id === msgId ? { ...m, ...partial } : m,
			),
		});
		set({ conversations: next });
	},

	// ── Streaming ────────────────────────────────────────────────────────────

	startAssistantMessage: (convId) => {
		const store = get();
		const conv = store.getOrCreate(convId);
		const msgId = crypto.randomUUID();
		const assistantMsg: ChatMessage = {
			id: msgId,
			role: 'assistant',
			content: '',
			blocks: [],
		};
		store.updateConv(convId, {
			messages: [...conv.messages, assistantMsg],
			blocks: [],
			textAccum: '',
			thinkingAccum: '',
			assistantMsgId: msgId,
			isActive: true,
		});
		return msgId;
	},

	flushBlocks: (convId) => {
		const { conversations } = get();
		const conv = conversations.get(convId);
		if (!conv || !conv.assistantMsgId) return;
		const blocks = [...conv.blocks];
		const next = new Map(conversations);
		next.set(convId, {
			...conv,
			messages: conv.messages.map((m) =>
				m.id === conv.assistantMsgId ? { ...m, blocks: [...blocks] } : m,
			),
		});
		set({ conversations: next });
	},

	startStream: (convId, controller) => {
		const store = get();
		const conv = store.getOrCreate(convId);
		// Abort any existing stream for this conversation
		if (conv.sseController) conv.sseController.abort();
		store.updateConv(convId, { sseController: controller, isActive: true });
	},

	stopStream: (convId) => {
		const { conversations } = get();
		const conv = conversations.get(convId);
		if (!conv) return;
		if (conv.sseController) conv.sseController.abort();
		const store = get();
		store.updateConv(convId, {
			sseController: null,
			isActive: false,
			assistantMsgId: '',
		});
		// Finalize the assistant message content
		const finalText = conv.blocks
			.filter((b) => b.type === 'text')
			.map((b) => (b as { content: string }).content)
			.join('\n');
		if (conv.assistantMsgId && finalText) {
			store.updateMessage(convId, conv.assistantMsgId, { content: finalText });
		}
	},

	// ── SSE Event Processing ─────────────────────────────────────────────────

	processSSEEvent: (convId, event, navigate) => {
		const store = get();
		const conv = store.conversations.get(convId);
		if (!conv) return;

		// Handle non-standard events injected by server (not in SSEEvent union)
		const eventType = (event as { type: string }).type;
		if (eventType === 'approval_resolved') {
			const resolved = event as unknown as { requestId: string; approved: boolean };
			const prefix = resolved.approved ? '__approved__' : '__rejected__';
			const current = store.conversations.get(convId);
			if (!current) return;
			const blocks = [...current.blocks];
			for (let i = 0; i < blocks.length; i++) {
				const b = blocks[i];
				if (b.type === 'text' && b.content.includes(resolved.requestId) && b.content.startsWith('__approval__:')) {
					blocks[i] = { ...b, content: b.content.replace('__approval__:', `${prefix}:`) };
					break;
				}
			}
			const next = new Map(store.conversations);
			next.set(convId, {
				...current,
				blocks,
				messages: current.messages.map((m) =>
					m.id === current.assistantMsgId ? { ...m, blocks: [...blocks] } : m,
				),
			});
			set({ conversations: next });
			return;
		}
		if (eventType === 'title_updated') {
			// Title updated — dispatch custom event for HubLayout
			const title = (event as unknown as { title: string }).title;
			window.dispatchEvent(
				new CustomEvent('commandra-title-update', {
					detail: { conversationId: convId, title },
				}),
			);
			return;
		}

		// Helper: update blocks in place and schedule a flush
		const mutateBlocks = (fn: (blocks: MessageBlock[]) => void) => {
			const current = store.conversations.get(convId);
			if (!current) return;
			const blocks = [...current.blocks];
			fn(blocks);
			const next = new Map(store.conversations);
			// Also update accumulators into the messages for real-time render
			next.set(convId, {
				...current,
				blocks,
				messages: current.messages.map((m) =>
					m.id === current.assistantMsgId ? { ...m, blocks: [...blocks] } : m,
				),
			});
			set({ conversations: next });
		};

		const appendText = (text: string) => {
			const current = store.conversations.get(convId);
			if (!current) return;
			const newAccum = current.textAccum + text;
			const blocks = [...current.blocks];
			const last = blocks[blocks.length - 1];
			if (last && last.type === 'text') {
				blocks[blocks.length - 1] = { ...last, content: newAccum };
			} else {
				blocks.push({ type: 'text', content: newAccum });
			}
			const next = new Map(store.conversations);
			next.set(convId, {
				...current,
				textAccum: newAccum,
				blocks,
				messages: current.messages.map((m) =>
					m.id === current.assistantMsgId ? { ...m, blocks: [...blocks] } : m,
				),
			});
			set({ conversations: next });
		};

		const appendThinking = (text: string) => {
			const current = store.conversations.get(convId);
			if (!current) return;
			const newAccum = current.thinkingAccum + text;
			const blocks = [...current.blocks];
			const last = blocks[blocks.length - 1];
			if (last && last.type === 'thinking') {
				blocks[blocks.length - 1] = { ...last, content: newAccum };
			} else {
				blocks.push({ type: 'thinking', content: newAccum });
			}
			const next = new Map(store.conversations);
			next.set(convId, {
				...current,
				thinkingAccum: newAccum,
				blocks,
				messages: current.messages.map((m) =>
					m.id === current.assistantMsgId ? { ...m, blocks: [...blocks] } : m,
				),
			});
			set({ conversations: next });
		};

		switch (event.type) {
			case 'conversation_id':
				// Navigation handled by the caller, not the store
				break;

			case 'text_delta':
				appendText(event.text);
				break;

			case 'thinking': {
				const current = store.conversations.get(convId);
				if (!current) break;
				store.updateConv(convId, { textAccum: '', thinkingAccum: '' });
				mutateBlocks((blocks) => {
					blocks.push({ type: 'thinking', content: '' });
				});
				break;
			}

			case 'thinking_delta':
				appendThinking(event.text);
				break;

			case 'tool_start':
				mutateBlocks((blocks) => {
					// Remove empty thinking block
					if (
						blocks.length > 0 &&
						blocks[blocks.length - 1].type === 'thinking' &&
						!(blocks[blocks.length - 1] as { content: string }).content
					) {
						blocks.pop();
					}
					blocks.push({
						type: 'tool_call',
						toolName: event.toolName,
						label: event.label,
						args: event.args,
						status: 'running',
					});
				});
				store.updateConv(convId, { textAccum: '', thinkingAccum: '' });
				break;

			case 'tool_end':
				mutateBlocks((blocks) => {
					for (let i = blocks.length - 1; i >= 0; i--) {
						const b = blocks[i];
						if (
							b.type === 'tool_call' &&
							b.toolName === event.toolName &&
							b.status === 'running'
						) {
							blocks[i] = {
								...b,
								status: event.success ? 'success' : 'error',
								error: event.error,
								result: event.result,
								screenshot: event.screenshot,
							};
							break;
						}
					}
				});
				break;

			case 'blocked':
				mutateBlocks((blocks) => {
					blocks.push({
						type: 'blocked',
						toolName: event.toolName,
						reason: event.reason,
					});
				});
				break;

			case 'plan_step_updated':
				mutateBlocks((blocks) => {
					for (const b of blocks) {
						if (b.type === 'plan' && b.plan.stepStatus) {
							const statusMap: Record<string, 'pending' | 'running' | 'done' | 'error'> = {
								in_progress: 'running',
								completed: 'done',
								failed: 'error',
							};
							b.plan.stepStatus[event.stepIndex] = statusMap[event.status] || 'pending';
						}
					}
				});
				break;

			case 'plan_approved':
			case 'plan_rejected':
				break;

			case 'context_status':
				store.updateConv(convId, {
					contextStatus: { used: event.used, limit: event.limit, percent: event.percent },
				});
				break;

			case 'plan_state':
				store.updateConv(convId, { planState: event.plan ?? null });
				if (event.plan) {
					const hasProgress = event.plan.steps.some(
						(s: { status: string }) => s.status === 'in_progress' || s.status === 'completed',
					);
					const hasFailed = event.plan.steps.some(
						(s: { status: string }) => s.status === 'failed',
					);
					if (hasProgress || hasFailed) {
						store.updateConv(convId, { showPlanPanel: true });
					}
				}
				break;

			case 'compaction':
				mutateBlocks((blocks) => {
					blocks.push({
						type: 'text',
						content: `---\n**Conversation compacted** (${event.messageCount} messages saved)\n\n${event.summary}\n\n_Full transcript: \`${event.path}\`_\n\n---`,
					});
				});
				break;

			case 'approval_inline': {
				const approvalType = event.approvalType || 'tool';
				const requestId = event.requestId || '';
				let approvalContent: string;
				if (approvalType === 'plan') {
					const steps = (event.planSteps as string[]) || [];
					approvalContent = `__approval__:plan:${requestId}:${event.label || ''}:${steps.join('|')}`;
				} else if (approvalType === 'agent') {
					approvalContent = `__approval__:tool:${requestId}:${event.action || 'create_agent'}:${event.label || ''}:${event.reason || ''}`;
				} else {
					approvalContent = `__approval__:tool:${requestId}:${event.action || ''}:${event.label || ''}:${event.reason || ''}`;
				}
				mutateBlocks((blocks) => {
					blocks.push({ type: 'text', content: approvalContent });
				});
				break;
			}

			case 'approval_resolved': {
				// Server confirms approval was resolved — update the block to show resolved state
				const resolvedRequestId = (event as unknown as { requestId: string }).requestId;
				const wasApproved = (event as unknown as { approved: boolean }).approved;
				const prefix = wasApproved ? '__approved__' : '__rejected__';
				mutateBlocks((blocks) => {
					for (let i = 0; i < blocks.length; i++) {
						const b = blocks[i];
						if (b.type === 'text' && b.content.includes(resolvedRequestId) && b.content.startsWith('__approval__:')) {
							blocks[i] = { ...b, content: b.content.replace('__approval__:', `${prefix}:`) };
							break;
						}
					}
				});
				break;
			}

			case 'sub_agent_start':
				mutateBlocks((blocks) => {
					if (
						blocks.length > 0 &&
						blocks[blocks.length - 1].type === 'thinking' &&
						!(blocks[blocks.length - 1] as { content: string }).content
					) {
						blocks.pop();
					}
					blocks.push({
						type: 'sub_agent',
						agentId: event.agentId,
						task: event.task,
						targetUrl: event.targetUrl,
						status: 'running',
						actions: [],
					});
				});
				store.updateConv(convId, { textAccum: '', thinkingAccum: '' });
				break;

			case 'sub_agent_action':
				mutateBlocks((blocks) => {
					for (let i = blocks.length - 1; i >= 0; i--) {
						const b = blocks[i];
						if (b.type === 'sub_agent' && b.agentId === event.agentId) {
							blocks[i] = {
								...b,
								actions: [
									...b.actions,
									{
										toolName: event.toolName,
										label: event.label,
										status: event.success ? 'success' : 'error',
										args: event.args,
										result: event.result,
										error: event.error,
										screenshot: event.screenshot,
									},
								],
							};
							break;
						}
					}
				});
				break;

			case 'sub_agent_end':
				mutateBlocks((blocks) => {
					for (let i = blocks.length - 1; i >= 0; i--) {
						const b = blocks[i];
						if (b.type === 'sub_agent' && b.agentId === event.agentId) {
							blocks[i] = {
								...b,
								status: event.success ? 'success' : 'error',
								summary: event.summary,
							};
							break;
						}
					}
				});
				break;

			case 'usage_total':
				store.updateConv(convId, {
					usageTotal: {
						inputTokens: (event as unknown as UsageTotal).inputTokens,
						outputTokens: (event as unknown as UsageTotal).outputTokens,
						cacheReadTokens: (event as unknown as UsageTotal).cacheReadTokens,
						cacheWriteTokens: (event as unknown as UsageTotal).cacheWriteTokens,
						thinkingTokens: (event as unknown as UsageTotal).thinkingTokens,
						estimatedCostUsd: (event as unknown as UsageTotal).estimatedCostUsd,
					},
				});
				break;

			case 'title_updated':
				// Title updated — dispatch a custom event so HubLayout can pick it up
				window.dispatchEvent(
					new CustomEvent('commandra-title-update', {
						detail: { conversationId: convId, title: event.title },
					}),
				);
				break;

			case 'done':
				store.stopStream(convId);
				break;

			case 'paused':
				mutateBlocks((blocks) => {
					blocks.push({ type: 'text', content: `\n\n---\n*${event.reason}*\n---\n` });
				});
				break;

			case 'resumed':
				mutateBlocks((blocks) => {
					blocks.push({ type: 'text', content: '\n*Resumed — browser reconnected.*\n' });
				});
				break;

			case 'error':
				mutateBlocks((blocks) => {
					blocks.push({ type: 'text', content: event.message });
				});
				break;
		}
	},
}));

// ── SSE Stream Helpers (called outside React, scoped by convId) ────────────────

/**
 * Send a message and stream the response into the store for a specific conversation.
 */
export async function sendMessageToConv(
	convId: string | undefined,
	text: string,
	extraBody: Record<string, unknown>,
	navigate: (path: string, opts?: { replace?: boolean }) => void,
	markActive: (convId: string, title: string, preview: string) => void,
	markDone: (convId: string) => void,
): Promise<void> {
	const store = useConversationStore.getState();
	const stored = await chrome.storage.local.get(['authToken']);
	const token = stored.authToken;

	const controller = new AbortController();
	// We might not have a convId yet (new chat) — we'll get it from the stream
	let activeConvId = convId;

	if (activeConvId) {
		store.getOrCreate(activeConvId);
		store.startStream(activeConvId, controller);
		store.startAssistantMessage(activeConvId);
		markActive(activeConvId, 'Chat', text.slice(0, 60));
	}

	try {
		chrome.action.setBadgeText({ text: '●' });
		chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
	} catch {}

	try {
		const res = await fetch(`${API_URL}/api/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				message: text,
				conversationId: convId || undefined,
				...extraBody,
			}),
			signal: controller.signal,
		});

		if (!res.ok) throw new Error(`API error: ${res.status}`);

		const reader = res.body?.getReader();
		const decoder = new TextDecoder();

		if (reader) {
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const [events, remaining] = parseSSEBuffer(buffer);
				buffer = remaining;
				for (const event of events) {
					// Handle conversation_id specially — sets up the conversation in the store
					if (event.type === 'conversation_id' && event.conversationId) {
						const newConvId = event.conversationId;
						if (!activeConvId) {
							// New chat — initialize store with the user message + assistant placeholder
							activeConvId = newConvId;
							store.getOrCreate(newConvId);
							// Add the user message that triggered this conversation
							store.appendMessage(newConvId, {
								id: crypto.randomUUID(),
								role: 'user',
								content: text,
							});
							store.startStream(newConvId, controller);
							store.startAssistantMessage(newConvId);
							markActive(newConvId, 'Chat', text.slice(0, 60));
						}
						store.setActiveConv(newConvId);
						navigate(`/chat/${newConvId}`, { replace: true });
					} else if (event.type === 'done' && event.conversationId) {
						const doneConvId = event.conversationId;
						store.stopStream(doneConvId);
						markDone(doneConvId);
						navigate(`/chat/${doneConvId}`, { replace: true });
					} else if (activeConvId) {
						store.processSSEEvent(activeConvId, event, navigate);
					}
				}
			}
		}
	} catch (err) {
		if (!controller.signal.aborted && activeConvId) {
			store.processSSEEvent(activeConvId, {
				type: 'error',
				message: 'Failed to get a response. Make sure the API is running.',
			}, navigate);
		}
	} finally {
		if (activeConvId) {
			const conv = store.conversations.get(activeConvId);
			// Only clean up if this controller is still the active one (wasn't replaced by a new stream)
			if (conv?.sseController === controller) {
				store.stopStream(activeConvId);
			}
		}
		try {
			chrome.action.setBadgeText({ text: '' });
		} catch {}
	}
}

/**
 * Subscribe to a running conversation's SSE stream.
 */
export async function subscribeToConvRun(
	convId: string,
	navigate: (path: string, opts?: { replace?: boolean }) => void,
	markActive: (convId: string, title: string, preview: string) => void,
	markDone: (convId: string) => void,
): Promise<void> {
	const store = useConversationStore.getState();
	const stored = await chrome.storage.local.get(['authToken']);
	const token = stored.authToken;

	const controller = new AbortController();
	store.getOrCreate(convId);
	store.startStream(convId, controller);
	store.startAssistantMessage(convId);
	markActive(convId, 'Chat', '');

	try {
		const res = await fetch(`${API_URL}/api/chat/subscribe/${convId}`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		});

		const contentType = res.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			// No active run — clean up
			store.stopStream(convId);
			// Remove the empty assistant message
			const conv = store.conversations.get(convId);
			if (conv) {
				store.updateConv(convId, {
					messages: conv.messages.filter((m) => m.id !== conv.assistantMsgId),
				});
			}
			return;
		}

		const reader = res.body?.getReader();
		const decoder = new TextDecoder();

		if (reader) {
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const [events, remaining] = parseSSEBuffer(buffer);
				buffer = remaining;
				for (const event of events) {
					if (event.type === 'done' && event.conversationId) {
						store.stopStream(convId);
						markDone(convId);
					} else {
						store.processSSEEvent(convId, event, navigate);
					}
				}
			}
		}
	} catch (err) {
		if (!controller.signal.aborted) {
			console.warn('[Store] subscribeToConvRun error:', err);
		}
	} finally {
		const conv = store.conversations.get(convId);
		if (conv?.sseController === controller) {
			store.stopStream(convId);
		}
		try {
			chrome.action.setBadgeText({ text: '' });
		} catch {}
	}
}
