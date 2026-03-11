'use client';

import { Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

interface Site {
	id: string;
	domain: string;
	totalPages: number;
	totalElements: number;
	lastCrawledAt: string | null;
	createdAt: string;
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
						<Card key={site.id}>
							<CardHeader className="pb-3">
								<CardTitle className="text-base flex items-center gap-2">
									<Globe size={16} className="text-muted-foreground" />
									{site.domain}
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-2">
								<div className="flex gap-2">
									<Badge variant="secondary">{site.totalPages} pages</Badge>
									<Badge variant="secondary">{site.totalElements} elements</Badge>
								</div>
								<p className="text-xs text-muted-foreground">
									{site.lastCrawledAt
										? `Last indexed ${new Date(site.lastCrawledAt).toLocaleDateString()}`
										: 'Never fully crawled'}
								</p>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}

