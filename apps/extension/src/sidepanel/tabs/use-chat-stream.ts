/**
 * Custom hook for SSE streaming — handles sendMessage, block accumulation, and rAF flushing.
 */

import type { SSEEvent } from '@afe/shared';
import { useCallback, useRef } from 'react';
import type { ChatMessage, MessageBlock, ApprovalRequest } from './chat-types.js';
import { API_URL, parseSSEBuffer } from './chat-types.js';

interface UseChatStreamOptions {
	setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
	setIsActive: (v: boolean) => void;
	setContextStatus: (v: { used: number; limit: number; percent: number } | null) => void;
	setPlanState: (v: { description: string; steps: { label: string; status: string }[] } | null) => void;
	setPendingApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
	setPendingPlanApproval: (v: { requestId: string; planId: string; description: string; steps: string[] } | null) => void;
	setShowPlanPanel: (v: boolean) => void;
	planState: { description: string; steps: { label: string; status: string }[] } | null;
	externalConvId?: string;
	markActive: (convId: string, title: string, preview: string) => void;
	markDone: (convId: string) => void;
	navigate: (path: string, options?: { replace?: boolean }) => void;
}

export function useChatStream(options: UseChatStreamOptions) {
	const {
		setChatMessages,
		setIsActive,
		setContextStatus,
		setPlanState,
		setShowPlanPanel,
		planState,
		externalConvId,
		markActive,
		markDone,
		navigate,
	} = options;

	const abortRef = useRef<AbortController | null>(null);
	const assistantMsgIdRef = useRef<string>('');
	const blocksRef = useRef<MessageBlock[]>([]);
	const textAccumRef = useRef('');
	const thinkingAccumRef = useRef('');
	const rafRef = useRef<number>(0);

	function flushBlocks() {
		const id = assistantMsgIdRef.current;
		if (!id) return;
		const blocks = [...blocksRef.current];
		setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, blocks: [...blocks] } : m)));
		rafRef.current = 0;
	}

	function scheduleFlush() {
		if (!rafRef.current) {
			rafRef.current = requestAnimationFrame(flushBlocks);
		}
	}

	function appendText(text: string) {
		textAccumRef.current += text;
		const blocks = blocksRef.current;
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'text') {
			last.content = textAccumRef.current;
		} else {
			blocks.push({ type: 'text', content: textAccumRef.current });
		}
	}

	function appendThinking(text: string) {
		thinkingAccumRef.current += text;
		const blocks = blocksRef.current;
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'thinking') {
			last.content = thinkingAccumRef.current;
		} else {
			blocks.push({ type: 'thinking', content: thinkingAccumRef.current });
		}
	}

	function processSSEEvent(event: SSEEvent) {
		switch (event.type) {
			case 'text_delta':
				appendText(event.text);
				scheduleFlush();
				break;

			case 'thinking': {
				textAccumRef.current = '';
				thinkingAccumRef.current = '';
				blocksRef.current.push({ type: 'thinking', content: '' });
				scheduleFlush();
				break;
			}

			case 'thinking_delta':
				appendThinking(event.text);
				scheduleFlush();
				break;

			case 'tool_start': {
				const blocks = blocksRef.current;
				if (
					blocks.length > 0 &&
					blocks[blocks.length - 1].type === 'thinking' &&
					!(blocks[blocks.length - 1] as { content: string }).content
				) {
					blocks.pop();
				}
				textAccumRef.current = '';
				thinkingAccumRef.current = '';
				blocks.push({
					type: 'tool_call',
					toolName: event.toolName,
					label: event.label,
					args: event.args,
					status: 'running',
				});
				scheduleFlush();
				break;
			}

			case 'tool_end': {
				const blocks = blocksRef.current;
				for (let i = blocks.length - 1; i >= 0; i--) {
					const b = blocks[i];
					if (
						b.type === 'tool_call' &&
						b.toolName === event.toolName &&
						b.status === 'running'
					) {
						b.status = event.success ? 'success' : 'error';
						b.error = event.error;
						b.result = event.result;
						b.screenshot = event.screenshot;
						break;
					}
				}
				scheduleFlush();
				break;
			}

			case 'blocked':
				blocksRef.current.push({
					type: 'blocked',
					toolName: event.toolName,
					reason: event.reason,
				});
				scheduleFlush();
				break;

			case 'plan_step_updated': {
				const blocks = blocksRef.current;
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
				scheduleFlush();
				break;
			}

			case 'plan_approved':
			case 'plan_rejected':
				break;

			case 'context_status':
				setContextStatus({ used: event.used, limit: event.limit, percent: event.percent });
				break;

			case 'plan_state':
				setPlanState(event.plan);
				if (event.plan) {
					const hasFailed = event.plan.steps.some((s: { status: string }) => s.status === 'failed');
					const isNew = !planState;
					if (isNew || hasFailed) {
						setShowPlanPanel(true);
					}
				}
				break;

			case 'compaction': {
				blocksRef.current.push({
					type: 'text',
					content: `---\n**Conversation compacted** (${event.messageCount} messages saved)\n\n${event.summary}\n\n_Full transcript: \`${event.path}\`_\n\n---`,
				});
				scheduleFlush();
				break;
			}

			case 'approval_inline':
				break;

			case 'sub_agent_start': {
				const blocks = blocksRef.current;
				if (
					blocks.length > 0 &&
					blocks[blocks.length - 1].type === 'thinking' &&
					!(blocks[blocks.length - 1] as { content: string }).content
				) {
					blocks.pop();
				}
				textAccumRef.current = '';
				thinkingAccumRef.current = '';
				blocks.push({
					type: 'sub_agent',
					agentId: event.agentId,
					task: event.task,
					targetUrl: event.targetUrl,
					status: 'running',
					actions: [],
				});
				scheduleFlush();
				break;
			}

			case 'sub_agent_action': {
				const blocks = blocksRef.current;
				for (let i = blocks.length - 1; i >= 0; i--) {
					const b = blocks[i];
					if (b.type === 'sub_agent' && b.agentId === event.agentId) {
						b.actions.push({
							toolName: event.toolName,
							label: event.label,
							status: event.success ? 'success' : 'error',
							args: event.args,
							result: event.result,
							error: event.error,
							screenshot: event.screenshot,
						});
						break;
					}
				}
				scheduleFlush();
				break;
			}

			case 'sub_agent_end': {
				const blocks = blocksRef.current;
				for (let i = blocks.length - 1; i >= 0; i--) {
					const b = blocks[i];
					if (b.type === 'sub_agent' && b.agentId === event.agentId) {
						b.status = event.success ? 'success' : 'error';
						b.summary = event.summary;
						break;
					}
				}
				scheduleFlush();
				break;
			}

			case 'done':
				if (event.conversationId) {
					navigate(`/chat/${event.conversationId}`, { replace: true });
					markDone(event.conversationId);
				}
				break;

			case 'error':
				blocksRef.current.push({
					type: 'text',
					content: event.message,
				});
				scheduleFlush();
				break;
		}
	}

	const sendMessage = useCallback(
		async (text: string, extraBody?: Record<string, unknown>) => {
			const stored = await chrome.storage.local.get(['authToken']);
			const token = stored.authToken;

			const assistantMsg: ChatMessage = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: '',
				blocks: [],
			};
			assistantMsgIdRef.current = assistantMsg.id;
			blocksRef.current = [];
			textAccumRef.current = '';
			setChatMessages((prev) => [...prev, assistantMsg]);
			setIsActive(true);

			// Show badge on extension icon while task runs
			try {
				chrome.action.setBadgeText({ text: '●' });
				chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
			} catch {}


			if (externalConvId) {
				markActive(externalConvId, 'Chat', text.slice(0, 60));
			}

			const controller = new AbortController();
			abortRef.current = controller;

			try {
				const res = await fetch(`${API_URL}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						message: text,
						conversationId: externalConvId,
						...extraBody,
					}),
					signal: controller.signal,
				});

				if (!res.ok) {
					throw new Error(`API error: ${res.status}`);
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
							processSSEEvent(event);
						}
					}
				}
			} catch (err) {
				if (controller.signal.aborted) return;
				blocksRef.current.push({
					type: 'text',
					content: 'Failed to get a response. Make sure the API is running.',
				});
			} finally {
				if (rafRef.current) {
					cancelAnimationFrame(rafRef.current);
				}
				flushBlocks();

				const finalText = blocksRef.current
					.filter((b) => b.type === 'text')
					.map((b) => (b as { content: string }).content)
					.join('\n');

				setChatMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsgIdRef.current ? { ...m, content: finalText } : m,
					),
				);

				setIsActive(false);
				abortRef.current = null;
				assistantMsgIdRef.current = '';

				// Clear badge
				try { chrome.action.setBadgeText({ text: '' }); } catch {}
			}
		},
		[externalConvId, markActive, setChatMessages, setIsActive],
	);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
		setIsActive(false);
	}, [setIsActive]);

	return {
		sendMessage,
		handleStop,
		blocksRef,
		scheduleFlush,
	};
}
