'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { Bot, Download, Pencil, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Agent {
	id: string;
	name: string;
	description: string;
	instructions: string;
	icon: string;
	domains: string[];
	category: string;
	status: 'draft' | 'active' | 'archived';
	installCount: number;
	creatorId: string;
	createdAt: string;
}

const CATEGORIES = [
	'Productivity',
	'Data Extraction',
	'Communication',
	'Development',
	'Research',
	'Automation',
	'Other',
] as const;

function AgentCard({
	agent,
	isOwner,
	onDelete,
}: {
	agent: Agent;
	isOwner: boolean;
	onDelete: (id: string) => void;
}) {
	return (
		<Link href={`/agents/${agent.id}`} className="block">
			<Card className="hover:border-primary/30 transition-colors h-full">
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<span className="text-xl">{agent.icon || '🤖'}</span>
						<span className="truncate">{agent.name}</span>
						<Badge
							variant={agent.status === 'active' ? 'default' : 'secondary'}
							className="ml-auto text-[10px] shrink-0"
						>
							{agent.status}
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
					<div className="flex items-center gap-2 flex-wrap">
						{agent.domains?.slice(0, 2).map((d) => (
							<Badge key={d} variant="outline" className="text-[10px]">
								{d}
							</Badge>
						))}
						{agent.domains?.length > 2 && (
							<span className="text-[10px] text-muted-foreground">
								+{agent.domains.length - 2} more
							</span>
						)}
					</div>
					<div className="flex items-center justify-between pt-1">
						<span className="text-xs text-muted-foreground flex items-center gap-1">
							<Download size={12} />
							{agent.installCount || 0} installs
						</span>
						{isOwner && (
							<div className="flex items-center gap-1" onClick={(e) => e.preventDefault()}>
								<Link href={`/agents/${agent.id}`}>
									<Button size="icon" variant="ghost" className="h-7 w-7">
										<Pencil size={13} />
									</Button>
								</Link>
								<Button
									size="icon"
									variant="ghost"
									className="h-7 w-7 text-destructive hover:text-destructive"
									onClick={() => onDelete(agent.id)}
								>
									<Trash2 size={13} />
								</Button>
							</div>
						)}
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}

export default function AgentsPage() {
	const { user } = useAuth();
	const [agents, setAgents] = useState<Agent[]>([]);
	const [installedAgents, setInstalledAgents] = useState<Agent[]>([]);
	const [loading, setLoading] = useState(true);
	const [tab, setTab] = useState<'my' | 'installed'>('my');
	const [showCreate, setShowCreate] = useState(false);
	const [creating, setCreating] = useState(false);
	const [form, setForm] = useState({
		name: '',
		description: '',
		instructions: '',
		icon: '🤖',
		domains: '',
		category: 'Productivity',
	});

	useEffect(() => {
		fetchAgents();
	}, []);

	async function fetchAgents() {
		try {
			const [myRes, installedRes] = await Promise.all([
				apiFetch('/api/agents?scope=my'),
				apiFetch('/api/agents?scope=installed'),
			]);
			if (myRes.ok) {
				const data = await myRes.json();
				setAgents(data.agents || []);
			}
			if (installedRes.ok) {
				const data = await installedRes.json();
				setInstalledAgents(data.agents || []);
			}
		} catch (err) {
			console.error('Failed to fetch agents:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleCreate() {
		if (!form.name.trim() || !form.instructions.trim()) return;
		setCreating(true);
		try {
			const res = await apiFetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...form,
					domains: form.domains
						.split(',')
						.map((d) => d.trim())
						.filter(Boolean),
				}),
			});
			if (res.ok) {
				setShowCreate(false);
				setForm({
					name: '',
					description: '',
					instructions: '',
					icon: '🤖',
					domains: '',
					category: 'Productivity',
				});
				fetchAgents();
			}
		} catch (err) {
			console.error('Failed to create agent:', err);
		} finally {
			setCreating(false);
		}
	}

	async function handleDelete(id: string) {
		try {
			const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
			if (res.ok) {
				setAgents((prev) => prev.filter((a) => a.id !== id));
			}
		} catch (err) {
			console.error('Failed to delete agent:', err);
		}
	}

	const displayedAgents = tab === 'my' ? agents : installedAgents;

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Agents</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agents</h1>
					<p className="text-muted-foreground mt-1">
						Create and manage your automation agents.
					</p>
				</div>
				<Button size="sm" onClick={() => setShowCreate(!showCreate)}>
					{showCreate ? (
						<X size={14} className="mr-1.5" />
					) : (
						<Plus size={14} className="mr-1.5" />
					)}
					{showCreate ? 'Cancel' : 'Create Agent'}
				</Button>
			</div>

			{showCreate && (
				<Card>
					<CardContent className="pt-5 space-y-3">
						<div className="grid grid-cols-3 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Icon
								</label>
								<Input
									placeholder="🤖"
									value={form.icon}
									onChange={(e) => setForm({ ...form, icon: e.target.value })}
									className="text-center text-lg"
									maxLength={4}
								/>
							</div>
							<div className="col-span-2">
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Name
								</label>
								<Input
									placeholder="My Agent"
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
								/>
							</div>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Description
							</label>
							<Input
								placeholder="What does this agent do?"
								value={form.description}
								onChange={(e) => setForm({ ...form, description: e.target.value })}
							/>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Instructions
							</label>
							<textarea
								placeholder="Detailed instructions for the agent..."
								value={form.instructions}
								onChange={(e) => setForm({ ...form, instructions: e.target.value })}
								rows={6}
								className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Domains (comma-separated)
								</label>
								<Input
									placeholder="gmail.com, github.com"
									value={form.domains}
									onChange={(e) => setForm({ ...form, domains: e.target.value })}
								/>
							</div>
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Category
								</label>
								<select
									value={form.category}
									onChange={(e) => setForm({ ...form, category: e.target.value })}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
								>
									{CATEGORIES.map((c) => (
										<option key={c} value={c}>
											{c}
										</option>
									))}
								</select>
							</div>
						</div>
						<Button size="sm" onClick={handleCreate} disabled={creating}>
							{creating ? 'Creating...' : 'Create Agent'}
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Tabs */}
			<div className="flex gap-2">
				{(['my', 'installed'] as const).map((t) => (
					<button
						key={t}
						onClick={() => setTab(t)}
						className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
							tab === t
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-border hover:bg-muted'
						}`}
					>
						{t === 'my' ? 'My Agents' : 'Installed'}
						<span className="ml-1 text-[10px] opacity-70">
							({t === 'my' ? agents.length : installedAgents.length})
						</span>
					</button>
				))}
			</div>

			{displayedAgents.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Bot size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">
							{tab === 'my'
								? 'No agents yet. Create your first agent to get started.'
								: 'No installed agents. Browse the marketplace to find agents.'}
						</p>
						{tab === 'installed' && (
							<Link href="/marketplace">
								<Button size="sm" variant="outline" className="mt-3">
									Browse Marketplace
								</Button>
							</Link>
						)}
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{displayedAgents.map((agent) => (
						<AgentCard
							key={agent.id}
							agent={agent}
							isOwner={agent.creatorId === user?.id}
							onDelete={handleDelete}
						/>
					))}
				</div>
			)}
		</div>
	);
}
