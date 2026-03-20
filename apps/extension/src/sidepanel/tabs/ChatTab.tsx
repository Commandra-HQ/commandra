/**
 * ChatTab — main chat interface for the side panel.
 * Delegates rendering to message-blocks.tsx and streaming to use-chat-stream.ts.
 */

import type { CrawlProgress, SelectedElement } from '@afe/shared';
import {
	AlertCircle,
	ArrowLeft,
	Check,
	ChevronRight,
	Circle,
	Globe,
	ListChecks,
	Loader2,
	MessageSquare,
	MousePointer,
	Plus,
	RefreshCw,
	Send,
	Square,
	X,
} from 'lucide-react';
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

// --- Layout sub-components (kept in same file since they're tightly coupled to ChatTab) ---

function ContextBar({
	domain,
	siteData,
	showContext,
	setShowContext,
	contextStatus,
	planState,
	showPlanPanel,
	setShowPlanPanel,
	isReindexing,
	onReindex,
	onIndexSite,
	onNavigateBack,
}: {
	domain: string;
	siteData: SiteData;
	showContext: boolean;
	setShowContext: (v: boolean) => void;
	contextStatus: { used: number; limit: number; percent: number } | null;
	planState: { description: string; steps: { label: string; status: string }[] } | null;
	showPlanPanel: boolean;
	setShowPlanPanel: (v: boolean) => void;
	isReindexing: boolean;
	onReindex: () => void;
	onIndexSite: () => void;
	onNavigateBack: () => void;
}) {
	return (
		<div className="px-3 py-2 border-b border-border flex items-center gap-2">
			<button
				type="button"
				onClick={onNavigateBack}
				className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 flex-shrink-0"
				title="Back"
			>
				<ArrowLeft size={14} />
			</button>
			<button
				type="button"
				onClick={() => setShowContext(!showContext)}
				className="flex-1 min-w-0 text-left"
			>
				<p className="text-xs font-medium text-foreground truncate">{domain}</p>
				<p className="text-[10px] text-muted-foreground">
					{siteData.site?.totalElements ||
						siteData.pages.reduce((s, p) => s + p.elements.length, 0)}{' '}
					elements · {siteData.pages.length || siteData.site?.totalPages || 0} pages
				</p>
			</button>
			<div className="flex items-center gap-1 flex-shrink-0">
				{contextStatus && (
					<div
						className="relative w-6 h-6 flex-shrink-0 cursor-help"
						title={`Context: ${Math.round(contextStatus.used / 1000)}K / ${Math.round(contextStatus.limit / 1000)}K tokens (${contextStatus.percent}%)`}
					>
						<svg viewBox="0 0 24 24" className="w-6 h-6 -rotate-90">
							<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-secondary" />
							<circle
								cx="12" cy="12" r="10" fill="none" strokeWidth="2.5"
								strokeDasharray={`${contextStatus.percent * 0.628} 62.8`}
								strokeLinecap="round"
								className={contextStatus.percent > 80 ? 'text-red-500' : contextStatus.percent > 60 ? 'text-yellow-500' : 'text-green-500'}
							/>
						</svg>
						<span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-muted-foreground">
							{contextStatus.percent}
						</span>
					</div>
				)}
				{contextStatus && contextStatus.percent > 60 && (
					<span
						className="text-[9px] text-yellow-500 cursor-help"
						title={`Context ${contextStatus.percent}% full. Start a new chat if the agent stops responding.`}
					>
						{contextStatus.percent > 80 ? 'Compacting...' : `${contextStatus.percent}%`}
					</span>
				)}
				{planState && (
					<button
						type="button"
						onClick={() => setShowPlanPanel(!showPlanPanel)}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 relative"
						title="View plan"
					>
						<ListChecks size={12} />
						<span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center">
							{planState.steps.filter((s) => s.status === 'completed').length}/{planState.steps.length}
						</span>
					</button>
				)}
				<button
					type="button"
					onClick={onReindex}
					disabled={isReindexing}
					className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 disabled:opacity-50"
					title="Re-index page"
				>
					<RefreshCw size={12} className={isReindexing ? 'animate-spin' : ''} />
				</button>
				<button
					type="button"
					onClick={onIndexSite}
					className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50"
					title="Deep index site"
				>
					<Globe size={12} />
				</button>
				<button
					type="button"
					onClick={() => setShowContext(!showContext)}
					className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50"
					title={showContext ? 'Hide pages' : 'Show pages'}
				>
					<ChevronRight size={12} className={`transition-transform ${showContext ? 'rotate-90' : ''}`} />
				</button>
			</div>
		</div>
	);
}

function PlanPanel({
	planState,
	onClose,
}: {
	planState: { description: string; steps: { label: string; status: string }[] };
	onClose: () => void;
}) {
	return (
		<div className="border-b border-border bg-secondary/20 px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
			<div className="flex items-center justify-between">
				<p className="text-xs font-medium text-foreground">{planState.description}</p>
				<button type="button" onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground">
					<X size={10} />
				</button>
			</div>
			<div className="space-y-1">
				{planState.steps.map((step, i) => (
					<div key={`plan-step-${i}`} className="flex items-center gap-2 text-xs">
						{step.status === 'completed' ? (
							<Check size={12} className="text-green-500 flex-shrink-0" />
						) : step.status === 'in_progress' ? (
							<Loader2 size={12} className="text-blue-500 animate-spin flex-shrink-0" />
						) : step.status === 'failed' ? (
							<AlertCircle size={12} className="text-red-500 flex-shrink-0" />
						) : (
							<Circle size={12} className="text-muted-foreground flex-shrink-0" />
						)}
						<span className={step.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
							{step.label}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function ChatInput({
	input,
	setInput,
	isActive,
	chatMessages,
	selectedElements,
	selectorActive,
	chatInputRef,
	onSend,
	onStop,
	onToggleSelector,
	onNewConversation,
	onClearSelection,
}: {
	input: string;
	setInput: (v: string) => void;
	isActive: boolean;
	chatMessages: ChatMessage[];
	selectedElements: SelectedElement[];
	selectorActive: boolean;
	chatInputRef: React.RefObject<HTMLTextAreaElement | null>;
	onSend: () => void;
	onStop: () => void;
	onToggleSelector: () => void;
	onNewConversation: () => void;
	onClearSelection: () => void;
}) {
	return (
		<div className="p-3 border-t border-border">
			{chatMessages.length > 0 && !isActive && (
				<div className="flex justify-end mb-2">
					<button
						onClick={onNewConversation}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-secondary/50"
					>
						<Plus size={12} />
						New chat
					</button>
				</div>
			)}

			{selectedElements.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 mb-2 px-2 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-md">
					{selectedElements.length === 1 ? (
						<>
							<span className="text-xs text-blue-400 font-mono">
								&lt;{selectedElements[0].tag}&gt;
							</span>
							<span className="text-xs text-foreground truncate flex-1">
								{selectedElements[0].label || selectedElements[0].selector}
							</span>
						</>
					) : (
						<span className="text-xs text-foreground flex-1">
							{selectedElements.length} elements selected
							<span className="text-muted-foreground ml-1">
								({selectedElements.map((e) => e.tag).filter((t, i, a) => a.indexOf(t) === i).join(', ')})
							</span>
						</span>
					)}
					<button onClick={onClearSelection} className="text-xs text-muted-foreground hover:text-foreground shrink-0">
						✕
					</button>
				</div>
			)}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					onSend();
				}}
				className="flex gap-2 items-center"
			>
				<button
					type="button"
					onClick={onToggleSelector}
					title={selectorActive ? 'Cancel selector' : 'Select an element'}
					className={`flex items-center justify-center h-[40px] w-10 text-sm rounded-md border shrink-0 ${
						selectorActive
							? 'border-blue-500 bg-blue-500/10 text-blue-400'
							: 'border-input text-muted-foreground hover:text-foreground hover:bg-secondary'
					}`}
				>
					<MousePointer size={14} />
				</button>
				<div className="relative flex-1 flex min-h-[40px] max-h-[120px] border border-input rounded-md bg-background focus-within:ring-2 focus-within:ring-ring">
					<textarea
						ref={chatInputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								if (input.trim()) onSend();
							}
						}}
						placeholder={
							selectedElements.length > 0
								? selectedElements.length === 1
									? `Instruct about this ${selectedElements[0].tag}...`
									: `Instruct about ${selectedElements.length} elements...`
								: 'Ask about this page...'
						}
						disabled={isActive}
						rows={1}
						className="w-full min-h-[40px] max-h-[120px] py-2 pl-3 pr-10 text-sm resize-none border-0 bg-transparent focus:outline-none focus:ring-0 disabled:opacity-50 overflow-y-auto"
					/>
					{!isActive && (
						<button
							type="submit"
							disabled={!input.trim()}
							title="Send"
							className="absolute right-1.5 bottom-1.5 p-1.5 rounded-md text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none"
						>
							<Send size={16} />
						</button>
					)}
				</div>
				{isActive && (
					<button
						type="button"
						onClick={onStop}
						title="Stop"
						className="flex items-center justify-center h-[40px] w-10 text-sm font-medium text-red-400 border border-red-500/50 rounded-md hover:bg-red-500/10 shrink-0"
					>
						<Square size={16} />
					</button>
				)}
			</form>
		</div>
	);
}
