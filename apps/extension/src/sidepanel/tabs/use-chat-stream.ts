/**
 * Custom hook for SSE streaming — handles sendMessage, block accumulation, and rAF flushing.
 */

import type { SSEEvent } from '@afe/shared';
import { useCallback, useRef } from 'react';
import type {
  ChatMessage,
  MessageBlock,
  ApprovalRequest,
} from './chat-types.js';
import { API_URL, parseSSEBuffer } from './chat-types.js';

export interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  thinkingTokens: number;
  estimatedCostUsd: number;
}

interface UseChatStreamOptions {
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsActive: (v: boolean) => void;
  setContextStatus: (
    v: { used: number; limit: number; percent: number } | null,
  ) => void;
  setUsageTotal: (v: UsageTotal | null) => void;
  setPlanState: (
    v: {
      description: string;
      steps: { label: string; status: string }[];
    } | null,
  ) => void;
  setPendingApprovals: React.Dispatch<React.SetStateAction<ApprovalRequest[]>>;
  setPendingPlanApproval: (
    v: {
      requestId: string;
      planId: string;
      description: string;
      steps: string[];
    } | null,
  ) => void;
  setShowPlanPanel: (v: boolean) => void;
  planState: {
    description: string;
    steps: { label: string; status: string }[];
  } | null;
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
    setUsageTotal,
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
  const conversationIdRef = useRef<string>('');

  function flushBlocks() {
    const id = assistantMsgIdRef.current;
    if (!id) return;
    const blocks = [...blocksRef.current];
    setChatMessages(prev =>
      prev.map(m => (m.id === id ? { ...m, blocks: [...blocks] } : m)),
    );
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
    // Guard: if assistantMsgIdRef is empty, we've been reset (new chat) — ignore stale events
    if (!assistantMsgIdRef.current && event.type !== 'conversation_id') {
      console.log('[SSE] Ignoring stale event (no assistantMsgId):', event.type);
      return;
    }

    switch (event.type) {
      case 'conversation_id':
        // Capture conversationId and navigate immediately so the tab appears right away
        if (event.conversationId) {
          conversationIdRef.current = event.conversationId;
          markActive(event.conversationId, 'Chat', '');
          // Navigate to create the tab early — replace so back button works
          if (!externalConvId) {
            navigate(`/chat/${event.conversationId}`, { replace: true });
          }
        }
        break;

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
            const statusMap: Record<
              string,
              'pending' | 'running' | 'done' | 'error'
            > = {
              in_progress: 'running',
              completed: 'done',
              failed: 'error',
            };
            b.plan.stepStatus[event.stepIndex] =
              statusMap[event.status] || 'pending';
          }
        }
        scheduleFlush();
        break;
      }

      case 'plan_approved':
      case 'plan_rejected':
        break;

      case 'context_status':
        setContextStatus({
          used: event.used,
          limit: event.limit,
          percent: event.percent,
        });
        break;

      case 'plan_state':
        setPlanState(event.plan);
        if (event.plan) {
          const hasFailed = event.plan.steps.some(
            (s: { status: string }) => s.status === 'failed',
          );
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
        blocksRef.current.push({ type: 'text', content: approvalContent });
        scheduleFlush();
        break;
      }

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

      case 'usage_total':
        setUsageTotal({
          inputTokens: (event as unknown as UsageTotal).inputTokens,
          outputTokens: (event as unknown as UsageTotal).outputTokens,
          cacheReadTokens: (event as unknown as UsageTotal).cacheReadTokens,
          cacheWriteTokens: (event as unknown as UsageTotal).cacheWriteTokens,
          thinkingTokens: (event as unknown as UsageTotal).thinkingTokens,
          estimatedCostUsd: (event as unknown as UsageTotal).estimatedCostUsd,
        });
        break;

      case 'done':
        if (event.conversationId) {
          conversationIdRef.current = event.conversationId;
          // Navigate if we haven't already (conversation_id event handles new chats)
          if (externalConvId !== event.conversationId) {
            navigate(`/chat/${event.conversationId}`, { replace: true });
          }
          markDone(event.conversationId);
        }
        break;

      case 'paused':
        blocksRef.current.push({
          type: 'text',
          content: `\n\n---\n*${event.reason}*\n---\n`,
        });
        scheduleFlush();
        break;

      case 'resumed':
        blocksRef.current.push({
          type: 'text',
          content: '\n*Resumed — browser reconnected.*\n',
        });
        scheduleFlush();
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
      console.log('[SSE] sendMessage called, externalConvId:', externalConvId, 'conversationIdRef:', conversationIdRef.current);
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
      setChatMessages(prev => [...prev, assistantMsg]);
      setIsActive(true);

      // Show badge on extension icon while task runs
      try {
        chrome.action.setBadgeText({ text: '●' });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      } catch {}

      const activeConvId = externalConvId || conversationIdRef.current;
      if (activeConvId) {
        markActive(activeConvId, 'Chat', text.slice(0, 60));
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
            conversationId:
              externalConvId || conversationIdRef.current || undefined,
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
        if (!controller.signal.aborted) {
          console.warn('[SSE] sendMessage error:', err);
          blocksRef.current.push({
            type: 'text',
            content: 'Failed to get a response. Make sure the API is running.',
          });
        } else {
          console.log('[SSE] sendMessage aborted (user stopped or navigated away)');
        }
      } finally {
        // Guard: only clean up if this sendMessage's assistant message is still the active one.
        // If the user navigated away (new chat / tab switch), resetConversation() already cleared
        // assistantMsgIdRef, so we must NOT touch setChatMessages or setIsActive — that would
        // clobber the freshly loaded conversation state.
        const myMsgId = assistantMsg.id;
        const stillActive = assistantMsgIdRef.current === myMsgId;
        console.log('[SSE] sendMessage finally — myMsgId:', myMsgId, 'stillActive:', stillActive);

        if (stillActive) {
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
          }
          flushBlocks();

          const finalText = blocksRef.current
            .filter(b => b.type === 'text')
            .map(b => (b as { content: string }).content)
            .join('\n');

          setChatMessages(prev =>
            prev.map(m =>
              m.id === myMsgId ? { ...m, content: finalText } : m,
            ),
          );

          setIsActive(false);
          abortRef.current = null;
          assistantMsgIdRef.current = '';

          // Clear badge
          try {
            chrome.action.setBadgeText({ text: '' });
          } catch {}
        } else {
          console.log('[SSE] sendMessage finally — skipped cleanup (navigated away)');
          abortRef.current = null;
        }
      }
    },
    [externalConvId, markActive, setChatMessages, setIsActive],
  );

  /**
   * Subscribe to an already-running conversation's SSE stream.
   * Used when the user opens a conversation that has an active orchestrator on the server.
   */
  const subscribeToRun = useCallback(
    async (convId: string) => {
      console.log('[SSE] subscribeToRun called:', convId);
      const stored = await chrome.storage.local.get(['authToken']);
      const token = stored.authToken;

      // Set up assistant message placeholder for incoming events
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        blocks: [],
      };
      assistantMsgIdRef.current = assistantMsg.id;
      blocksRef.current = [];
      textAccumRef.current = '';
      thinkingAccumRef.current = '';
      setChatMessages(prev => [...prev, assistantMsg]);
      setIsActive(true);

      try {
        chrome.action.setBadgeText({ text: '●' });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      } catch {}

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `${API_URL}/api/chat/subscribe/${convId}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );

        // If the server returns JSON (not SSE), the run is not active
        const contentType = res.headers.get('content-type') || '';
        console.log('[SSE] subscribeToRun response:', res.status, 'content-type:', contentType);
        if (contentType.includes('application/json')) {
          const body = await res.json();
          console.log('[SSE] subscribeToRun: no active run, got JSON:', body);
          setIsActive(false);
          abortRef.current = null;
          assistantMsgIdRef.current = '';
          // Remove the empty assistant message we added
          setChatMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
          return;
        }
        console.log('[SSE] subscribeToRun: got SSE stream, processing events...');

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
        if (!controller.signal.aborted) {
          console.warn('[subscribeToRun] Error:', err);
        }
      } finally {
        const myMsgId = assistantMsg.id;
        const stillActive = assistantMsgIdRef.current === myMsgId;
        console.log('[SSE] subscribeToRun finally — myMsgId:', myMsgId, 'stillActive:', stillActive);

        if (stillActive) {
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
          }
          flushBlocks();

          const finalText = blocksRef.current
            .filter(b => b.type === 'text')
            .map(b => (b as { content: string }).content)
            .join('\n');

          setChatMessages(prev =>
            prev.map(m =>
              m.id === myMsgId ? { ...m, content: finalText } : m,
            ),
          );

          setIsActive(false);
          abortRef.current = null;
          assistantMsgIdRef.current = '';

          try {
            chrome.action.setBadgeText({ text: '' });
          } catch {}
        } else {
          console.log('[SSE] subscribeToRun finally — skipped cleanup (navigated away)');
          abortRef.current = null;
        }
      }
    },
    [setChatMessages, setIsActive],
  );

  const handleStop = useCallback(() => {
    console.log('[SSE] handleStop called, aborting SSE fetch. assistantMsgId:', assistantMsgIdRef.current);
    // Clear refs immediately (not async) so the stale event guard works right away
    // and subscribeToRun can set up a new assistantMsgId without conflict
    assistantMsgIdRef.current = '';
    abortRef.current?.abort();
    abortRef.current = null;
    setIsActive(false);
    try {
      chrome.action.setBadgeText({ text: '' });
    } catch {}
  }, [setIsActive]);

  const resetConversation = useCallback(() => {
    console.log('[SSE] resetConversation — clearing all refs');
    conversationIdRef.current = '';
    assistantMsgIdRef.current = '';
    blocksRef.current = [];
    textAccumRef.current = '';
    thinkingAccumRef.current = '';
  }, []);

  return {
    sendMessage,
    subscribeToRun,
    handleStop,
    blocksRef,
    scheduleFlush,
    resetConversation,
    conversationIdRef,
  };
}
