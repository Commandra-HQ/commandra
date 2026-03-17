'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { Download, Search, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface MarketplaceAgent {
	id: string;
	name: string;
	description: string;
	icon: string;
	domains: string[];
	category: string;
	installCount: number;
	creatorEmail: string;
	isInstalled: boolean;
	createdAt: string;
}

const CATEGORIES = [
	'All',
	'Productivity',
	'Data Extraction',
	'Communication',
	'Development',
	'Research',
	'Automation',
	'Other',
] as const;

const SORT_OPTIONS = [
	{ value: 'installs', label: 'Most Installed' },
	{ value: 'newest', label: 'Newest' },
] as const;

function MarketplaceCard({
	agent,
	onInstall,
	onUninstall,
	installing,
}: {
	agent: MarketplaceAgent;
	onInstall: (id: string) => void;
	onUninstall: (id: string) => void;
	installing: string | null;
}) {
	return (
		<Card className="hover:border-primary/30 transition-colors h-full flex flex-col">
			<Link href={`/agents/${agent.id}`} className="flex-1">
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<span className="text-xl">{agent.icon || '🤖'}</span>
						<span className="truncate">{agent.name}</span>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3 pb-2">
					<p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
					<p className="text-xs text-muted-foreground">{agent.creatorEmail}</p>
					<div className="flex items-center gap-2 flex-wrap">
						{agent.domains?.slice(0, 3).map((d) => (
							<Badge key={d} variant="outline" className="text-[10px]">
								{d}
							</Badge>
						))}
						{agent.domains?.length > 3 && (
							<span className="text-[10px] text-muted-foreground">
								+{agent.domains.length - 3} more
							</span>
						)}
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground flex items-center gap-1">
							<Download size={12} />
							{agent.installCount || 0}
						</span>
						<Badge variant="secondary" className="text-[10px]">
							{agent.category || 'Other'}
						</Badge>
					</div>
				</CardContent>
			</Link>
			<div className="px-6 pb-4 pt-1">
				{agent.isInstalled ? (
					<Button
						size="sm"
						variant="outline"
						className="w-full"
						disabled={installing === agent.id}
						onClick={() => onUninstall(agent.id)}
					>
						{installing === agent.id ? 'Removing...' : 'Uninstall'}
					</Button>
				) : (
					<Button
						size="sm"
						className="w-full"
						disabled={installing === agent.id}
						onClick={() => onInstall(agent.id)}
					>
						{installing === agent.id ? 'Installing...' : 'Install'}
					</Button>
				)}
			</div>
		</Card>
	);
}

export default function MarketplacePage() {
	const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState('');
	const [category, setCategory] = useState('All');
	const [sort, setSort] = useState<'installs' | 'newest'>('installs');
	const [installing, setInstalling] = useState<string | null>(null);

	useEffect(() => {
		fetchMarketplace();
	}, []);

	async function fetchMarketplace() {
		try {
			const res = await apiFetch('/api/marketplace');
			if (res.ok) {
				const data = await res.json();
				setAgents(data.agents || []);
			}
		} catch (err) {
			console.error('Failed to fetch marketplace:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleInstall(id: string) {
		setInstalling(id);
		try {
			const res = await apiFetch(`/api/agents/${id}/install`, { method: 'POST' });
			if (res.ok) {
				setAgents((prev) =>
					prev.map((a) =>
						a.id === id ? { ...a, isInstalled: true, installCount: a.installCount + 1 } : a,
					),
				);
			}
		} catch (err) {
			console.error('Failed to install agent:', err);
		} finally {
			setInstalling(null);
		}
	}

	async function handleUninstall(id: string) {
		setInstalling(id);
		try {
			const res = await apiFetch(`/api/agents/${id}/uninstall`, { method: 'POST' });
			if (res.ok) {
				setAgents((prev) =>
					prev.map((a) =>
						a.id === id
							? { ...a, isInstalled: false, installCount: Math.max(0, a.installCount - 1) }
							: a,
					),
				);
			}
		} catch (err) {
			console.error('Failed to uninstall agent:', err);
		} finally {
			setInstalling(null);
		}
	}

	const filtered = agents
		.filter((a) => {
			const matchesSearch =
				!search ||
				a.name.toLowerCase().includes(search.toLowerCase()) ||
				a.description.toLowerCase().includes(search.toLowerCase());
			const matchesCategory = category === 'All' || a.category === category;
			return matchesSearch && matchesCategory;
		})
		.sort((a, b) => {
			if (sort === 'installs') return (b.installCount || 0) - (a.installCount || 0);
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		});

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Marketplace</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Marketplace</h1>
				<p className="text-muted-foreground mt-1">
					Discover and install agents built by the community.
				</p>
			</div>

			{/* Search and sort */}
			<div className="flex items-center gap-3">
				<div className="relative flex-1 max-w-md">
					<Search
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						placeholder="Search agents..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>
				<select
					value={sort}
					onChange={(e) => setSort(e.target.value as 'installs' | 'newest')}
					className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
				>
					{SORT_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
			</div>

			{/* Category filters */}
			<div className="flex gap-2 flex-wrap">
				{CATEGORIES.map((c) => (
					<button
						key={c}
						onClick={() => setCategory(c)}
						className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
							category === c
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-border hover:bg-muted'
						}`}
					>
						{c}
					</button>
				))}
			</div>

			{/* Results */}
			{filtered.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<ShoppingBag size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">
							{search || category !== 'All'
								? 'No agents match your search. Try different filters.'
								: 'No agents available yet. Be the first to publish one!'}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((agent) => (
						<MarketplaceCard
							key={agent.id}
							agent={agent}
							onInstall={handleInstall}
							onUninstall={handleUninstall}
							installing={installing}
						/>
					))}
				</div>
			)}
		</div>
	);
}
