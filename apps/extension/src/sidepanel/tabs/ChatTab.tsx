/**
 * ChatTab — main chat interface for the side panel.
 * Delegates rendering to message-blocks.tsx and streaming to use-chat-stream.ts.
 */

import type { CrawlProgress, SelectedElement } from '@afe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useActiveChats } from '../contexts/active-chats.js';
import { AnimatedVoxelLogo } from '../components/AnimatedVoxelLogo.js';
import type {
  ApprovalRequest,
  ChatMessage,
  MessageBlock,
  PlanApprovalRequest,
  SiteData,
  StoredPage,
  ViewMode,
} from './chat-types.js';
import { API_URL, formatRelativeTime, formatToolLabel } from './chat-types.js';
import { ContextSquare } from '../components/ContextSquare.js';
import { Tooltip } from '../components/Tooltip.js';
import { PlanPanel, ChatInput } from './chat-layout.js';
import {
  AssistantMessage,
  CrawlingView,
  OnboardingView,
  UserMessage,
} from './message-blocks.js';
import { useChatStream, type UsageTotal } from './use-chat-stream.js';
import { ChevronDown, ListChecks } from 'lucide-react';

export function ChatTab() {
  const { conversationId: externalConvId } = useParams<{
    conversationId?: string;
  }>();
  const navigate = useNavigate();
  const { activeChats, markActive, markDone } = useActiveChats();
  const [mode, setMode] = useState<ViewMode>('onboarding');
  const [domain, setDomain] = useState('');
  const [pathScope, setPathScope] = useState('');
  const [tabId, setTabId] = useState<number | null>(null);
  const [siteData, setSiteData] = useState<SiteData>({ site: null, pages: [] });
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(
    null,
  );

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isActive, setIsActive] = useState(false);
  // showContext state removed — pages list now accessible via menu
  const [wsConnected, setWsConnected] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>(
    [],
  );
  const [pendingPlanApproval, setPendingPlanApproval] =
    useState<PlanApprovalRequest | null>(null);
  const [selectedElements, setSelectedElements] = useState<SelectedElement[]>(
    [],
  );
  // originTabId removed — agent now always targets the current active tab
  // and uses list_tabs/switch_tab tools to change targets
  const isActiveRef = useRef(false);
  const [selectorActive, setSelectorActive] = useState(false);
  const [contextStatus, setContextStatus] = useState<{
    used: number;
    limit: number;
    percent: number;
  } | null>(null);
  const [usageTotal, setUsageTotal] = useState<UsageTotal | null>(null);
  const [planState, setPlanState] = useState<{
    description: string;
    steps: { label: string; status: string }[];
  } | null>(null);
  const [showPlanPanel, setShowPlanPanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const CHAT_INPUT_MAX_HEIGHT_PX = 120;
  const CHAT_INPUT_MIN_HEIGHT_PX = 40;

  // SSE streaming hook
  const {
    sendMessage,
    handleStop,
    subscribeToRun,
    blocksRef,
    scheduleFlush,
    resetConversation,
    conversationIdRef,
  } = useChatStream({
    setChatMessages,
    setIsActive,
    setContextStatus,
    setUsageTotal,
    setPlanState,
    setPendingApprovals,
    setPendingPlanApproval,
    setShowPlanPanel,
    planState,
    externalConvId,
    markActive,
    markDone,
    navigate,
  });

  // Auto-resize textarea
  useEffect(() => {
    const ta = chatInputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const h = Math.min(
      Math.max(ta.scrollHeight, CHAT_INPUT_MIN_HEIGHT_PX),
      CHAT_INPUT_MAX_HEIGHT_PX,
    );
    ta.style.height = `${h}px`;
  }, [input]);

  const loadSiteData = useCallback((d: string) => {
    chrome.runtime.sendMessage(
      { type: 'GET_SITE_DATA', payload: { domain: d } },
      response => {
        if (response?.site) {
          setSiteData(response);
          if (response.site.crawlStatus === 'crawling') {
            setMode('crawling');
          } else {
            setMode('chat');
          }
        } else {
          setMode('chat');
        }
      },
    );
  }, []);

  const updateCurrentTab = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.url && tab.id) {
        // Ignore chrome:// and about: URLs — these are transient (new tab, settings, etc.)
        if (
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('about:') ||
          tab.url === 'chrome://newtab/'
        ) {
          return;
        }
        try {
          const parsed = new URL(tab.url);
          const newDomain = parsed.hostname;
          if (newDomain === 'newtab' || !newDomain) return; // Ignore new tab page
          setDomain(newDomain);
          const segments = parsed.pathname.split('/').filter(Boolean);
          const scope =
            segments.length >= 2
              ? `/${segments[0]}/${segments[1]}`
              : segments.length === 1
                ? `/${segments[0]}`
                : '/';
          setPathScope(scope);
          setTabId(tab.id);
          loadSiteData(newDomain);
        } catch {}
      }
    });
  }, [loadSiteData]);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    updateCurrentTab();
    const onActivated = () => {
      // Debounce tab changes — rapid tab switches shouldn't cause rapid state updates
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(updateCurrentTab, 150);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onActivated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onActivated);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [updateCurrentTab]);

  // Keep ref in sync with isActive state
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Load conversation when conversationId changes (tab switch or initial mount).
  // Key insight: if the stream just navigated us here (conversation_id or done event),
  // conversationIdRef.current will match externalConvId — skip the DB reload since
  // live blocks in memory are more complete than what's persisted.
  useEffect(() => {
    if (!externalConvId) {
      // Navigated to new chat — always clear state.
      // If a run was streaming, handleNewConversation already detached the SSE viewer.
      // The server-side orchestrator continues independently (durable orchestrator).
      setChatMessages([]);
      setPendingApprovals([]);
      setContextStatus(null);
      setUsageTotal(null);
      setPlanState(null);
      setShowPlanPanel(false);
      resetConversation();
      return;
    }

    // If the stream navigated us here, messages are already in state — skip reload
    if (conversationIdRef.current === externalConvId) {
      setMode('chat');
      return;
    }

    // Different conversation (tab switch or history open) — load from DB
    setMode('chat');
    setChatMessages([]);
    setPendingApprovals([]);
    setContextStatus(null);
    setPlanState(null);
    resetConversation();
    loadConversation(externalConvId);
  }, [externalConvId]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, res => {
      if (res) setWsConnected(res.connected);
    });

    function handleMessage(message: { type: string; payload?: unknown }) {
      if (message.type === 'CRAWL_PROGRESS') {
        const progress = message.payload as CrawlProgress;
        setCrawlProgress(progress);
        if (progress.status === 'complete' || progress.status === 'stopped') {
          setMode('chat');
          if (domain) loadSiteData(domain);
        } else {
          setMode('crawling');
        }
      } else if (message.type === 'APPROVAL_REQUEST') {
        const req = message as unknown as {
          requestId: string;
          payload: Record<string, unknown>;
        };
        if (req.payload.type === 'plan_approval') {
          setPendingPlanApproval({
            requestId: req.requestId,
            planId: req.payload.planId as string,
            description: req.payload.description as string,
            steps: req.payload.steps as string[],
          });
        } else {
          setPendingApprovals(prev => [
            ...prev,
            {
              ...(req.payload as unknown as ApprovalRequest),
              requestId: req.requestId,
            },
          ]);
        }
      } else if (message.type === 'ELEMENT_SELECTED') {
        const els = message.payload as SelectedElement[];
        setSelectedElements(els);
        setSelectorActive(false);
      } else if (message.type === 'SELECTOR_CANCELLED') {
        setSelectorActive(false);
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [domain, loadSiteData]);

  // Listen for tab-action events from HubLayout menu
  useEffect(() => {
    function handleTabAction(e: Event) {
      const action = (e as CustomEvent).detail?.action;
      if (action === 'reindex') handleReindexPage();
      if (action === 'deep-index') handleIndexSite();
      if (action === 'copy-chat') {
        const text = chatMessages
          .map(
            m =>
              `${m.role === 'user' ? 'You' : 'Agent'}: ${m.content || m.blocks?.map(b => ('content' in b ? b.content : '')).join('') || ''}`,
          )
          .join('\n\n');
        navigator.clipboard.writeText(text);
      }
      if (action === 'compact') handleManualCompact();
    }
    window.addEventListener('commandra-tab-action', handleTabAction);
    return () =>
      window.removeEventListener('commandra-tab-action', handleTabAction);
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Expose contextStatus to HubLayout tab menu via custom event
  useEffect(() => {
    const detail = {
      contextStatus,
      usageTotal,
      conversationId: externalConvId || conversationIdRef.current,
    };
    window.dispatchEvent(
      new CustomEvent('commandra-context-update', { detail }),
    );
  }, [contextStatus, usageTotal]);

  // --- Handlers ---

  function handleIndexPage() {
    if (!tabId) return;
    setMode('indexing');
    chrome.runtime.sendMessage(
      { type: 'INDEX_PAGE_SINGLE', payload: { tabId } },
      response => {
        if (response?.ok) loadSiteData(domain);
        setMode('chat');
      },
    );
  }

  function handleIndexSite() {
    if (!tabId) return;
    setMode('crawling');
    chrome.runtime.sendMessage({
      type: 'CRAWL_START',
      payload: { tabId, maxPages: 25 },
    });
  }

  function handleStopCrawl() {
    chrome.runtime.sendMessage({ type: 'CRAWL_STOP' });
  }

  function handleApproval(requestId: string, approved: boolean) {
    chrome.runtime.sendMessage({
      type: 'APPROVAL_RESPONSE',
      requestId,
      approved,
    });
    setPendingApprovals(prev => prev.filter(a => a.requestId !== requestId));
    if (pendingPlanApproval?.requestId === requestId) {
      setPendingPlanApproval(null);
    }
  }

  function handleToggleSelector() {
    if (!tabId) return;
    if (selectorActive) {
      chrome.runtime.sendMessage({ type: 'SELECTOR_STOP', payload: { tabId } });
      setSelectorActive(false);
    } else {
      chrome.runtime.sendMessage({
        type: 'SELECTOR_START',
        payload: { tabId },
      });
      setSelectorActive(true);
    }
  }

  async function handleManualCompact() {
    const convId = externalConvId || conversationIdRef.current;
    if (!convId || isActive) return;
    if (chatMessages.length < 2) return;

    // Show compacting indicator as an assistant message
    const compactingMsgId = crypto.randomUUID();
    setChatMessages(prev => [
      ...prev,
      {
        id: compactingMsgId,
        role: 'assistant' as const,
        content: '',
        blocks: [
          { type: 'text' as const, content: '*Compacting conversation...*' },
        ],
      },
    ]);

    try {
      const stored = await chrome.storage.local.get(['authToken']);
      const token = stored.authToken;
      if (!token) return;
      const res = await fetch(`${API_URL}/api/chat/compact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ conversationId: convId }),
      });
      if (res.ok) {
        const data = await res.json();
        // Replace all messages with compacted summary
        setChatMessages([
          {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: data.summary,
            blocks: [
              {
                type: 'text' as const,
                content: `---\n**Conversation compacted** — ${data.messagesCompacted} messages saved\n\n${data.summary}\n\n_Transcript: \`${data.path}\`_\n\n---`,
              },
            ],
          },
        ]);
        // Re-estimate context after compaction
        const estimatedTokens = Math.round(data.summary.length / 4);
        setContextStatus({
          used: estimatedTokens,
          limit: contextStatus?.limit || 160_000,
          percent: Math.min(
            Math.round(
              (estimatedTokens / (contextStatus?.limit || 160_000)) * 100,
            ),
            100,
          ),
        });
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        // Remove compacting message and show error
        setChatMessages(prev =>
          prev.map(m =>
            m.id === compactingMsgId
              ? {
                  ...m,
                  blocks: [
                    {
                      type: 'text' as const,
                      content: `*Compaction failed: ${err.error}*`,
                    },
                  ],
                }
              : m,
          ),
        );
      }
    } catch (err) {
      console.error('Manual compact failed:', err);
      setChatMessages(prev =>
        prev.map(m =>
          m.id === compactingMsgId
            ? {
                ...m,
                blocks: [
                  {
                    type: 'text' as const,
                    content: '*Compaction failed — check your connection.*',
                  },
                ],
              }
            : m,
        ),
      );
    }
  }

  function handleNewConversation() {
    // Detach from current SSE stream (doesn't kill the server-side run — it continues via durable orchestrator)
    handleStop();
    setChatMessages([]);
    setPendingApprovals([]);
    setContextStatus(null);
    setUsageTotal(null);
    setPlanState(null);
    setShowPlanPanel(false);
    resetConversation();
    navigate('/chat', { replace: true });
  }

  async function handleSend() {
    if (!input.trim() || isActive) return;

    const text = input.trim();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      selectedElements:
        selectedElements.length > 0 ? selectedElements : undefined,
    };
    setChatMessages(prev => [...prev, userMsg]);
    setInput('');

    let pageIndex: unknown = null;
    let currentUrl = '';

    if (tabId) {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs[0]?.url) currentUrl = tabs[0].url;
      } catch {}
    }

    if (tabId) {
      try {
        const response = await new Promise<{ pageIndex?: unknown }>(resolve => {
          chrome.tabs.sendMessage(tabId, { type: 'get_page_state' }, r => {
            if (chrome.runtime.lastError) resolve({});
            else resolve(r || {});
          });
        });
        pageIndex = response.pageIndex;
      } catch {}
    }

    if (!pageIndex && siteData.pages.length > 0) {
      const matchingPage = currentUrl
        ? siteData.pages.find(
            p => currentUrl.startsWith(p.url) || p.url.startsWith(currentUrl),
          )
        : null;
      const currentPage = matchingPage || siteData.pages[0];
      pageIndex = {
        url: currentPage.url,
        title: currentPage.title,
        pageType: currentPage.pageType,
        elements: currentPage.elements,
        navigationLinks: currentPage.navigationLinks,
        timestamp: currentPage.indexedAt,
      };
    }

    if (siteData.pages.length > 0 && pageIndex) {
      const currentPageUrl = (pageIndex as { url?: string }).url;
      (pageIndex as Record<string, unknown>).sitePages = siteData.pages
        .filter(p => p.url !== currentPageUrl)
        .map(p => ({
          url: p.url,
          urlPattern: p.urlPattern,
          title: p.title,
          pageType: p.pageType,
          elementCount: p.elements.length,
          keyElements: p.elements.slice(0, 20).map(el => ({
            type: el.type,
            label: el.label,
            selector: el.selector,
          })),
          navigationLinks: p.navigationLinks.slice(0, 10),
        }));
    }

    const els = selectedElements.length > 0 ? selectedElements : undefined;
    setSelectedElements([]);

    // Always use the current active tab — agent uses switch_tab tool if it needs a different one
    await sendMessage(text, { pageIndex, selectedElements: els, tabId });
  }

  async function loadConversation(convId: string) {
    try {
      const token = await new Promise<string>(resolve =>
        chrome.storage.local.get('authToken', r => resolve(r.authToken || '')),
      );
      if (!token) return;
      const res = await fetch(`${API_URL}/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        navigate(`/chat/${convId}`, { replace: true });

        // If the conversation is still running on the server, skip DB load and subscribe
        // to the live stream instead — the event buffer has the complete state
        const convStatus = data.conversation?.status;
        if ((convStatus === 'running' || convStatus === 'paused') && !isActiveRef.current) {
          // Load only the user messages from DB (before the current run)
          const userMessages: ChatMessage[] = (data.messages || [])
            .filter((m: { role: string; toolData?: { partial?: boolean } }) =>
              m.role === 'user' || (!m.toolData?.partial && m.role === 'assistant'),
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              blocks: [{ type: 'text' as const, content: m.content }],
            }));
          // Remove the last assistant message if it's from the current run (partial or incomplete)
          // — the subscribe will replay it from the event buffer
          const lastMsg = userMessages[userMessages.length - 1];
          if (lastMsg?.role === 'assistant') {
            userMessages.pop();
          }
          setChatMessages(userMessages);
          subscribeToRun(convId);
          return;
        }

        // Completed conversation — load full history from DB
        // Filter out partial messages (from incremental persistence)
        const filteredMessages = (data.messages || []).filter(
          (m: { toolData?: { partial?: boolean } }) => !m.toolData?.partial,
        );
        const loaded: ChatMessage[] = filteredMessages.map(
          (m: {
            id: string;
            role: string;
            content: string;
            toolData?: {
              tools: {
                name: string;
                args: unknown;
                result: unknown;
                success: boolean;
              }[];
              streamBlocks?: {
                type: string;
                content?: string;
                toolName?: string;
                ts: number;
              }[];
            };
          }) => {
            const blocks: MessageBlock[] = [];

            // If we have stream blocks (full replay data), use them
            if (m.role === 'assistant' && m.toolData?.streamBlocks?.length) {
              for (const sb of m.toolData.streamBlocks) {
                if (sb.type === 'thinking' && sb.content) {
                  blocks.push({ type: 'thinking', content: sb.content });
                } else if (sb.type === 'text' && sb.content) {
                  blocks.push({ type: 'text', content: sb.content });
                } else if (sb.type === 'tool_start' && sb.toolName) {
                  // Find matching tool_end to get status
                  const matchingTool = m.toolData?.tools?.find(
                    t => t.name === sb.toolName,
                  );
                  blocks.push({
                    type: 'tool_call',
                    toolName: sb.toolName,
                    label: sb.content || formatToolLabel(sb.toolName),
                    status: matchingTool
                      ? matchingTool.success
                        ? 'success'
                        : 'error'
                      : 'success',
                    args: matchingTool?.args as Record<string, unknown>,
                    result: matchingTool?.result,
                  });
                } else if (sb.type === 'blocked' && sb.toolName) {
                  blocks.push({
                    type: 'blocked',
                    toolName: sb.toolName,
                    reason: sb.content || '',
                  });
                } else if (sb.type === 'sub_agent_start' && sb.toolName) {
                  // Reconstruct sub-agent block — collect subsequent sub_agent_action/end events
                  const agentId = sb.toolName;
                  const actions: {
                    toolName: string;
                    label: string;
                    status: 'success' | 'error';
                  }[] = [];
                  let summary: string | undefined;
                  let agentStatus: 'running' | 'success' | 'error' = 'success';
                  // Look ahead for sub_agent_action and sub_agent_end events with same agentId
                  const remaining = m.toolData!.streamBlocks!;
                  const startIdx = remaining.indexOf(sb);
                  for (let j = startIdx + 1; j < remaining.length; j++) {
                    const next = remaining[j];
                    if (next.type === 'sub_agent_action') {
                      actions.push({
                        toolName: next.toolName || '',
                        label: next.content || '',
                        status: next.content?.includes('failed')
                          ? 'error'
                          : 'success',
                      });
                    } else if (
                      next.type === 'sub_agent_end' &&
                      next.toolName === agentId
                    ) {
                      summary = next.content;
                      agentStatus = next.content?.includes('failed')
                        ? 'error'
                        : 'success';
                      break;
                    }
                  }
                  const [task, targetUrl] = (sb.content || '').split(' → ');
                  blocks.push({
                    type: 'sub_agent',
                    agentId,
                    task: task || '',
                    targetUrl: targetUrl || '',
                    status: agentStatus,
                    actions,
                    summary,
                  });
                }
                // Skip sub_agent_action and sub_agent_end — already consumed by sub_agent_start
              }
            } else if (m.role === 'assistant' && m.toolData?.tools?.length) {
              // Fallback: reconstruct from tool data only (no thinking blocks)
              for (const tool of m.toolData.tools) {
                blocks.push({
                  type: 'tool_call',
                  toolName: tool.name,
                  label: formatToolLabel(tool.name),
                  args: tool.args as Record<string, unknown>,
                  status: tool.success ? 'success' : 'error',
                  result: tool.result,
                });
              }
            }
            // Only add content as a text block if we didn't already extract
            // text blocks from streamBlocks (which include the same content)
            const hasTextBlock = blocks.some(b => b.type === 'text');
            if (m.content?.trim() && !hasTextBlock) {
              blocks.push({ type: 'text' as const, content: m.content });
            }
            return {
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              blocks:
                blocks.length > 0
                  ? blocks
                  : [{ type: 'text' as const, content: m.content }],
            };
          },
        );
        setChatMessages(loaded);

        // Estimate context usage from loaded messages so the indicator shows immediately
        const totalChars = filteredMessages.reduce(
          (sum: number, m: { content?: string }) =>
            sum + (m.content?.length || 0),
          0,
        );
        const estimatedTokens = Math.round(totalChars / 4);
        const defaultLimit = 160_000;
        setContextStatus({
          used: estimatedTokens,
          limit: defaultLimit,
          percent: Math.min(
            Math.round((estimatedTokens / defaultLimit) * 100),
            100,
          ),
        });

        // Restore plan state if the conversation had an associated plan
        if (data.plan) {
          const plan = data.plan as {
            description: string;
            steps: { label: string; status: string }[];
          };
          setPlanState(plan);
          // Auto-show panel if plan is still in progress
          const hasActive = plan.steps.some(
            s => s.status === 'in_progress' || s.status === 'pending',
          );
          if (hasActive) {
            setShowPlanPanel(true);
          }
        }

      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }

  function handleReindexPage() {
    if (!tabId || isReindexing) return;
    setIsReindexing(true);
    chrome.runtime.sendMessage(
      { type: 'INDEX_PAGE_SINGLE', payload: { tabId } },
      response => {
        if (response?.ok && domain) loadSiteData(domain);
        setIsReindexing(false);
      },
    );
  }

  // --- Render ---

  if (!domain) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">
          Navigate to a web app to get started.
        </p>
      </div>
    );
  }

  if (mode === 'onboarding') {
    return (
      <OnboardingView
        domain={domain}
        pathScope={pathScope}
        onIndexPage={handleIndexPage}
        onIndexSite={handleIndexSite}
      />
    );
  }

  if (mode === 'indexing') {
    return (
      <div className="p-4 flex items-center gap-2">
        <div className="h-4 w-4 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Indexing page...</p>
      </div>
    );
  }

  if (mode === 'crawling') {
    return (
      <CrawlingView
        progress={crawlProgress}
        domain={domain}
        onStop={handleStopCrawl}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Context indicator + plan panel */}
      {contextStatus && contextStatus.percent > 0 && (
        <div className="px-3 py-1 border-b border-border flex items-center gap-2 text-[10px] text-muted-foreground">
          <ContextSquare percent={contextStatus.percent} />
          <span className="tabular-nums">
            {Math.round(contextStatus.used / 1000)}K /{' '}
            {Math.round(contextStatus.limit / 1000)}K
          </span>
          <Tooltip
            side="bottom"
            align="start"
            content={
              usageTotal ? (
                <div className="space-y-1">
                  <div className="font-semibold text-foreground">
                    Context {contextStatus.percent}% used
                  </div>
                  <div className="space-y-0.5 text-muted-foreground">
                    <div className="flex justify-between gap-4">
                      <span>Input</span>
                      <span className="text-foreground tabular-nums">
                        {fmtK(usageTotal.inputTokens)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>Output</span>
                      <span className="text-foreground tabular-nums">
                        {fmtK(usageTotal.outputTokens)}
                      </span>
                    </div>
                    {usageTotal.cacheReadTokens > 0 && (
                      <div className="flex justify-between gap-4">
                        <span>Cached</span>
                        <span className="text-foreground tabular-nums">
                          {fmtK(usageTotal.cacheReadTokens)}
                        </span>
                      </div>
                    )}
                  </div>
                  {usageTotal.estimatedCostUsd > 0 && (
                    <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-border text-muted-foreground">
                      <span>Estimated cost</span>
                      <span className="text-foreground font-medium tabular-nums">
                        $
                        {usageTotal.estimatedCostUsd < 0.01
                          ? usageTotal.estimatedCostUsd.toFixed(4)
                          : usageTotal.estimatedCostUsd.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span>
                  Context: {Math.round(contextStatus.used / 1000)}K /{' '}
                  {Math.round(contextStatus.limit / 1000)}K tokens
                </span>
              )
            }
          >
            <ChevronDown size={12} />
          </Tooltip>
          {planState && !showPlanPanel && (
            <button
              type="button"
              onClick={() => setShowPlanPanel(true)}
              className="ml-auto p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Show plan"
            >
              <ListChecks size={13} />
            </button>
          )}
          {usageTotal && usageTotal.estimatedCostUsd > 0 && (
            <span className={`tabular-nums text-muted-foreground/40 ${planState && !showPlanPanel ? '' : 'ml-auto'}`}>
              $
              {usageTotal.estimatedCostUsd < 0.01
                ? usageTotal.estimatedCostUsd.toFixed(4)
                : usageTotal.estimatedCostUsd.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {showPlanPanel && planState && (
        <PlanPanel
          planState={planState}
          onClose={() => setShowPlanPanel(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <AnimatedVoxelLogo
              size={64}
              className="mb-4 text-muted-foreground/30"
            />
            {domain && (
              <p className="text-[10px] font-mono text-muted-foreground mt-2 border border-border px-2 py-1">
                {domain}
              </p>
            )}
          </div>
        )}
        {chatMessages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <UserMessage msg={msg} />
            ) : (
              <AssistantMessage
                msg={msg}
                isActive={isActive}
                onApprove={handleApproval}
              />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        input={input}
        setInput={setInput}
        isActive={isActive}
        chatMessages={chatMessages}
        selectedElements={selectedElements}
        selectorActive={selectorActive}
        chatInputRef={chatInputRef}
        onSend={handleSend}
        onStop={handleStop}
        onToggleSelector={handleToggleSelector}
        onNewConversation={handleNewConversation}
        onClearSelection={() => setSelectedElements([])}
      />
    </div>
  );
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
