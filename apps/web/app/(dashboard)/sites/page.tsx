'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { ChevronDown, ChevronRight, FileText, Globe } from 'lucide-react';
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
		<Card>
			<CardHeader className="pb-3">
				<CardTitle
					className="text-base flex items-center gap-2 cursor-pointer select-none"
					onClick={loadPages}
				>
					{expanded ? (
						<ChevronDown size={16} className="text-muted-foreground" />
					) : (
						<ChevronRight size={16} className="text-muted-foreground" />
					)}
					<Globe size={16} className="text-muted-foreground" />
					{site.domain}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex gap-2">
					<Badge variant="secondary">{site.totalPages} pages</Badge>
					<Badge variant="secondary">{site.totalElements} elements</Badge>
				</div>
				<p className="text-xs text-muted-foreground">
					{site.lastCrawledAt
						? `Last indexed ${timeAgo(site.lastCrawledAt)}`
						: 'Never fully crawled'}
				</p>

				{expanded && (
					<div className="border-t pt-3 mt-2 space-y-2">
						{loadingPages ? (
							<p className="text-xs text-muted-foreground">Loading pages...</p>
						) : pages.length === 0 ? (
							<p className="text-xs text-muted-foreground">No pages indexed yet.</p>
						) : (
							pages.map((page) => {
								const elemCount = Array.isArray(page.elements) ? page.elements.length : 0;
								return (
									<div
										key={page.id}
										className="flex items-start gap-2 text-xs p-2 rounded bg-muted/50"
									>
										<FileText size={12} className="text-muted-foreground mt-0.5 shrink-0" />
										<div className="min-w-0 flex-1">
											<p className="font-medium truncate">
												{page.title || page.urlPattern || page.url}
											</p>
											<p className="text-muted-foreground truncate">
												{page.urlPattern || page.url}
											</p>
											<div className="flex gap-2 mt-1">
												<Badge variant="outline" className="text-[10px] px-1 py-0">
													{page.pageType || 'other'}
												</Badge>
												<span className="text-muted-foreground">{elemCount} elements</span>
												{page.lastIndexedAt && (
													<span className="text-muted-foreground">
														{timeAgo(page.lastIndexedAt)}
													</span>
												)}
											</div>
										</div>
									</div>
								);
							})
						)}
					</div>
				)}
			</CardContent>
		</Card>
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

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Sites</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Sites</h1>
				<p className="text-muted-foreground mt-1">Web applications your agent knows about.</p>
			</div>

			{sites.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Globe size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">
							No sites indexed yet. Open the extension on any web app to get started.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{sites.map((site) => (
						<SiteCard key={site.id} site={site} />
					))}
				</div>
			)}
		</div>
	);
}
