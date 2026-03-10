import type { CrawlProgress, SSEEvent, SelectedElement } from '@afe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredPage, StoredSite } from '../../storage/db.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

type ViewMode = 'onboarding' | 'indexing' | 'crawling' | 'chat';

interface Plan {
	steps: string[];
	description?: string;
}

// --- Block-based message model ---
// Each assistant message is a sequence of blocks rendered in order.

type MessageBlock =
	| { type: 'thinking' }
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
	| { type: 'plan'; plan: Plan };

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

const TOOL_ICONS: Record<string, string> = {
	click_element: '👆',
	type_text: '⌨',
	select_option: '☰',
	navigate: '→',
	get_page_state: '◎',
	screenshot: '📷',
	scroll: '↕',
	wait_for_element: '⏳',
	read_text: '¶',
	read_table: '▤',
	export_data: '📥',
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

function parsePlan(text: string): Plan | null {
	const match = text.match(/<!--plan:(.*?)-->/s);
	if (!match) return null;
	try {
		const plan = JSON.parse(match[1]) as Plan;
		if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) return null;
		return plan;
	} catch {
		return null;
	}
}

function stripPlanBlock(text: string): string {
	return text.replace(/<!--plan:.*?-->/s, '').trim();
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
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [showContext, setShowContext] = useState(false);
	const [wsConnected, setWsConnected] = useState(false);
	const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
	const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
	const [selectorActive, setSelectorActive] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Streaming refs
	const abortRef = useRef<AbortController | null>(null);
	const assistantMsgIdRef = useRef<string>('');
	const blocksRef = useRef<MessageBlock[]>([]);
	const textAccumRef = useRef('');
	const rafRef = useRef<number>(0);

	const loadSiteData = useCallback((d: string) => {
		chrome.runtime.sendMessage({ type: 'GET_SITE_DATA', payload: { domain: d } }, (response) => {
			if (response?.site) {
				setSiteData(response);
				if (response.site.crawlStatus === 'crawling') {
					setMode('crawling');
				} else if (response.pages.length > 0) {
					setMode('chat');
				}
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
		const onActivated = () => updateCurrentTab();
		chrome.tabs.onActivated.addListener(onActivated);
		chrome.tabs.onUpdated.addListener(onActivated);
		return () => {
			chrome.tabs.onActivated.removeListener(onActivated);
			chrome.tabs.onUpdated.removeListener(onActivated);
		};
	}, [updateCurrentTab]);

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
				const req = message as unknown as { requestId: string; payload: ApprovalRequest };
				setPendingApprovals((prev) => [...prev, { ...req.payload, requestId: req.requestId }]);
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
				setMode('chat');
				loadSiteData(domain);
			} else {
				setMode('onboarding');
			}
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

		setChatMessages((prev) =>
			prev.map((m) => (m.id === id ? { ...m, blocks: [...blocks] } : m)),
		);
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
					conversationId,
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
								// Remove previous thinking block if it's the last one (new iteration)
								const lastBlock =
									blocksRef.current[blocksRef.current.length - 1];
								if (!lastBlock || lastBlock.type !== 'thinking') {
									// Reset text accumulator — new thinking phase means new text block after
									textAccumRef.current = '';
									blocksRef.current.push({ type: 'thinking' });
									scheduleFlush();
								}
								break;
							}

							case 'tool_start': {
								// Remove trailing thinking block — tool call replaces it
								const blocks = blocksRef.current;
								if (
									blocks.length > 0 &&
									blocks[blocks.length - 1].type === 'thinking'
								) {
									blocks.pop();
								}
								// Reset text accumulator for the next text block after tools
								textAccumRef.current = '';
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

							case 'plan': {
								const planData: Plan = {
									steps: event.steps,
									description: event.description,
								};
								blocksRef.current.push({ type: 'plan', plan: planData });
								scheduleFlush();
								break;
							}

							case 'done':
								setConversationId(event.conversationId);
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

			// Check for plan in text
			const plan = parsePlan(finalText);
			if (plan) {
				const cleanText = stripPlanBlock(finalText);
				setChatMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsgIdRef.current
							? { ...m, content: cleanText }
							: m,
					),
				);
			} else {
				setChatMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsgIdRef.current
							? { ...m, content: finalText }
							: m,
					),
				);
			}

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

	function handlePlanApproval() {
		const userMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: 'go ahead',
		};
		setChatMessages((prev) => [...prev, userMsg]);
		sendMessage('go ahead');
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
		setConversationId(null);
		setPendingApprovals([]);
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
			<button
				onClick={() => setShowContext(!showContext)}
				className="px-4 py-2 border-b border-border flex items-center justify-between hover:bg-secondary/30"
			>
				<span className="text-xs text-muted-foreground">
					{domain} · {siteData.site?.totalPages ?? 0} pages ·{' '}
					{wsConnected ? 'connected' : 'chat only'}
				</span>
				<span className="text-xs text-muted-foreground">{showContext ? '▲' : '▼'}</span>
			</button>

			{showContext && (
				<div className="border-b border-border max-h-48 overflow-y-auto">
					{siteData.pages.map((page) => (
						<div key={page.url} className="px-4 py-1.5 border-b border-border/30">
							<p className="text-xs text-foreground truncate">{page.title || page.urlPattern}</p>
							<p className="text-xs text-muted-foreground">{page.elements.length} elements</p>
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
						Agent wants to: <span className="font-semibold">{TOOL_LABELS[req.action] || req.action}</span>
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

			{/* Messages */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{chatMessages.length === 0 && (
					<div className="text-center py-8">
						<p className="text-sm text-muted-foreground">Ask anything about this page or site.</p>
						<p className="text-xs text-muted-foreground mt-1">
							"What can I do here?" · "Click the login button" · "Type hello in the search box"
						</p>
					</div>
				)}
				{chatMessages.map((msg) => (
					<div key={msg.id}>
						{msg.role === 'user' ? (
							<UserMessage msg={msg} />
						) : (
							<AssistantMessage msg={msg} isActive={isActive} onPlanApproval={handlePlanApproval} onEditPlan={() => setInput('I want to change the plan: ')} />
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
					className="flex gap-2"
				>
					<button
						type="button"
						onClick={handleToggleSelector}
						title={selectorActive ? 'Cancel selector' : 'Select an element'}
						className={`px-2 py-2 text-sm rounded-md border shrink-0 ${
							selectorActive
								? 'border-blue-500 bg-blue-500/10 text-blue-400'
								: 'border-input text-muted-foreground hover:text-foreground hover:bg-secondary'
						}`}
					>
						⊕
					</button>
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={
							selectedElements.length > 0
								? selectedElements.length === 1
									? `Instruct about this ${selectedElements[0].tag}...`
									: `Instruct about ${selectedElements.length} elements...`
								: 'Ask about this page...'
						}
						disabled={isActive}
						className="flex-1 text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
					/>
					{isActive ? (
						<button
							type="button"
							onClick={handleStop}
							className="px-3 py-2 text-sm font-medium text-red-400 border border-red-500/50 rounded-md hover:bg-red-500/10"
						>
							Stop
						</button>
					) : (
						<button
							type="submit"
							disabled={!input.trim()}
							className="px-3 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90 disabled:opacity-50"
						>
							Send
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
	onPlanApproval,
	onEditPlan,
}: {
	msg: ChatMessage;
	isActive: boolean;
	onPlanApproval: () => void;
	onEditPlan: () => void;
}) {
	const blocks = msg.blocks;

	// No blocks yet — show nothing (or a subtle placeholder)
	if (!blocks || blocks.length === 0) {
		return null;
	}

	// Check if the last block is a thinking block (still waiting for response)
	const lastBlock = blocks[blocks.length - 1];
	const isThinkingAtEnd = lastBlock.type === 'thinking';

	return (
		<div className="flex justify-start">
			<div className="max-w-[90%] space-y-2">
				{blocks.map((block, i) => {
					switch (block.type) {
						case 'thinking':
							return <ThinkingBlock key={i} />;
						case 'text':
							return <TextBlock key={i} content={block.content} />;
						case 'tool_call':
							return <ToolCallBlock key={i} block={block} />;
						case 'blocked':
							return <BlockedBlock key={i} toolName={block.toolName} reason={block.reason} />;
						case 'plan':
							return (
								<PlanBlock
									key={i}
									plan={block.plan}
									isActive={isActive}
									onApprove={onPlanApproval}
									onEdit={onEditPlan}
								/>
							);
						default:
							return null;
					}
				})}

				{/* If no visible content yet and we're thinking */}
				{blocks.length === 0 && isActive && <ThinkingBlock />}
			</div>
		</div>
	);
}

function ThinkingBlock() {
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
			<div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
			<span>Thinking...</span>
		</div>
	);
}

function TextBlock({ content }: { content: string }) {
	if (!content.trim()) return null;
	return (
		<div className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-secondary text-foreground">
			{content}
		</div>
	);
}

function ToolCallBlock({
	block,
}: {
	block: Extract<MessageBlock, { type: 'tool_call' }>;
}) {
	const [expanded, setExpanded] = useState(false);
	const icon = TOOL_ICONS[block.toolName] || '⚙';
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
			<div className="h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
		) : block.status === 'success' ? (
			<span className="text-green-400 text-xs shrink-0">✓</span>
		) : (
			<span className="text-red-400 text-xs shrink-0">✕</span>
		);

	return (
		<div className={`border rounded-md text-xs ${statusColor}`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
			>
				<span className="shrink-0">{icon}</span>
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
					{block.error && (
						<div className="text-red-400">Error: {block.error}</div>
					)}
					{block.result && !block.screenshot && (
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
			{block.screenshot && (
				<div className="px-2.5 pb-2">
					<img
						src={`data:image/jpeg;base64,${block.screenshot}`}
						alt="Screenshot"
						className="rounded border border-border/30 max-h-40 w-full object-contain cursor-pointer"
						onClick={() => {
							// Open full screenshot in new tab
							const img = new Image();
							img.src = `data:image/jpeg;base64,${block.screenshot}`;
							const w = window.open('');
							w?.document.body.appendChild(img);
						}}
					/>
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

function PlanBlock({
	plan,
	isActive,
	onApprove,
	onEdit,
}: {
	plan: Plan;
	isActive: boolean;
	onApprove: () => void;
	onEdit: () => void;
}) {
	return (
		<div className="rounded-lg px-3 py-2 bg-secondary text-foreground space-y-1.5">
			{plan.description && (
				<p className="text-xs font-medium opacity-80">{plan.description}</p>
			)}
			<div className="space-y-1">
				{plan.steps.map((step, i) => (
					<div key={i} className="flex items-start gap-2 text-xs">
						<span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-[10px] font-medium mt-0.5">
							{i + 1}
						</span>
						<span>{step}</span>
					</div>
				))}
			</div>
			{!isActive && (
				<div className="flex gap-2 pt-1">
					<button
						onClick={onApprove}
						className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
					>
						Execute
					</button>
					<button
						onClick={onEdit}
						className="px-3 py-1 text-xs font-medium text-foreground border border-border rounded hover:bg-secondary"
					>
						Edit
					</button>
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
