import { useState, useEffect, useCallback, useRef } from 'react';
import type { CrawlProgress } from '@afe/shared';
import type { StoredSite, StoredPage } from '../../storage/db.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

type ViewMode = 'onboarding' | 'indexing' | 'crawling' | 'chat';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

interface SiteData {
	site: StoredSite | null;
	pages: StoredPage[];
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
	const messagesEndRef = useRef<HTMLDivElement>(null);

	const loadSiteData = useCallback((d: string) => {
		chrome.runtime.sendMessage(
			{ type: 'GET_SITE_DATA', payload: { domain: d } },
			(response) => {
				if (response?.site) {
					setSiteData(response);
					if (response.site.crawlStatus === 'crawling') {
						setMode('crawling');
					} else if (response.pages.length > 0) {
						setMode('chat');
					}
				}
			},
		);
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
		chrome.runtime.sendMessage(
			{ type: 'INDEX_PAGE_SINGLE', payload: { tabId } },
			(response) => {
				if (response?.ok) {
					setMode('chat');
					loadSiteData(domain);
				} else {
					setMode('onboarding');
				}
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

	async function handleSend() {
		if (!input.trim() || isStreaming) return;

		const userMsg: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: input.trim(),
		};
		setChatMessages((prev) => [...prev, userMsg]);
		setInput('');
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
					if (convMatch) {
						setConversationId(convMatch[1]);
						// Remove the marker from displayed text
						const displayText = fullText.replace(/\n\n<!--conv:.+?-->/, '');
						setChatMessages((prev) =>
							prev.map((m) =>
								m.id === assistantMsg.id ? { ...m, content: displayText } : m,
							),
						);
					} else {
						setChatMessages((prev) =>
							prev.map((m) =>
								m.id === assistantMsg.id ? { ...m, content: fullText } : m,
							),
						);
					}
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
		}
	}

	function handleNewConversation() {
		setChatMessages([]);
		setConversationId(null);
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
					{domain} · {siteData.site?.totalPages ?? 0} pages · {siteData.site?.totalElements ?? 0} elements
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

			{/* Messages */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{chatMessages.length === 0 && (
					<div className="text-center py-8">
						<p className="text-sm text-muted-foreground">
							Ask anything about this page or site.
						</p>
						<p className="text-xs text-muted-foreground mt-1">
							"What can I do here?" · "How do I create an issue?" · "Describe this page"
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
							{msg.content || (
								<span className="inline-flex items-center gap-1">
									<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse" />
									<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse [animation-delay:0.2s]" />
									<span className="h-1.5 w-1.5 bg-current rounded-full animate-pulse [animation-delay:0.4s]" />
								</span>
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
				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSend();
					}}
					className="flex gap-2"
				>
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Ask about this page..."
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
					Index <span className="font-medium text-foreground">{scopeLabel}</span> so the agent
					can understand its pages, buttons, forms, and navigation.
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
