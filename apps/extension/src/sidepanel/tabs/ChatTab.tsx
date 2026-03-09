import type { CrawlProgress, SelectedElement } from '@afe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StoredPage, StoredSite } from '../../storage/db.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

type ViewMode = 'onboarding' | 'indexing' | 'crawling' | 'chat';

interface Plan {
	steps: string[];
	description?: string;
}

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	selectedElements?: SelectedElement[];
	plan?: Plan;
}

interface ActivityItem {
	requestId: string;
	action: string;
	label?: string;
	status: 'pending' | 'executing' | 'done' | 'failed';
	error?: string;
	timestamp: number;
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

const ACTION_LABELS: Record<string, string> = {
	click_element: 'Click',
	type_text: 'Type',
	select_option: 'Select',
	navigate: 'Navigate',
	get_page_state: 'Read page',
};

function formatAction(action: string): string {
	return ACTION_LABELS[action] || action;
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
	const [isStreaming, setIsStreaming] = useState(false);
	const [conversationId, setConversationId] = useState<string | null>(null);
	const [showContext, setShowContext] = useState(false);
	const [wsConnected, setWsConnected] = useState(false);
	const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
	const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
	const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
	const [selectorActive, setSelectorActive] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);

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

		// Update when user switches tabs
		const onActivated = () => updateCurrentTab();
		chrome.tabs.onActivated.addListener(onActivated);
		chrome.tabs.onUpdated.addListener(onActivated);
		return () => {
			chrome.tabs.onActivated.removeListener(onActivated);
			chrome.tabs.onUpdated.removeListener(onActivated);
		};
	}, [updateCurrentTab]);

	useEffect(() => {
		// Check WS connection status
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
			} else if (message.type === 'ACTION_STATUS') {
				const status = message.payload as ActivityItem;
				setActivityItems((prev) => {
					const existing = prev.findIndex((i) => i.requestId === status.requestId);
					if (existing >= 0) {
						const updated = [...prev];
						// Merge: keep action/label from pending, update status
						updated[existing] = {
							...updated[existing],
							...status,
							action: updated[existing].action || status.action,
							label: updated[existing].label || status.label,
						};
						return updated;
					}
					return [...prev, status];
				});
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

	async function handleSend() {
		if (!input.trim() || isStreaming) return;

		const userMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: input.trim(),
			selectedElements: selectedElements.length > 0 ? selectedElements : undefined,
		};
		setChatMessages((prev) => [...prev, userMsg]);
		setInput('');
		setSelectedElements([]);
		setIsStreaming(true);

		// Build page context from stored site data + live page state
		let pageIndex: unknown = null;

		// First: try live content script for the current page
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

		// Fallback/enrich: use stored Dexie data if we have it
		if (!pageIndex && siteData.pages.length > 0) {
			// Find the best matching stored page
			const currentPage = siteData.pages[0];
			pageIndex = {
				url: currentPage.url,
				title: currentPage.title,
				pageType: currentPage.pageType,
				elements: currentPage.elements,
				navigationLinks: currentPage.navigationLinks,
				timestamp: currentPage.indexedAt,
			};
		}

		// If we have multiple pages, send a site summary
		if (siteData.pages.length > 1 && pageIndex) {
			(pageIndex as Record<string, unknown>).sitePages = siteData.pages.map((p) => ({
				url: p.url,
				urlPattern: p.urlPattern,
				title: p.title,
				pageType: p.pageType,
				elementCount: p.elements.length,
			}));
		}

		// Get auth token
		const stored = await chrome.storage.local.get(['authToken']);
		const token = stored.authToken;

		const assistantMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'assistant',
			content: '',
		};
		setChatMessages((prev) => [...prev, assistantMsg]);

		try {
			const res = await fetch(`${API_URL}/api/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					message: userMsg.content,
					pageIndex,
					conversationId,
					selectedElements: selectedElements.length > 0 ? selectedElements : undefined,
				}),
			});

			if (!res.ok) {
				throw new Error(`API error: ${res.status}`);
			}

			const reader = res.body?.getReader();
			const decoder = new TextDecoder();

			if (reader) {
				let fullText = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					const chunk = decoder.decode(value, { stream: true });
					fullText += chunk;

					// Extract conversation ID if present
					const convMatch = fullText.match(/<!--conv:(.+?)-->/);
					let displayText = fullText;
					if (convMatch) {
						setConversationId(convMatch[1]);
						displayText = fullText.replace(/\n\n<!--conv:.+?-->/, '');
					}

					// Parse plan blocks
					const plan = parsePlan(displayText);
					const cleanText = stripPlanBlock(displayText);

					setChatMessages((prev) =>
						prev.map((m) =>
							m.id === assistantMsg.id ? { ...m, content: cleanText, plan: plan ?? undefined } : m,
						),
					);
				}
			}
		} catch (err) {
			setChatMessages((prev) =>
				prev.map((m) =>
					m.id === assistantMsg.id
						? { ...m, content: 'Failed to get a response. Make sure the API is running.' }
						: m,
				),
			);
		} finally {
			setIsStreaming(false);
			setSelectedElements([]);
		}
	}

	function handlePlanApproval() {
		// Directly send a "go ahead" message to approve the plan
		const approvalInput = 'go ahead';
		const userMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: approvalInput,
		};
		setChatMessages((prev) => [...prev, userMsg]);
		setInput('');

		// Reuse handleSend logic but with overridden input
		(async () => {
			setIsStreaming(true);
			const stored = await chrome.storage.local.get(['authToken']);
			const token = stored.authToken;

			const assistantMsg: ChatMessage = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: '',
			};
			setChatMessages((prev) => [...prev, assistantMsg]);

			try {
				const res = await fetch(`${API_URL}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						message: approvalInput,
						conversationId,
					}),
				});

				if (!res.ok) throw new Error(`API error: ${res.status}`);

				const reader = res.body?.getReader();
				const decoder = new TextDecoder();

				if (reader) {
					let fullText = '';
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						fullText += decoder.decode(value, { stream: true });

						const convMatch = fullText.match(/<!--conv:(.+?)-->/);
						let displayText = fullText;
						if (convMatch) {
							setConversationId(convMatch[1]);
							displayText = fullText.replace(/\n\n<!--conv:.+?-->/, '');
						}

						const plan = parsePlan(displayText);
						const cleanText = stripPlanBlock(displayText);

						setChatMessages((prev) =>
							prev.map((m) =>
								m.id === assistantMsg.id
									? { ...m, content: cleanText, plan: plan ?? undefined }
									: m,
							),
						);
					}
				}
			} catch {
				setChatMessages((prev) =>
					prev.map((m) =>
						m.id === assistantMsg.id
							? { ...m, content: 'Failed to get a response. Make sure the API is running.' }
							: m,
					),
				);
			} finally {
				setIsStreaming(false);
			}
		})();
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
		setActivityItems([]);
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

	// Chat mode
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

			{/* Activity Feed */}
			{activityItems.length > 0 && (
				<div className="border-b border-border px-4 py-2 space-y-1 max-h-32 overflow-y-auto">
					<p className="text-xs font-medium text-muted-foreground">Activity</p>
					{activityItems.slice(-5).map((item) => (
						<div key={item.requestId} className="flex items-center gap-2 text-xs">
							<span
								className={
									item.status === 'done'
										? 'text-green-500'
										: item.status === 'failed'
											? 'text-red-500'
											: 'text-yellow-500 animate-pulse'
								}
							>
								{item.status === 'done' ? '✓' : item.status === 'failed' ? '✗' : '●'}
							</span>
							<span className="text-muted-foreground truncate">
								{formatAction(item.action)}
								{item.label ? ` → ${item.label}` : ''}
							</span>
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
						Agent wants to: <span className="font-semibold">{formatAction(req.action)}</span>
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
					<div
						key={msg.id}
						className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
					>
						<div
							className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
								msg.role === 'user'
									? 'bg-primary text-primary-foreground'
									: 'bg-secondary text-foreground'
							}`}
						>
							{/* Element attachment chips */}
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
							{/* Plan UI */}
							{msg.plan && (
								<div className="mb-2 space-y-1.5">
									{msg.plan.description && (
										<p className="text-xs font-medium opacity-80">{msg.plan.description}</p>
									)}
									<div className="space-y-1">
										{msg.plan.steps.map((step, i) => (
											<div key={i} className="flex items-start gap-2 text-xs">
												<span className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-[10px] font-medium mt-0.5">
													{i + 1}
												</span>
												<span>{step}</span>
											</div>
										))}
									</div>
									{!isStreaming && (
										<div className="flex gap-2 pt-1">
											<button
												onClick={() => handlePlanApproval()}
												className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700"
											>
												Execute
											</button>
											<button
												onClick={() => setInput('I want to change the plan: ')}
												className="px-3 py-1 text-xs font-medium text-foreground border border-border rounded hover:bg-secondary"
											>
												Edit
											</button>
										</div>
									)}
								</div>
							)}
							{msg.content || (
								!msg.plan && (
									<span className="inline-flex items-center gap-1">
										<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse" />
										<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse [animation-delay:0.2s]" />
										<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse [animation-delay:0.4s]" />
									</span>
								)
							)}
						</div>
					</div>
				))}
				<div ref={messagesEndRef} />
			</div>

			{/* Input */}
			<div className="p-3 border-t border-border">
				{chatMessages.length > 0 && (
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
						disabled={isStreaming}
						className="flex-1 text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
					/>
					<button
						type="submit"
						disabled={isStreaming || !input.trim()}
						className="px-3 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90 disabled:opacity-50"
					>
						Send
					</button>
				</form>
			</div>
		</div>
	);
}

// --- Sub-components (unchanged from Phase 2) ---

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
