'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
	ArrowLeft,
	Copy,
	Download,
	Globe,
	Pencil,
	Shield,
	Star,
	Trash2,
	Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
	rating: number | null;
	tools: string[];
	safetyRules: string[];
	creatorId: string;
	creatorEmail: string;
	isPublic: boolean;
	createdAt: string;
	updatedAt: string;
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

export default function AgentDetailPage() {
	const { user } = useAuth();
	const params = useParams();
	const router = useRouter();
	const agentId = params.id as string;

	const [agent, setAgent] = useState<Agent | null>(null);
	const [loading, setLoading] = useState(true);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		name: '',
		description: '',
		instructions: '',
		icon: '',
		domains: '',
		category: '',
		status: 'draft' as Agent['status'],
	});

	const isOwner = agent?.creatorId === user?.id;

	useEffect(() => {
		fetchAgent();
	}, [agentId]);

	async function fetchAgent() {
		try {
			const res = await apiFetch(`/api/agents/${agentId}`);
			if (res.ok) {
				const data = await res.json();
				const a = data.agent;
				setAgent(a);
				setForm({
					name: a.name,
					description: a.description || '',
					instructions: a.instructions || '',
					icon: a.icon || '🤖',
					domains: (a.domains || []).join(', '),
					category: a.category || 'Other',
					status: a.status || 'draft',
				});
			}
		} catch (err) {
			console.error('Failed to fetch agent:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleSave() {
		setSaving(true);
		try {
			const res = await apiFetch(`/api/agents/${agentId}`, {
				method: 'PUT',
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
				setEditing(false);
				fetchAgent();
			}
		} catch (err) {
			console.error('Failed to save agent:', err);
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!confirm('Are you sure you want to delete this agent?')) return;
		try {
			const res = await apiFetch(`/api/agents/${agentId}`, { method: 'DELETE' });
			if (res.ok) {
				router.push('/agents');
			}
		} catch (err) {
			console.error('Failed to delete agent:', err);
		}
	}

	async function handleFork() {
		try {
			const res = await apiFetch(`/api/agents/${agentId}/fork`, { method: 'POST' });
			if (res.ok) {
				const data = await res.json();
				router.push(`/agents/${data.agent.id}`);
			}
		} catch (err) {
			console.error('Failed to fork agent:', err);
		}
	}

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Agent Details</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (!agent) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Agent Not Found</h1>
				<p className="text-muted-foreground">This agent does not exist or you lack access.</p>
				<Link href="/agents">
					<Button size="sm" variant="outline">
						<ArrowLeft size={14} className="mr-1.5" />
						Back to Agents
					</Button>
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<Link href="/agents">
						<Button size="icon" variant="ghost" className="h-8 w-8">
							<ArrowLeft size={16} />
						</Button>
					</Link>
					<span className="text-3xl">{agent.icon || '🤖'}</span>
					<div>
						<h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
						<p className="text-muted-foreground text-sm mt-0.5">
							by {agent.creatorEmail || 'Unknown'}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{isOwner ? (
						<>
							<Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>
								{editing ? (
									<>
										<ArrowLeft size={14} className="mr-1.5" />
										Cancel
									</>
								) : (
									<>
										<Pencil size={14} className="mr-1.5" />
										Edit
									</>
								)}
							</Button>
							<Button
								size="sm"
								variant="outline"
								className="text-destructive hover:text-destructive"
								onClick={handleDelete}
							>
								<Trash2 size={14} className="mr-1.5" />
								Delete
							</Button>
						</>
					) : (
						agent.isPublic && (
							<Button size="sm" variant="outline" onClick={handleFork}>
								<Copy size={14} className="mr-1.5" />
								Fork
							</Button>
						)
					)}
				</div>
			</div>

			{/* Stats row */}
			<div className="flex items-center gap-4">
				<Badge variant={agent.status === 'active' ? 'default' : 'secondary'}>{agent.status}</Badge>
				<Badge variant="outline">{agent.category || 'Other'}</Badge>
				<span className="text-sm text-muted-foreground flex items-center gap-1">
					<Download size={14} />
					{agent.installCount || 0} installs
				</span>
				{agent.rating != null && (
					<span className="text-sm text-muted-foreground flex items-center gap-1">
						<Star size={14} />
						{agent.rating.toFixed(1)}
					</span>
				)}
			</div>

			{editing ? (
				/* Edit form */
				<Card>
					<CardContent className="pt-5 space-y-4">
						<div className="grid grid-cols-4 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">Icon</label>
								<Input
									value={form.icon}
									onChange={(e) => setForm({ ...form, icon: e.target.value })}
									className="text-center text-lg"
									maxLength={4}
								/>
							</div>
							<div className="col-span-3">
								<label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
								<Input
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
								value={form.description}
								onChange={(e) => setForm({ ...form, description: e.target.value })}
							/>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Instructions
							</label>
							<textarea
								value={form.instructions}
								onChange={(e) => setForm({ ...form, instructions: e.target.value })}
								rows={10}
								className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							/>
						</div>
						<div className="grid grid-cols-3 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Domains (comma-separated)
								</label>
								<Input
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
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Status
								</label>
								<select
									value={form.status}
									onChange={(e) => setForm({ ...form, status: e.target.value as Agent['status'] })}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
								>
									<option value="draft">Draft</option>
									<option value="active">Active</option>
									<option value="archived">Archived</option>
								</select>
							</div>
						</div>
						<div className="flex gap-2">
							<Button size="sm" onClick={handleSave} disabled={saving}>
								{saving ? 'Saving...' : 'Save Changes'}
							</Button>
							<Button size="sm" variant="outline" onClick={() => setEditing(false)}>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				/* View mode */
				<div className="space-y-4">
					{/* Description */}
					{agent.description && (
						<Card>
							<CardContent className="pt-5">
								<p className="text-sm">{agent.description}</p>
							</CardContent>
						</Card>
					)}

					{/* Instructions */}
					<Card>
						<CardHeader className="pb-3">
							<CardTitle className="text-sm flex items-center gap-2">
								<Wrench size={14} className="text-muted-foreground" />
								Instructions
							</CardTitle>
						</CardHeader>
						<CardContent>
							<pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 overflow-auto max-h-96">
								{agent.instructions || 'No instructions set.'}
							</pre>
						</CardContent>
					</Card>

					{/* Tools */}
					{agent.tools && agent.tools.length > 0 && (
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<Wrench size={14} className="text-muted-foreground" />
									Tools
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{agent.tools.map((tool) => (
										<Badge key={tool} variant="secondary">
											{tool}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					{/* Domains */}
					{agent.domains && agent.domains.length > 0 && (
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<Globe size={14} className="text-muted-foreground" />
									Domains
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="flex flex-wrap gap-2">
									{agent.domains.map((domain) => (
										<Badge key={domain} variant="outline">
											{domain}
										</Badge>
									))}
								</div>
							</CardContent>
						</Card>
					)}

					{/* Safety Rules */}
					{agent.safetyRules && agent.safetyRules.length > 0 && (
						<Card>
							<CardHeader className="pb-3">
								<CardTitle className="text-sm flex items-center gap-2">
									<Shield size={14} className="text-muted-foreground" />
									Safety Rules
								</CardTitle>
							</CardHeader>
							<CardContent>
								<ul className="space-y-1">
									{agent.safetyRules.map((rule, i) => (
										<li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
											<span className="text-primary mt-0.5">-</span>
											{rule}
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</div>
	);
}
