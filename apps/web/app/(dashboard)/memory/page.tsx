'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MarkdownEditor } from '@/components/markdown-editor';
import { apiFetch } from '@/lib/api';
import { Brain, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Memory {
	id: string;
	category: 'preference' | 'correction' | 'terminology' | 'workflow';
	content: string;
	source: 'auto' | 'explicit';
	confidence: number;
	timesReinforced: number;
	createdAt: string;
}

const CATEGORY_VARIANT: Record<string, 'default' | 'secondary' | 'warning' | 'success'> = {
	correction: 'warning',
	preference: 'default',
	terminology: 'secondary',
	workflow: 'success',
};

const CATEGORIES = ['preference', 'correction', 'terminology', 'workflow'] as const;

export default function MemoryPage() {
	const [memories, setMemories] = useState<Memory[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState<string>('all');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState('');
	const [showAdd, setShowAdd] = useState(false);
	const [newMemory, setNewMemory] = useState({
		domain: '',
		category: 'preference' as Memory['category'],
		content: '',
	});
	const [domainFilter, setDomainFilter] = useState('');

	useEffect(() => {
		fetchMemories();
	}, []);

	async function fetchMemories() {
		try {
			const res = await apiFetch('/api/memory');
			if (res.ok) {
				const data = await res.json();
				setMemories(data.memories || []);
			}
		} catch (err) {
			console.error('Failed to fetch memories:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleDelete(id: string) {
		try {
			const res = await apiFetch(`/api/memory/${id}`, { method: 'DELETE' });
			if (res.ok) {
				setMemories((prev) => prev.filter((m) => m.id !== id));
			}
		} catch (err) {
			console.error('Failed to delete memory:', err);
		}
	}

	async function handleEdit(id: string) {
		try {
			const res = await apiFetch(`/api/memory/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: editContent }),
			});
			if (res.ok) {
				setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, content: editContent } : m)));
				setEditingId(null);
			}
		} catch (err) {
			console.error('Failed to edit memory:', err);
		}
	}

	async function handleAdd() {
		if (!newMemory.domain.trim() || !newMemory.content.trim()) return;
		try {
			const res = await apiFetch('/api/memory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newMemory),
			});
			if (res.ok) {
				setShowAdd(false);
				setNewMemory({ domain: '', category: 'preference', content: '' });
				fetchMemories();
			}
		} catch (err) {
			console.error('Failed to add memory:', err);
		}
	}

	const filtered = memories
		.filter((m) => filter === 'all' || m.category === filter)
		.filter((m) => !domainFilter || m.content.toLowerCase().includes(domainFilter.toLowerCase()));

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Agent Memory</h1>
				<div className="flex items-center gap-2 py-8">
					<span className="status-pixel bg-muted-foreground animate-pulse" />
					<p className="text-sm font-mono text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Memory</h1>
					<p className="text-sm text-muted-foreground mt-1">
						{memories.length} memories across sessions
					</p>
				</div>
				<Button size="sm" onClick={() => setShowAdd(!showAdd)}>
					{showAdd ? <X size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
					{showAdd ? 'Cancel' : 'Add Memory'}
				</Button>
			</div>

			{/* Add memory form */}
			{showAdd && (
				<div className="border border-border bg-surface p-4 space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Domain
							</label>
							<Input
								placeholder="e.g. app.example.com"
								value={newMemory.domain}
								onChange={(e) => setNewMemory({ ...newMemory, domain: e.target.value })}
							/>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Category
							</label>
							<select
								value={newMemory.category}
								onChange={(e) =>
									setNewMemory({
										...newMemory,
										category: e.target.value as Memory['category'],
									})
								}
								className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
							>
								{CATEGORIES.map((c) => (
									<option key={c} value={c}>
										{c.charAt(0).toUpperCase() + c.slice(1)}
									</option>
								))}
							</select>
						</div>
					</div>
					<div>
						<label className="text-xs font-medium text-muted-foreground mb-1 block">
							Content
						</label>
						<MarkdownEditor
							content={newMemory.content}
							onChange={(md) => setNewMemory({ ...newMemory, content: md })}
							placeholder="What should the agent remember? Supports markdown."
							minHeight="100px"
						/>
					</div>
					<Button size="sm" onClick={handleAdd}>
						Save Memory
					</Button>
				</div>
			)}

			{/* Filters */}
			<div className="flex items-center gap-2 flex-wrap">
				<div className="flex gap-0 border border-border">
					{['all', ...CATEGORIES].map((f) => (
						<button
							key={f}
							onClick={() => setFilter(f)}
							className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
								filter === f
									? 'bg-foreground text-background'
									: 'text-muted-foreground hover:text-foreground hover:bg-surface'
							}`}
						>
							{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
							{f !== 'all' && (
								<span className="ml-1.5 text-[10px] opacity-70">
									{memories.filter((m) => m.category === f).length}
								</span>
							)}
						</button>
					))}
				</div>

				<div className="ml-auto">
					<Input
						placeholder="Search memories..."
						value={domainFilter}
						onChange={(e) => setDomainFilter(e.target.value)}
						className="h-8 w-52 text-xs"
					/>
				</div>
			</div>

			{/* Memory list */}
			{filtered.length === 0 ? (
				<div className="border border-border py-16 text-center">
					<Brain size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
					<p className="text-sm text-muted-foreground">
						{memories.length === 0
							? 'No memories yet. The agent will learn as you interact with it.'
							: 'No memories match your filter.'}
					</p>
				</div>
			) : (
				<div className="border border-border divide-y divide-border">
					{filtered.map((memory) => (
						<div key={memory.id} className="px-4 py-3 hover:bg-surface/50 transition-colors">
							<div className="flex items-start justify-between gap-3">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-1.5">
										<Badge variant={CATEGORY_VARIANT[memory.category] || 'secondary'}>
											{memory.category}
										</Badge>
										<Badge variant="outline" className="text-[10px]">
											{memory.source}
										</Badge>
										{memory.timesReinforced > 1 && (
											<span className="text-[10px] text-muted-foreground font-mono">
												reinforced {memory.timesReinforced}x
											</span>
										)}
										<span className="text-[10px] text-muted-foreground font-mono ml-auto">
											{new Date(memory.createdAt).toLocaleDateString()}
										</span>
									</div>
									{editingId === memory.id ? (
										<div className="space-y-2">
											<MarkdownEditor
												content={editContent}
												onChange={setEditContent}
												placeholder="Memory content..."
												minHeight="80px"
											/>
											<div className="flex items-center gap-1">
												<Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleEdit(memory.id)}>
													<Check size={12} /> Save
												</Button>
												<Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
													Cancel
												</Button>
											</div>
										</div>
									) : (
										<div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-0.5 prose-headings:my-1">
											<ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.content}</ReactMarkdown>
										</div>
									)}
								</div>
								{editingId !== memory.id && (
									<div className="flex items-center gap-0.5 shrink-0">
										<Button
											size="icon"
											variant="ghost"
											className="h-7 w-7"
											onClick={() => {
												setEditingId(memory.id);
												setEditContent(memory.content);
											}}
										>
											<Pencil size={13} />
										</Button>
										<Button
											size="icon"
											variant="ghost"
											className="h-7 w-7 text-destructive hover:text-destructive"
											onClick={() => handleDelete(memory.id)}
										>
											<Trash2 size={13} />
										</Button>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
