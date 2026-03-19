import type { CrawlProgress, SSEEvent, SelectedElement } from '@afe/shared';
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Camera,
	Check,
	CheckCircle2,
	ChevronRight,
	Circle,
	Clock,
	Download,
	Eye,
	FileDown,
	Globe,
	Keyboard,
	List,
	ListChecks,
	Loader2,
	MessageSquare,
	MousePointer,
	MoveVertical,
	Pilcrow,
	Send,
	Settings2,
	Square,
	Table2,
	X,
	RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useActiveChats } from '../contexts/active-chats.js';

/** Site data shapes returned by backend API (via background script) */
interface StoredSite {
	domain: string;
	totalPages: number;
	totalElements: number;
	lastIndexedAt: number;
	crawlStatus: 'idle' | 'crawling' | 'complete' | 'stopped';
}

interface StoredPage {
	domain: string;
	url: string;
	urlPattern: string;
	title: string;
	pageType: string;
	elements: {
		id: string;
		type: string;
		label: string;
		selector: string;
		fallbackSelectors: string[];
		attributes: Record<string, string>;
		visible: boolean;
		pageUrl: string;
	}[];
	navigationLinks: { label: string; href: string }[];
	indexedAt: number;
}

const API_URL = process.env.API_URL || 'http://localhost:3001';

type ViewMode = 'onboarding' | 'indexing' | 'crawling' | 'chat';

interface Plan {
	steps: string[];
	description?: string;
	/** Track execution status per step */
	stepStatus?: ('pending' | 'running' | 'done' | 'error')[];
}

// --- Block-based message model ---
// Each assistant message is a sequence of blocks rendered in order.

type MessageBlock =
	| { type: 'thinking'; content: string }
	| { type: 'text'; content: string }
	| {
			type: 'tool_call';
			toolName: string;
			label?: string;
			args?: Record<string, unknown>;
			status: 'running' | 'success' | 'error';
			error?: string;
			result?: unknown;
			screenshot?: string;
	  }
	| { type: 'blocked'; toolName: string; reason: string }
	| { type: 'plan'; plan: Plan }
	| {
			type: 'sub_agent';
			agentId: string;
			task: string;
			targetUrl: string;
			status: 'running' | 'success' | 'error';
			actions: {
				toolName: string;
				label: string;
				status: 'running' | 'success' | 'error';
				args?: Record<string, unknown>;
				result?: unknown;
				error?: string;
				screenshot?: string;
			}[];
			summary?: string;
	  };

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string; // plain text for user messages / final text for storage
	selectedElements?: SelectedElement[];
	blocks?: MessageBlock[]; // sequential blocks for assistant messages
}

interface ApprovalRequest {
	requestId: string;
	action: string;
	selector?: string;
	label?: string;
	reason: string;
}

interface PlanApprovalRequest {
	requestId: string;
	planId: string;
	description: string;
	steps: string[];
}

interface SiteData {
	site: StoredSite | null;
	pages: StoredPage[];
}

const TOOL_LABELS: Record<string, string> = {
	click_element: 'Clicking',
	type_text: 'Typing',
	select_option: 'Selecting',
	navigate: 'Navigating',
	get_page_state: 'Reading page',
	screenshot: 'Taking screenshot',
	scroll: 'Scrolling',
	wait_for_element: 'Waiting for element',
	read_text: 'Reading text',
	read_table: 'Reading table',
	export_data: 'Exporting data',
};

const TOOL_ICON_COMPONENTS: Record<
	string,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	click_element: MousePointer,
	type_text: Keyboard,
	select_option: List,
	navigate: ArrowRight,
	get_page_state: Eye,
	screenshot: Camera,
	scroll: MoveVertical,
	wait_for_element: Clock,
	read_text: Pilcrow,
	read_table: Table2,
	export_data: FileDown,
};

function formatToolLabel(toolName: string, label?: string): string {
	const verb = TOOL_LABELS[toolName] || toolName;
	return label ? `${verb}: ${label}` : verb;
}

function formatToolArgs(toolName: string, args?: Record<string, unknown>): string | null {
	if (!args) return null;
	if (toolName === 'navigate' && args.url) return String(args.url);
	if (toolName === 'click_element' && args.selector) return String(args.selector);
	if (toolName === 'type_text' && args.text) return `"${String(args.text).slice(0, 60)}"`;
	if (toolName === 'select_option' && args.value) return String(args.value);
	return null;
}

/**
 * Parse SSE frames from a buffer. Returns [parsedEvents, remainingBuffer].
 */
function parseSSEBuffer(buffer: string): [SSEEvent[], string] {
	const events: SSEEvent[] = [];
	const frames = buffer.split('\n\n');
	const remaining = frames.pop()!;

	for (const frame of frames) {
		for (const line of frame.split('\n')) {
			if (line.startsWith('data: ')) {
				try {
					events.push(JSON.parse(line.slice(6)) as SSEEvent);
				} catch {
					// Malformed JSON, skip
				}
			}
		}
	}

	return [events, remaining];
}

export function ChatTab() {
	const { conversationId: externalConvId } = useParams<{ conversationId?: string }>();
	const navigate = useNavigate();
	const { markActive, markDone } = useActiveChats();
	const [mode, setMode] = useState<ViewMode>('onboarding');
	const [domain, setDomain] = useState('');
	const [pathScope, setPathScope] = useState('');
	const [tabId, setTabId] = useState<number | null>(null);
	const [siteData, setSiteData] = useState<SiteData>({ site: null, pages: [] });
	const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);

	// Chat state — conversationId is now lifted to parent
	const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [isActive, setIsActive] = useState(false);
	const [showContext, setShowContext] = useState(false);
	const [wsConnected, setWsConnected] = useState(false);
	const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
	const [pendingPlanApproval, setPendingPlanApproval] = useState<PlanApprovalRequest | null>(null);
	const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
	const [selectorActive, setSelectorActive] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Conversation history state (for empty chat view)
	const [pastConversations, setPastConversations] = useState<
		{ id: string; title: string; messageCount: number; updatedAt: string }[]
	>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);

	// Re-index state
	const [isReindexing, setIsReindexing] = useState(false);

	// Streaming refs
	const abortRef = useRef<AbortController | null>(null);
	const assistantMsgIdRef = useRef<string>('');
	const blocksRef = useRef<MessageBlock[]>([]);
	const textAccumRef = useRef('');
	const thinkingAccumRef = useRef('');
	const rafRef = useRef<number>(0);
	const chatInputRef = useRef<HTMLTextAreaElement>(null);

	// Max height for chat textarea ~5 lines (line-height ~1.5rem)
	const CHAT_INPUT_MAX_HEIGHT_PX = 120;

	// Auto-resize textarea up to max height (~5 lines), then scroll
	const CHAT_INPUT_MIN_HEIGHT_PX = 40;
	useEffect(() => {
		const ta = chatInputRef.current;
		if (!ta) return;
		ta.style.height = 'auto';
		const h = Math.min(Math.max(ta.scrollHeight, CHAT_INPUT_MIN_HEIGHT_PX), CHAT_INPUT_MAX_HEIGHT_PX);
		ta.style.height = `${h}px`;
	}, [input]);

	const loadSiteData = useCallback((d: string) => {
		chrome.runtime.sendMessage({ type: 'GET_SITE_DATA', payload: { domain: d } }, (response) => {
			if (response?.site) {
				setSiteData(response);
				if (response.site.crawlStatus === 'crawling') {
					setMode('crawling');
				} else {
					// Always allow chat — even without indexed pages, user can chat about the current page
					setMode('chat');
				}
			} else {
				// No site data yet — still allow chatting about the current page
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
					setDomain(parsed.hostname);
					const segments = parsed.pathname.split('/').filter(Boolean);
					const scope =
						segments.length >= 2
							? `/${segments[0]}/${segments[1]}`
							: segments.length === 1
								? `/${segments[0]}`
								: '/';
					setPathScope(scope);
					setTabId(tab.id);
					loadSiteData(parsed.hostname);
				} catch {}
			}
		});
	}, [loadSiteData]);

	useEffect(() => {
		updateCurrentTab();
		loadConversationHistory();
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
			loadConversation(externalConvId);
		} else {
			// New chat — clear state
			setChatMessages([]);
			setPendingApprovals([]);
			loadConversationHistory();
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
					setPendingApprovals((prev) => [...prev, { ...(req.payload as unknown as ApprovalRequest), requestId: req.requestId }]);
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

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [chatMessages]);

	function handleIndexPage() {
		if (!tabId) return;
		setMode('indexing');
		chrome.runtime.sendMessage({ type: 'INDEX_PAGE_SINGLE', payload: { tabId } }, (response) => {
			if (response?.ok) {
				loadSiteData(domain);
			}
			// Always go to chat mode — user should be able to chat even if indexing failed
			setMode('chat');
		});
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

	/**
	 * Flush accumulated blocks into React state via rAF batching.
	 */
	function flushBlocks() {
		const id = assistantMsgIdRef.current;
		if (!id) return;

		// If there's pending text, make sure the last text block is up to date
		const blocks = [...blocksRef.current];

		setChatMessages((prev) => prev.map((m) => (m.id === id ? { ...m, blocks: [...blocks] } : m)));
		rafRef.current = 0;
	}

	function scheduleFlush() {
		if (!rafRef.current) {
			rafRef.current = requestAnimationFrame(flushBlocks);
		}
	}

	/**
	 * Append or update the current text block in the blocks array.
	 */
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

	/**
	 * Append or update the current thinking block in the blocks array.
	 */
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

	/**
	 * Core streaming function. Sends a message and consumes the SSE stream.
	 */
	async function sendMessage(text: string, extraBody?: Record<string, unknown>) {
		const stored = await chrome.storage.local.get(['authToken']);
		const token = stored.authToken;

		// Create assistant message placeholder with empty blocks
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

		// Notify parent of active stream
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
						switch (event.type) {
							case 'text_delta':
								appendText(event.text);
								scheduleFlush();
								break;

							case 'thinking': {
								// New thinking phase — always push a fresh thinking block
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
								// Remove trailing thinking block only if it has no content (empty spinner)
								if (
									blocks.length > 0 &&
									blocks[blocks.length - 1].type === 'thinking' &&
									!(blocks[blocks.length - 1] as { content: string }).content
								) {
									blocks.pop();
								}
								// Reset accumulators for the next phase
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
								// Update the matching tool_call block
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
								// Update the plan block's step status
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
								// These are informational — the plan block already renders
								break;

							case 'sub_agent_start': {
								const blocks = blocksRef.current;
								// Remove empty thinking block
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

			// Also extract final plain text content for storage
			const finalText = blocksRef.current
				.filter((b) => b.type === 'text')
				.map((b) => (b as { content: string }).content)
				.join('\n');

			setChatMessages((prev) =>
				prev.map((m) => (m.id === assistantMsgIdRef.current ? { ...m, content: finalText } : m)),
			);

			setIsActive(false);
			abortRef.current = null;
			assistantMsgIdRef.current = '';
		}
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

		// Build page context — send current page + all indexed pages with elements
		let pageIndex: unknown = null;
		let currentUrl = '';

		// Get current tab URL for matching
		if (tabId) {
			try {
				const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
				if (tabs[0]?.url) currentUrl = tabs[0].url;
			} catch {}
		}

		// Try live page state from content script first
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

		// Fallback: find the stored page matching the current URL (not just pages[0])
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

		// Include ALL indexed pages with their key elements so the agent knows the full app
		if (siteData.pages.length > 0 && pageIndex) {
			const currentPageUrl = (pageIndex as { url?: string }).url;
			(pageIndex as Record<string, unknown>).sitePages = siteData.pages
				.filter((p) => p.url !== currentPageUrl) // exclude current (already detailed)
				.map((p) => ({
					url: p.url,
					urlPattern: p.urlPattern,
					title: p.title,
					pageType: p.pageType,
					elementCount: p.elements.length,
					// Include key elements so agent knows what's available on each page
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

	function handleStop() {
		abortRef.current?.abort();
		setIsActive(false);
	}

	function handleApproval(requestId: string, approved: boolean) {
		chrome.runtime.sendMessage({ type: 'APPROVAL_RESPONSE', requestId, approved });
		setPendingApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
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

	async function loadConversationHistory() {
		try {
			setLoadingHistory(true);
			const token = await new Promise<string>((resolve) =>
				chrome.storage.local.get('token', (r) => resolve(r.token || '')),
			);
			if (!token) return;
			const res = await fetch(`${API_URL}/api/conversations`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setPastConversations(data.conversations || []);
			}
		} catch (err) {
			console.error('Failed to load conversation history:', err);
		} finally {
			setLoadingHistory(false);
		}
	}

	async function loadConversation(convId: string) {
		try {
			const token = await new Promise<string>((resolve) =>
				chrome.storage.local.get('token', (r) => resolve(r.token || '')),
			);
			if (!token) return;
			const res = await fetch(`${API_URL}/api/conversations/${convId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				navigate(`/chat/${convId}`, { replace: true });
				const loaded: ChatMessage[] = (data.messages || []).map(
					(m: { id: string; role: string; content: string }) => ({
						id: m.id,
						role: m.role as 'user' | 'assistant',
						content: m.content,
						blocks: [{ type: 'text' as const, content: m.content }],
					}),
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
			if (response?.ok && domain) {
				loadSiteData(domain);
			}
			setIsReindexing(false);
		});
	}

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
			<div className="px-4 py-2 border-b border-border flex items-center justify-between">
				<button
					onClick={() => navigate('/')}
					className="p-1 mr-2 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50"
					title="Back to Hub"
				>
					<ArrowLeft size={14} />
				</button>
				<button
					onClick={() => setShowContext(!showContext)}
					className="flex-1 text-left hover:opacity-80"
				>
					<span className="text-xs text-muted-foreground">
						{domain} · {siteData.site?.totalElements || siteData.pages.reduce((s, p) => s + p.elements.length, 0)} elements · {siteData.pages.length || siteData.site?.totalPages || 0} pages
						{siteData.site?.lastIndexedAt
							? ` · Last: ${formatRelativeTime(siteData.site.lastIndexedAt)}`
							: ''}
					</span>
				</button>
				<div className="flex items-center gap-1.5 ml-2">
					<div className="relative group">
						<button
							onClick={handleReindexPage}
							disabled={isReindexing}
							className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50 disabled:opacity-50"
						>
							<RefreshCw size={12} className={isReindexing ? 'animate-spin' : ''} />
						</button>
						<span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] text-primary-foreground bg-foreground rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
							Re-index page
						</span>
					</div>
					<div className="relative group">
						<button
							onClick={handleIndexSite}
							className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50"
						>
							<Globe size={12} />
						</button>
						<span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] text-primary-foreground bg-foreground rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
							Deep index site
						</span>
					</div>
					<div className="relative group">
						<button
							onClick={() => setShowContext(!showContext)}
							className="p-1 text-muted-foreground hover:text-foreground"
						>
							<span className="text-xs">{showContext ? '▲' : '▼'}</span>
						</button>
						<span className="absolute top-full right-0 mt-1.5 px-2 py-1 text-[10px] text-primary-foreground bg-foreground rounded whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
							{showContext ? 'Hide pages' : 'Show pages'}
						</span>
					</div>
				</div>
			</div>

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

			{/* Approval Requests */}
			{pendingApprovals.map((req) => (
				<div
					key={req.requestId}
					className="border-b border-yellow-500/30 bg-yellow-500/5 px-4 py-3 space-y-2"
				>
					<p className="text-xs font-medium text-foreground">
						Agent wants to:{' '}
						<span className="font-semibold">{TOOL_LABELS[req.action] || req.action}</span>
						{req.label ? ` "${req.label}"` : ''}
					</p>
					<p className="text-xs text-muted-foreground">{req.reason}</p>
					<div className="flex gap-2">
						<button
							onClick={() => handleApproval(req.requestId, true)}
							className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
						>
							Approve
						</button>
						<button
							onClick={() => handleApproval(req.requestId, false)}
							className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
						>
							Reject
						</button>
					</div>
				</div>
			))}

			{/* Plan Approval */}
			{pendingPlanApproval && (
				<div className="border-b border-blue-500/30 bg-blue-500/5 px-4 py-3 space-y-2">
					<p className="text-xs font-semibold text-foreground">
						Plan requires approval
					</p>
					<p className="text-xs text-muted-foreground">{pendingPlanApproval.description}</p>
					<ol className="list-decimal list-inside space-y-0.5 pl-1">
						{pendingPlanApproval.steps.map((step, i) => (
							<li key={i} className="text-xs text-foreground">{step}</li>
						))}
					</ol>
					<div className="flex gap-2 pt-1">
						<button
							onClick={() => {
								handleApproval(pendingPlanApproval.requestId, true);
								setPendingPlanApproval(null);
							}}
							className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
						>
							Approve Plan
						</button>
						<button
							onClick={() => {
								handleApproval(pendingPlanApproval.requestId, false);
								setPendingPlanApproval(null);
							}}
							className="px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
						>
							Reject
						</button>
					</div>
				</div>
			)}

			{/* Messages */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{chatMessages.length === 0 && (
					<div className="py-4">
						<div className="text-center mb-4">
							<p className="text-sm text-muted-foreground">Ask anything about this page or site.</p>
							<p className="text-xs text-muted-foreground mt-1">
								"What can I do here?" · "Click the login button" · "Type hello in the search box"
							</p>
						</div>
						{loadingHistory && (
							<p className="text-xs text-muted-foreground text-center">Loading history...</p>
						)}
						{pastConversations.length > 0 && (
							<div className="mt-4 space-y-1">
								<p className="text-xs font-medium text-muted-foreground px-1 mb-2">
									Recent conversations
								</p>
								{pastConversations.slice(0, 10).map((conv) => (
									<button
										key={conv.id}
										onClick={() => loadConversation(conv.id)}
										className="w-full text-left px-3 py-2 rounded-md hover:bg-secondary/50 transition-colors"
									>
										<p className="text-xs text-foreground truncate">
											{conv.title || 'Untitled'}
										</p>
										<div className="flex items-center gap-2 mt-0.5">
											<span className="text-[10px] text-muted-foreground flex items-center gap-1">
												<MessageSquare size={10} />
												{conv.messageCount}
											</span>
											<span className="text-[10px] text-muted-foreground">
												{formatRelativeTime(new Date(conv.updatedAt).getTime())}
											</span>
										</div>
									</button>
								))}
							</div>
						)}
					</div>
				)}
				{chatMessages.map((msg) => (
					<div key={msg.id}>
						{msg.role === 'user' ? (
							<UserMessage msg={msg} />
						) : (
							<AssistantMessage
								msg={msg}
								isActive={isActive}
							/>
						)}
					</div>
				))}

				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="p-3 border-t border-border">
				{chatMessages.length > 0 && !isActive && (
					<div className="flex justify-end mb-2">
						<button
							onClick={handleNewConversation}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							New conversation
						</button>
					</div>
				)}

				{/* Selected element chip(s) */}
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
									(
									{selectedElements
										.map((e) => e.tag)
										.filter((t, i, a) => a.indexOf(t) === i)
										.join(', ')}
									)
								</span>
							</span>
						)}
						<button
							onClick={() => setSelectedElements([])}
							className="text-xs text-muted-foreground hover:text-foreground shrink-0"
						>
							✕
						</button>
					</div>
				)}

				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSend();
					}}
					className="flex gap-2 items-center"
				>
					<button
						type="button"
						onClick={handleToggleSelector}
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
									if (input.trim()) handleSend();
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
							onClick={handleStop}
							title="Stop"
							className="flex items-center justify-center h-[40px] w-10 text-sm font-medium text-red-400 border border-red-500/50 rounded-md hover:bg-red-500/10 shrink-0"
						>
							<Square size={16} />
						</button>
					)}
				</form>
			</div>
		</div>
	);
}

// --- Sub-components ---

function UserMessage({ msg }: { msg: ChatMessage }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground">
				{msg.selectedElements && msg.selectedElements.length > 0 && (
					<div className="flex flex-wrap gap-1 mb-1.5">
						{msg.selectedElements.length === 1 ? (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 text-xs font-mono">
								<span className="opacity-70">&lt;{msg.selectedElements[0].tag}&gt;</span>
								<span className="truncate max-w-[160px]">
									{msg.selectedElements[0].label || msg.selectedElements[0].selector}
								</span>
							</span>
						) : (
							msg.selectedElements.map((el, i) => (
								<span
									key={i}
									className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/15 text-xs font-mono"
								>
									<span className="opacity-70">&lt;{el.tag}&gt;</span>
									<span className="truncate max-w-[100px]">{el.label || el.selector}</span>
								</span>
							))
						)}
					</div>
				)}
				{msg.content}
			</div>
		</div>
	);
}

function AssistantMessage({
	msg,
	isActive,
}: {
	msg: ChatMessage;
	isActive: boolean;
}) {
	const rawBlocks = msg.blocks;

	// No blocks yet — show nothing (or a subtle placeholder)
	if (!rawBlocks || rawBlocks.length === 0) {
		return null;
	}

	// Filter out empty thinking blocks from iterations 2+ in tool-use loops
	// (Anthropic only emits thinking on the first iteration of an agentic turn)
	const blocks = rawBlocks.filter(
		(b, i) => b.type !== 'thinking' || b.content || i === rawBlocks.length - 1,
	);

	if (blocks.length === 0) return null;

	const lastBlock = blocks[blocks.length - 1];
	const isThinkingAtEnd = lastBlock.type === 'thinking';

	return (
		<div className="flex justify-start">
			<div className="max-w-[90%] space-y-2">
				{blocks.map((block, i) => {
					switch (block.type) {
						case 'thinking':
							return (
								<ThinkingBlock key={i} content={block.content} isLast={i === blocks.length - 1} />
							);
						case 'text': {
							return <TextBlock key={i} content={block.content} />;
						}
						case 'tool_call':
							return <ToolCallBlock key={i} block={block} />;
						case 'sub_agent':
							return <SubAgentBlock key={i} block={block} />;
						case 'blocked':
							return <BlockedBlock key={i} toolName={block.toolName} reason={block.reason} />;
						case 'plan':
							return (
								<PlanBlock
									key={i}
									plan={block.plan}
								/>
							);
						default:
							return null;
					}
				})}

				{/* If no visible content yet and we're thinking */}
				{blocks.length === 0 && isActive && <ThinkingBlock content="" isLast />}
			</div>
		</div>
	);
}

function ThinkingBlock({ content, isLast }: { content: string; isLast: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const isStreaming = isLast && !content; // Will auto-expand once content arrives
	const hasContent = content.length > 0;

	// Auto-expand while streaming thinking content
	const showContent = expanded || (isLast && hasContent);

	return (
		<div className="text-xs text-muted-foreground py-1">
			<button
				type="button"
				className="flex items-center gap-2 hover:text-foreground transition-colors"
				onClick={() => hasContent && setExpanded(!expanded)}
			>
				{isLast && !content ? (
					<Loader2 size={12} className="animate-spin shrink-0" />
				) : isLast && hasContent ? (
					<Loader2 size={12} className="animate-spin shrink-0" />
				) : (
					<ChevronRight
						size={12}
						className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
					/>
				)}
				<span>Thinking{isLast && hasContent ? '...' : ''}</span>
			</button>
			{showContent && hasContent && (
				<div className="mt-1 ml-5 text-[11px] text-muted-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed">
					{content}
				</div>
			)}
		</div>
	);
}

function TextBlock({ content }: { content: string }) {
	if (!content.trim()) return null;
	return (
		<div className="rounded-lg px-3 py-2 text-sm bg-secondary text-foreground prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-xs">
			<ReactMarkdown>{content}</ReactMarkdown>
		</div>
	);
}

function ToolCallBlock({
	block,
}: {
	block: Extract<MessageBlock, { type: 'tool_call' }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const IconComponent = TOOL_ICON_COMPONENTS[block.toolName] || Settings2;
	const label = formatToolLabel(block.toolName, block.label);
	const argsPreview = formatToolArgs(block.toolName, block.args);

	const statusColor =
		block.status === 'running'
			? 'border-blue-500/40 bg-blue-500/5'
			: block.status === 'success'
				? 'border-green-500/30 bg-green-500/5'
				: 'border-red-500/30 bg-red-500/5';

	const statusIcon =
		block.status === 'running' ? (
			<Loader2 size={12} className="text-blue-400 animate-spin shrink-0" />
		) : block.status === 'success' ? (
			<Check size={12} className="text-green-400 shrink-0" />
		) : (
			<X size={12} className="text-red-400 shrink-0" />
		);

	return (
		<div className={`border rounded-md text-xs ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<IconComponent size={13} className="shrink-0 text-muted-foreground" />
				<span className="flex-1 truncate text-foreground">
					{label}
					{argsPreview && (
						<span className="text-muted-foreground ml-1 font-mono">{argsPreview}</span>
					)}
				</span>
				{statusIcon}
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
					{block.args && (
						<div>
							<span className="text-muted-foreground">Args: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{JSON.stringify(block.args)}
							</code>
						</div>
					)}
					{block.error && <div className="text-red-400">Error: {String(block.error)}</div>}
					{block.result != null && !block.screenshot && (
						<div>
							<span className="text-muted-foreground">Result: </span>
							<code className="text-[10px] text-foreground/70 font-mono break-all">
								{typeof block.result === 'string'
									? block.result.slice(0, 300)
									: JSON.stringify(block.result).slice(0, 300)}
							</code>
						</div>
					)}
				</div>
			)}

			{/* Screenshot thumbnail — always visible (not inside expanded) */}
			{typeof block.screenshot === 'string' && (
				<div className="px-2.5 pb-2">
					<img
						src={`data:image/jpeg;base64,${block.screenshot}`}
						alt="Screenshot"
						className="rounded border border-border/30 max-h-40 w-full object-contain cursor-pointer"
						onClick={() => {
							const img = new Image();
							img.src = `data:image/jpeg;base64,${block.screenshot}`;
							const w = window.open('');
							w?.document.body.appendChild(img);
						}}
					/>
				</div>
			)}

			{/* Download button for export_data results */}
			{block.toolName === 'export_data' && block.status === 'success' && block.result != null && (
				<div className="px-2.5 pb-2">
					<button
						onClick={() => {
							const r = block.result as { content?: string; filename?: string; format?: string };
							if (!r.content) return;
							const mimeType = r.format === 'json' ? 'application/json' : 'text/csv';
							const blob = new Blob([r.content], { type: mimeType });
							const url = URL.createObjectURL(blob);
							const a = document.createElement('a');
							a.href = url;
							a.download = r.filename || 'export.csv';
							a.click();
							URL.revokeObjectURL(url);
						}}
						className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground bg-secondary border border-border rounded hover:bg-secondary/80"
					>
						<Download size={13} />
						<span>Download {(block.result as { filename?: string }).filename || 'export'}</span>
					</button>
				</div>
			)}
		</div>
	);
}

function SubAgentBlock({
	block,
}: {
	block: Extract<MessageBlock, { type: 'sub_agent' }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const statusColor =
		block.status === 'running'
			? 'border-purple-500/40 bg-purple-500/5'
			: block.status === 'success'
				? 'border-green-500/30 bg-green-500/5'
				: 'border-red-500/30 bg-red-500/5';

	const statusIcon =
		block.status === 'running' ? (
			<Loader2 size={12} className="text-purple-400 animate-spin shrink-0" />
		) : block.status === 'success' ? (
			<Check size={12} className="text-green-400 shrink-0" />
		) : (
			<X size={12} className="text-red-400 shrink-0" />
		);

	// Extract domain from URL for display
	let domain = block.targetUrl;
	try {
		domain = new URL(block.targetUrl).hostname;
	} catch {
		/* keep full url */
	}

	return (
		<div className={`border rounded-md text-xs ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<Globe size={13} className="shrink-0 text-purple-400" />
				<span className="flex-1 truncate text-foreground">
					<span className="font-medium text-purple-300">Sub-agent</span>
					<span className="text-muted-foreground ml-1">on {domain}</span>
				</span>
				{block.actions.length > 0 && (
					<span className="text-muted-foreground text-[10px]">
						{block.actions.length} action{block.actions.length !== 1 ? 's' : ''}
					</span>
				)}
				{statusIcon}
			</button>

			{expanded && (
				<div className="px-2.5 pb-2 space-y-1.5 border-t border-border/30 pt-1.5">
					<div>
						<span className="text-muted-foreground">Task: </span>
						<span className="text-foreground/80">{block.task}</span>
					</div>
					{block.actions.length > 0 && (
						<div className="space-y-1">
							{block.actions.map((action, j) => (
								<ToolCallBlock
									key={j}
									block={{
										type: 'tool_call',
										toolName: action.toolName,
										label: action.label,
										status: action.status,
										args: action.args,
										result: action.result,
										error: action.error,
										screenshot: action.screenshot,
									}}
								/>
							))}
						</div>
					)}
					{block.summary && (
						<div>
							<span className="text-muted-foreground">Result: </span>
							<span className="text-foreground/80">{block.summary.slice(0, 300)}</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function BlockedBlock({ toolName, reason }: { toolName: string; reason: string }) {
	return (
		<div className="border border-red-500/30 bg-red-500/5 rounded-md px-2.5 py-1.5 text-xs">
			<span className="text-red-400 font-medium">Blocked: </span>
			<span className="text-foreground">{TOOL_LABELS[toolName] || toolName}</span>
			<span className="text-muted-foreground"> — {reason}</span>
		</div>
	);
}

function PlanStepIcon({ status }: { status: 'pending' | 'running' | 'done' | 'error' }) {
	switch (status) {
		case 'pending':
			return <Circle size={14} className="text-muted-foreground/50" />;
		case 'running':
			return <Loader2 size={14} className="text-blue-400 animate-spin" />;
		case 'done':
			return <CheckCircle2 size={14} className="text-green-400" />;
		case 'error':
			return <AlertCircle size={14} className="text-red-400" />;
	}
}

function PlanBlock({ plan }: { plan: Plan }) {
	const statuses = plan.stepStatus || plan.steps.map(() => 'pending' as const);
	const doneCount = statuses.filter((s) => s === 'done').length;
	const hasStarted = statuses.some((s) => s !== 'pending');
	const allDone = doneCount === plan.steps.length && plan.steps.length > 0;

	return (
		<div className="rounded-lg border border-border bg-secondary/50 overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
				<ListChecks size={14} className="text-muted-foreground" />
				<span className="text-xs font-medium text-foreground flex-1">
					{plan.description || 'Execution Plan'}
				</span>
				<span className="text-[10px] text-muted-foreground tabular-nums">
					{doneCount}/{plan.steps.length}
				</span>
			</div>

			{/* Progress bar */}
			{hasStarted && !allDone && (
				<div className="h-0.5 bg-secondary">
					<div
						className="h-full bg-blue-500 transition-all duration-500"
						style={{ width: `${(doneCount / plan.steps.length) * 100}%` }}
					/>
				</div>
			)}
			{allDone && <div className="h-0.5 bg-green-500" />}

			{/* Steps */}
			<div className="px-3 py-2 space-y-1.5">
				{plan.steps.map((step, i) => {
					const status = statuses[i] || 'pending';
					return (
						<div
							key={i}
							className={`flex items-start gap-2 text-xs transition-opacity ${
								status === 'pending' && hasStarted ? 'opacity-50' : ''
							}`}
						>
							<span className="shrink-0 mt-px">
								<PlanStepIcon status={status} />
							</span>
							<span className={status === 'done' ? 'text-muted-foreground' : 'text-foreground'}>
								{step}
							</span>
						</div>
					);
				})}
			</div>

			{/* Completion */}
			{allDone && (
				<div className="flex items-center gap-1.5 px-3 pb-2.5 text-xs text-green-400">
					<CheckCircle2 size={12} />
					<span>All steps completed</span>
				</div>
			)}
		</div>
	);
}

function OnboardingView({
	domain,
	pathScope,
	onIndexPage,
	onIndexSite,
}: {
	domain: string;
	pathScope: string;
	onIndexPage: () => void;
	onIndexSite: () => void;
}) {
	const scopeLabel = pathScope === '/' ? domain : `${domain}${pathScope}`;

	return (
		<div className="p-4 space-y-4">
			<div>
				<h3 className="text-sm font-semibold text-foreground">Teach the agent about this app</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Index <span className="font-medium text-foreground">{scopeLabel}</span> so the agent can
					understand its pages, buttons, forms, and navigation.
				</p>
			</div>

			<div className="space-y-2">
				<button
					onClick={onIndexSite}
					className="w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90"
				>
					Index Section
				</button>
				<p className="text-xs text-muted-foreground text-center">
					Crawls pages under <span className="font-mono">{pathScope}</span> in the background
				</p>
			</div>

			<div className="relative">
				<div className="absolute inset-0 flex items-center">
					<div className="w-full border-t border-border" />
				</div>
				<div className="relative flex justify-center text-xs">
					<span className="bg-background px-2 text-muted-foreground">or</span>
				</div>
			</div>

			<div className="space-y-2">
				<button
					onClick={onIndexPage}
					className="w-full py-2 text-sm font-medium text-foreground border border-border rounded-md hover:bg-secondary"
				>
					Index This Page Only
				</button>
				<p className="text-xs text-muted-foreground text-center">
					Quick — indexes just the current page (instant)
				</p>
			</div>
		</div>
	);
}

function CrawlingView({
	progress,
	domain,
	onStop,
}: {
	progress: CrawlProgress | null;
	domain: string;
	onStop: () => void;
}) {
	const indexed = progress?.pagesIndexed ?? 0;
	const discovered = progress?.pagesDiscovered ?? 0;
	const pct = discovered > 0 ? Math.round((indexed / discovered) * 100) : 0;

	return (
		<div className="p-4 space-y-4">
			<div>
				<h3 className="text-sm font-semibold text-foreground">Indexing {domain}</h3>
				<p className="text-xs text-muted-foreground mt-1">
					Crawling pages in the background. You can keep working.
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>{indexed} pages indexed</span>
					<span>{discovered} discovered</span>
				</div>
				<div className="h-2 bg-secondary rounded-full overflow-hidden">
					<div
						className="h-full bg-foreground rounded-full transition-all duration-500"
						style={{ width: `${pct}%` }}
					/>
				</div>
				{progress?.currentUrl && (
					<p className="text-xs text-muted-foreground truncate">
						{new URL(progress.currentUrl).pathname}
					</p>
				)}
			</div>

			<button
				onClick={onStop}
				className="w-full py-2 text-sm text-muted-foreground border border-border rounded-md hover:bg-secondary"
			>
				Stop Crawl
			</button>
		</div>
	);
}

function formatRelativeTime(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays}d ago`;
	return new Date(timestamp).toLocaleDateString();
}
