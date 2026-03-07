import { useState, useEffect, useCallback } from 'react';
import type { CrawlProgress } from '@afe/shared';
import type { StoredSite, StoredPage } from '../../storage/db.js';

type IndexMode = 'onboarding' | 'indexing' | 'crawling' | 'viewing';

interface SiteData {
	site: StoredSite | null;
	pages: StoredPage[];
}

export function ChatTab() {
	const [mode, setMode] = useState<IndexMode>('onboarding');
	const [domain, setDomain] = useState<string>('');
	const [pathScope, setPathScope] = useState<string>('');
	const [tabId, setTabId] = useState<number | null>(null);
	const [siteData, setSiteData] = useState<SiteData>({ site: null, pages: [] });
	const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
	const [expandedPage, setExpandedPage] = useState<string | null>(null);

	const loadSiteData = useCallback((d: string) => {
		chrome.runtime.sendMessage(
			{ type: 'GET_SITE_DATA', payload: { domain: d } },
			(response) => {
				if (response?.site) {
					setSiteData(response);
					if (response.site.crawlStatus === 'crawling') {
						setMode('crawling');
					} else if (response.pages.length > 0) {
						setMode('viewing');
					}
				}
			},
		);
	}, []);

	useEffect(() => {
		// Get the current tab info
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			const tab = tabs[0];
			if (tab?.url && tab.id) {
				try {
					const parsed = new URL(tab.url);
					setDomain(parsed.hostname);
					const segments = parsed.pathname.split('/').filter(Boolean);
					const scope = segments.length >= 2
						? `/${segments[0]}/${segments[1]}`
						: segments.length === 1 ? `/${segments[0]}` : '/';
					setPathScope(scope);
					setTabId(tab.id);
					loadSiteData(parsed.hostname);
				} catch {}
			}
		});
	}, [loadSiteData]);

	// Listen for crawl progress updates
	useEffect(() => {
		function handleMessage(message: { type: string; payload?: unknown }) {
			if (message.type === 'CRAWL_PROGRESS') {
				const progress = message.payload as CrawlProgress;
				setCrawlProgress(progress);
				if (progress.status === 'complete' || progress.status === 'stopped') {
					setMode('viewing');
					if (domain) loadSiteData(domain);
				} else {
					setMode('crawling');
				}
			}
		}
		chrome.runtime.onMessage.addListener(handleMessage);
		return () => chrome.runtime.onMessage.removeListener(handleMessage);
	}, [domain, loadSiteData]);

	function handleIndexPage() {
		if (!tabId) return;
		setMode('indexing');
		chrome.runtime.sendMessage(
			{ type: 'INDEX_PAGE_SINGLE', payload: { tabId } },
			(response) => {
				if (response?.ok) {
					setMode('viewing');
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
			payload: { tabId, maxPages: 50 },
		});
	}

	function handleStopCrawl() {
		chrome.runtime.sendMessage({ type: 'CRAWL_STOP' });
	}

	function handleReindex() {
		setMode('onboarding');
		setSiteData({ site: null, pages: [] });
	}

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
		return <OnboardingView domain={domain} pathScope={pathScope} onIndexPage={handleIndexPage} onIndexSite={handleIndexSite} />;
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
		<SiteIndexView
			siteData={siteData}
			domain={domain}
			expandedPage={expandedPage}
			onTogglePage={setExpandedPage}
			onReindex={handleReindex}
			onIndexSite={handleIndexSite}
		/>
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
					Index <span className="font-medium text-foreground">{scopeLabel}</span> so the agent can understand its pages, buttons, forms, and navigation.
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

function SiteIndexView({
	siteData,
	domain,
	expandedPage,
	onTogglePage,
	onReindex,
	onIndexSite,
}: {
	siteData: SiteData;
	domain: string;
	expandedPage: string | null;
	onTogglePage: (url: string | null) => void;
	onReindex: () => void;
	onIndexSite: () => void;
}) {
	const { site, pages } = siteData;

	// Group pages by type
	const grouped = pages.reduce(
		(acc, page) => {
			const type = page.pageType || 'other';
			if (!acc[type]) acc[type] = [];
			acc[type].push(page);
			return acc;
		},
		{} as Record<string, StoredPage[]>,
	);

	const typeLabels: Record<string, string> = {
		dashboard: 'Dashboards',
		table: 'Tables / Lists',
		form: 'Forms',
		detail: 'Detail Pages',
		settings: 'Settings',
		other: 'Other',
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="p-4 border-b border-border">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold text-foreground">{domain}</h3>
					<span className="text-xs text-muted-foreground">
						{site?.totalPages ?? 0} pages · {site?.totalElements ?? 0} elements
					</span>
				</div>
				{site && (
					<p className="text-xs text-muted-foreground mt-1">
						Last indexed {new Date(site.lastIndexedAt).toLocaleString()}
					</p>
				)}
			</div>

			{/* Pages list */}
			<div className="flex-1 overflow-y-auto">
				{Object.entries(grouped).map(([type, typePages]) => (
					<div key={type}>
						<div className="px-4 py-2 bg-secondary/50">
							<p className="text-xs font-medium text-muted-foreground">
								{typeLabels[type] || type} ({typePages.length})
							</p>
						</div>
						{typePages.map((page) => (
							<PageRow
								key={page.url}
								page={page}
								expanded={expandedPage === page.url}
								onToggle={() =>
									onTogglePage(expandedPage === page.url ? null : page.url)
								}
							/>
						))}
					</div>
				))}
			</div>

			{/* Footer actions */}
			<div className="p-3 border-t border-border flex gap-2">
				{pages.length === 1 && (
					<button
						onClick={onIndexSite}
						className="flex-1 py-1.5 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90"
					>
						Index Full Site
					</button>
				)}
				<button
					onClick={onReindex}
					className="flex-1 py-1.5 text-xs text-muted-foreground border border-border rounded-md hover:bg-secondary"
				>
					Re-index
				</button>
			</div>
		</div>
	);
}

function PageRow({
	page,
	expanded,
	onToggle,
}: {
	page: StoredPage;
	expanded: boolean;
	onToggle: () => void;
}) {
	const elementCounts = page.elements.reduce(
		(acc, el) => {
			acc[el.type] = (acc[el.type] || 0) + 1;
			return acc;
		},
		{} as Record<string, number>,
	);

	return (
		<div className="border-b border-border/50">
			<button
				onClick={onToggle}
				className="w-full px-4 py-2.5 text-left hover:bg-secondary/30"
			>
				<p className="text-sm text-foreground truncate">{page.title || page.urlPattern}</p>
				<p className="text-xs text-muted-foreground truncate">{page.urlPattern}</p>
				<div className="flex gap-2 mt-1">
					{Object.entries(elementCounts).map(([type, count]) => (
						<span key={type} className="text-xs text-muted-foreground">
							{count} {type}{count > 1 ? 's' : ''}
						</span>
					))}
				</div>
			</button>

			{expanded && (
				<div className="px-4 pb-3 space-y-1">
					{page.elements.map((el) => (
						<div
							key={el.id}
							className="flex items-center gap-2 py-1 px-2 rounded bg-secondary/30"
						>
							<span className="text-xs font-mono text-muted-foreground w-16 shrink-0">
								{el.type}
							</span>
							<span className="text-xs text-foreground truncate">{el.label}</span>
						</div>
					))}
					{page.navigationLinks.length > 0 && (
						<div className="pt-2">
							<p className="text-xs font-medium text-muted-foreground mb-1">
								Navigation ({page.navigationLinks.length} links)
							</p>
							{page.navigationLinks.slice(0, 10).map((link, i) => (
								<p key={i} className="text-xs text-muted-foreground truncate">
									{link.href} — {link.label}
								</p>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
