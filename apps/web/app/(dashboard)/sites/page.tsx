'use client';

import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { ChevronDown, ChevronRight, FileText, Globe, Map } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface SitePage {
	id: string;
	url: string;
	urlPattern: string | null;
	title: string | null;
	pageType: string | null;
	elements: unknown[];
	lastIndexedAt: string | null;
}

interface Site {
	id: string;
	domain: string;
	totalPages: number;
	totalElements: number;
	lastCrawledAt: string | null;
	createdAt: string;
}

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function SiteCard({ site }: { site: Site }) {
	const [expanded, setExpanded] = useState(false);
	const [pages, setPages] = useState<SitePage[]>([]);
	const [loadingPages, setLoadingPages] = useState(false);

	async function loadPages() {
		if (pages.length > 0) {
			setExpanded(!expanded);
			return;
		}
		setLoadingPages(true);
		setExpanded(true);
		try {
			const res = await apiFetch(`/api/sites/${encodeURIComponent(site.domain)}`);
			if (res.ok) {
				const data = await res.json();
				setPages(data.pages || []);
			}
		} catch (err) {
			console.error('Failed to fetch pages:', err);
		} finally {
			setLoadingPages(false);
		}
	}

	return (
		<div className="border border-border hover:border-foreground/10 transition-colors">
			{/* Header */}
			<button onClick={loadPages} className="w-full p-4 flex items-start gap-3 text-left">
				<div className="mt-0.5">
					{expanded ? (
						<ChevronDown size={14} className="text-muted-foreground" />
					) : (
						<ChevronRight size={14} className="text-muted-foreground" />
					)}
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<Globe size={14} className="text-muted-foreground shrink-0" />
						<span className="font-medium text-sm font-mono">{site.domain}</span>
					</div>
					<div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground font-mono">
						<span>{site.totalPages} pages</span>
						<span className="text-border">|</span>
						<span>{site.totalElements} elements</span>
						<span className="text-border">|</span>
						<span>
							{site.lastCrawledAt ? `indexed ${timeAgo(site.lastCrawledAt)}` : 'not crawled'}
						</span>
						<span className="text-border">|</span>
						<Link
							href={`/sites/${encodeURIComponent(site.domain)}/graph`}
							onClick={(e) => e.stopPropagation()}
							className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
						>
							<Map size={11} />
							<span>graph</span>
						</Link>
					</div>
				</div>
			</button>

			{/* Expanded pages */}
			{expanded && (
				<div className="border-t border-border">
					{loadingPages ? (
						<div className="flex items-center gap-2 px-4 py-3">
							<span className="status-pixel bg-muted-foreground animate-pulse" />
							<p className="text-xs font-mono text-muted-foreground">Loading pages...</p>
						</div>
					) : pages.length === 0 ? (
						<p className="text-xs text-muted-foreground px-4 py-3">No pages indexed yet.</p>
					) : (
						<div className="divide-y divide-border/50">
							{pages.map((page) => {
								const elemCount = Array.isArray(page.elements) ? page.elements.length : 0;
								return (
									<div
										key={page.id}
										className="flex items-start gap-2.5 text-xs px-4 py-2.5 hover:bg-surface/50 transition-colors"
									>
										<FileText size={12} className="text-muted-foreground mt-0.5 shrink-0" />
										<div className="min-w-0 flex-1">
											<p className="font-medium truncate text-sm">
												{page.title || page.urlPattern || page.url}
											</p>
											<p className="text-muted-foreground truncate font-mono text-[11px] mt-0.5">
												{page.urlPattern || page.url}
											</p>
											<div className="flex items-center gap-2 mt-1.5">
												<Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
													{page.pageType || 'other'}
												</Badge>
												<span className="text-muted-foreground font-mono">
													{elemCount} elements
												</span>
												{page.lastIndexedAt && (
													<span className="text-muted-foreground font-mono">
														{timeAgo(page.lastIndexedAt)}
													</span>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export default function SitesPage() {
	const [sites, setSites] = useState<Site[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchSites();
	}, []);

	async function fetchSites() {
		try {
			const res = await apiFetch('/api/sites');
			if (res.ok) {
				const data = await res.json();
				setSites(data.sites || []);
			}
		} catch (err) {
			console.error('Failed to fetch sites:', err);
		} finally {
			setLoading(false);
		}
	}

	const totalPages = sites.reduce((sum, s) => sum + s.totalPages, 0);
	const totalElements = sites.reduce((sum, s) => sum + s.totalElements, 0);

	if (loading) {
		return (
			<div className="flex items-center gap-2 py-8">
				<span className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{sites.length > 0 && (
				<p className="text-xs font-mono text-muted-foreground">
					{sites.length} sites · {totalPages} pages · {totalElements} elements
				</p>
			)}

			{sites.length === 0 ? (
				<div className="border border-border py-16 text-center">
					<Globe size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
					<p className="text-sm text-muted-foreground">
						No sites indexed yet. Open the extension on any web app to get started.
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{sites.map((site) => (
						<SiteCard key={site.id} site={site} />
					))}
				</div>
			)}
		</div>
	);
}
