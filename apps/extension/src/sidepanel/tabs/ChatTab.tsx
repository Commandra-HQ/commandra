/**
 * ChatTab — main chat interface for the side panel.
 * Delegates rendering to message-blocks.tsx and streaming to use-chat-stream.ts.
 */

import type { CrawlProgress, SelectedElement } from '@afe/shared';
import { MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useActiveChats } from '../contexts/active-chats.js';
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
import { ContextBar, PlanPanel, ChatInput } from './chat-layout.js';
import {
	AssistantMessage,
	CrawlingView,
	OnboardingView,
	UserMessage,
} from './message-blocks.js';
import { useChatStream } from './use-chat-stream.js';

export function ChatTab() {
	const { conversationId: externalConvId } = useParams<{ conversationId?: string }>();
	const navigate = useNavigate();
	const { activeChats, markActive, markDone } = useActiveChats();
	const [mode, setMode] = useState<ViewMode>('onboarding');
	const [domain, setDomain] = useState('');
	const [pathScope, setPathScope] = useState('');
	const [tabId, setTabId] = useState<number | null>(null);
	const [siteData, setSiteData] = useState<SiteData>({ site: null, pages: [] });
	const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);

	// Chat state
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [isActive, setIsActive] = useState(false);
	const [showContext, setShowContext] = useState(false);
	const [wsConnected, setWsConnected] = useState(false);
	const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
	const [pendingPlanApproval, setPendingPlanApproval] = useState<PlanApprovalRequest | null>(null);
	const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
	const [selectorActive, setSelectorActive] = useState(false);
	const [contextStatus, setContextStatus] = useState<{
		used: number;
		limit: number;
		percent: number;
	} | null>(null);
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
	const { sendMessage, handleStop, blocksRef, scheduleFlush } = useChatStream({
		setChatMessages,
		setIsActive,
		setContextStatus,
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
		chrome.runtime.sendMessage({ type: 'GET_SITE_DATA', payload: { domain: d } }, (response) => {
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
		});
	}, []);

	const updateCurrentTab = useCallback(() => {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (tab?.url && tab.id) {
				try {
					const parsed = new URL(tab.url);
					const newDomain = parsed.hostname;
					setDomain((prev) => {
						if (prev && prev !== newDomain && !externalConvId) {
							setChatMessages([]);
							setPendingApprovals([]);
							setSelectedElements([]);
						}
						return newDomain;
					});
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
	}, [loadSiteData, externalConvId]);

	useEffect(() => {
		updateCurrentTab();
		const onActivated = () => updateCurrentTab();
		chrome.tabs.onActivated.addListener(onActivated);
		chrome.tabs.onUpdated.addListener(onActivated);
		return () => {
			chrome.tabs.onActivated.removeListener(onActivated);
			chrome.tabs.onUpdated.removeListener(onActivated);
		};
	}, [updateCurrentTab]);

	// Load conversation when parent passes a conversationId
	useEffect(() => {
		if (externalConvId) {
			setMode('chat');
			loadConversation(externalConvId);
		} else {
			setChatMessages([]);
			setPendingApprovals([]);
		}
	}, [externalConvId]);

	useEffect(() => {
		chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' }, (res) => {
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
				const req = message as unknown as { requestId: string; payload: Record<string, unknown> };
				if (req.payload.type === 'plan_approval') {
					setPendingPlanApproval({
						requestId: req.requestId,
						planId: req.payload.planId as string,
						description: req.payload.description as string,
						steps: req.payload.steps as string[],
					});
				} else {
					setPendingApprovals((prev) => [
						...prev,
						{ ...(req.payload as unknown as ApprovalRequest), requestId: req.requestId },
					]);
				}
				const approvalPayload = req.payload;
				const isPlan = approvalPayload.type === 'plan_approval';
				const approvalContent = isPlan
					? `__approval__:plan:${req.requestId}:${approvalPayload.description}:${(approvalPayload.steps as string[]).join('|')}`
					: `__approval__:tool:${req.requestId}:${(approvalPayload as unknown as ApprovalRequest).action}:${(approvalPayload as unknown as ApprovalRequest).label || ''}:${(approvalPayload as unknown as ApprovalRequest).reason}`;

				blocksRef.current.push({ type: 'text' as const, content: approvalContent });
				scheduleFlush();
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

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [chatMessages]);

	// --- Handlers ---

	function handleIndexPage() {
		if (!tabId) return;
		setMode('indexing');
		chrome.runtime.sendMessage({ type: 'INDEX_PAGE_SINGLE', payload: { tabId } }, (response) => {
			if (response?.ok) loadSiteData(domain);
			setMode('chat');
		});
	}

	function handleIndexSite() {
		if (!tabId) return;
		setMode('crawling');
		chrome.runtime.sendMessage({ type: 'CRAWL_START', payload: { tabId, maxPages: 25 } });
	}

	function handleStopCrawl() {
		chrome.runtime.sendMessage({ type: 'CRAWL_STOP' });
	}

	function handleApproval(requestId: string, approved: boolean) {
		chrome.runtime.sendMessage({ type: 'APPROVAL_RESPONSE', requestId, approved });
		setPendingApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
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
			chrome.runtime.sendMessage({ type: 'SELECTOR_START', payload: { tabId } });
			setSelectorActive(true);
		}
	}

	function handleNewConversation() {
		setChatMessages([]);
		setPendingApprovals([]);
		navigate('/');
	}

	async function handleSend() {
		if (!input.trim() || isActive) return;

		const text = input.trim();
		const userMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: text,
			selectedElements: selectedElements.length > 0 ? selectedElements : undefined,
		};
		setChatMessages((prev) => [...prev, userMsg]);
		setInput('');

		let pageIndex: unknown = null;
		let currentUrl = '';

		if (tabId) {
			try {
				const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
				if (tabs[0]?.url) currentUrl = tabs[0].url;
			} catch {}
		}

		if (tabId) {
			try {
				const response = await new Promise<{ pageIndex?: unknown }>((resolve) => {
					chrome.tabs.sendMessage(tabId, { type: 'get_page_state' }, (r) => {
						if (chrome.runtime.lastError) resolve({});
						else resolve(r || {});
					});
				});
				pageIndex = response.pageIndex;
			} catch {}
		}

		if (!pageIndex && siteData.pages.length > 0) {
			const matchingPage = currentUrl
				? siteData.pages.find((p) => currentUrl.startsWith(p.url) || p.url.startsWith(currentUrl))
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
				.filter((p) => p.url !== currentPageUrl)
				.map((p) => ({
					url: p.url,
					urlPattern: p.urlPattern,
					title: p.title,
					pageType: p.pageType,
					elementCount: p.elements.length,
					keyElements: p.elements.slice(0, 20).map((el) => ({
						type: el.type,
						label: el.label,
						selector: el.selector,
					})),
					navigationLinks: p.navigationLinks.slice(0, 10),
				}));
		}

		const els = selectedElements.length > 0 ? selectedElements : undefined;
		setSelectedElements([]);

		await sendMessage(text, { pageIndex, selectedElements: els });
	}

	async function loadConversation(convId: string) {
		try {
			const token = await new Promise<string>((resolve) =>
				chrome.storage.local.get('authToken', (r) => resolve(r.authToken || '')),
			);
			if (!token) return;
			const res = await fetch(`${API_URL}/api/conversations/${convId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				navigate(`/chat/${convId}`, { replace: true });
				const loaded: ChatMessage[] = (data.messages || []).map(
					(m: {
						id: string;
						role: string;
						content: string;
						toolData?: {
							tools: { name: string; args: unknown; result: unknown; success: boolean }[];
						};
					}) => {
						const blocks: MessageBlock[] = [];
						if (m.role === 'assistant' && m.toolData?.tools?.length) {
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
						if (m.content?.trim()) {
							blocks.push({ type: 'text' as const, content: m.content });
						}
						return {
							id: m.id,
							role: m.role as 'user' | 'assistant',
							content: m.content,
							blocks: blocks.length > 0 ? blocks : [{ type: 'text' as const, content: m.content }],
						};
					},
				);
				setChatMessages(loaded);

				// Restore plan state if the conversation had an associated plan
				if (data.plan) {
					const plan = data.plan as {
						description: string;
						steps: { label: string; status: string }[];
					};
					setPlanState(plan);
					// Auto-show panel if plan is still in progress
					const hasActive = plan.steps.some(
						(s) => s.status === 'in_progress' || s.status === 'pending',
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
		chrome.runtime.sendMessage({ type: 'INDEX_PAGE_SINGLE', payload: { tabId } }, (response) => {
			if (response?.ok && domain) loadSiteData(domain);
			setIsReindexing(false);
		});
	}

	// --- Render ---

	if (!domain) {
		return (
			<div className="p-4">
				<p className="text-sm text-muted-foreground">Navigate to a web app to get started.</p>
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
		return <CrawlingView progress={crawlProgress} domain={domain} onStop={handleStopCrawl} />;
	}

	return (
		<div className="flex flex-col h-full">
			{/* Context bar */}
			<ContextBar
				domain={domain}
				siteData={siteData}
				showContext={showContext}
				setShowContext={setShowContext}
				contextStatus={contextStatus}
				planState={planState}
				showPlanPanel={showPlanPanel}
				setShowPlanPanel={setShowPlanPanel}
				isReindexing={isReindexing}
				onReindex={handleReindexPage}
				onIndexSite={handleIndexSite}
				onNavigateBack={() => navigate('/')}
			/>

			{showContext && (
				<div className="border-b border-border max-h-48 overflow-y-auto">
					{siteData.pages.map((page) => (
						<div key={page.url} className="px-4 py-1.5 border-b border-border/30">
							<p className="text-xs text-foreground truncate">{page.title || page.urlPattern}</p>
							<div className="flex items-center gap-2">
								<p className="text-xs text-muted-foreground">{page.elements.length} elements</p>
								{page.indexedAt && (
									<p className="text-xs text-muted-foreground">
										· {formatRelativeTime(page.indexedAt)}
									</p>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Plan panel */}
			{showPlanPanel && planState && (
				<PlanPanel planState={planState} onClose={() => setShowPlanPanel(false)} />
			)}

			{/* Messages */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{chatMessages.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12 px-4">
						<div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center mb-3">
							<MessageSquare size={18} className="text-muted-foreground" />
						</div>
						<p className="text-sm text-foreground font-medium">
							{domain ? `Chat about ${domain}` : 'New conversation'}
						</p>
						<p className="text-xs text-muted-foreground mt-1 text-center">
							Ask anything — navigate, click, type, or extract data.
						</p>
					</div>
				)}
				{chatMessages.map((msg) => (
					<div key={msg.id}>
						{msg.role === 'user' ? (
							<UserMessage msg={msg} />
						) : (
							<AssistantMessage msg={msg} isActive={isActive} onApprove={handleApproval} />
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

