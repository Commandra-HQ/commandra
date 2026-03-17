'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { Brain, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

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

	const filtered = filter === 'all' ? memories : memories.filter((m) => m.category === filter);

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Agent Memory</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Agent Memory</h1>
					<p className="text-muted-foreground mt-1">
						What the agent has learned about you across sessions.
					</p>
				</div>
				<Button size="sm" onClick={() => setShowAdd(!showAdd)}>
					{showAdd ? <X size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
					{showAdd ? 'Cancel' : 'Add Memory'}
				</Button>
			</div>

			{/* Add memory form */}
			{showAdd && (
				<Card>
					<CardContent className="pt-5 space-y-3">
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
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
							<Input
								placeholder="What should the agent remember?"
								value={newMemory.content}
								onChange={(e) => setNewMemory({ ...newMemory, content: e.target.value })}
							/>
						</div>
						<Button size="sm" onClick={handleAdd}>
							Save Memory
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Filters */}
			<div className="flex gap-2 flex-wrap">
				{['all', ...CATEGORIES].map((f) => (
					<button
						key={f}
						onClick={() => setFilter(f)}
						className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
							filter === f
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-border hover:bg-muted'
						}`}
					>
						{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
						{f !== 'all' && (
							<span className="ml-1 text-[10px] opacity-70">
								({memories.filter((m) => m.category === f).length})
							</span>
						)}
					</button>
				))}

				{/* Domain search */}
				<div className="ml-auto">
					<Input
						placeholder="Filter by domain..."
						value={domainFilter}
						onChange={(e) => setDomainFilter(e.target.value)}
						className="h-8 w-48 text-xs"
					/>
				</div>
			</div>

			{/* Memory list */}
			{filtered.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Brain size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">
							No memories yet. The agent will learn your preferences as you interact with it.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-2">
					{filtered.map((memory) => (
						<Card key={memory.id}>
							<CardContent className="py-3 px-4">
								<div className="flex items-start justify-between gap-3">
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<Badge variant={CATEGORY_VARIANT[memory.category] || 'secondary'}>
												{memory.category}
											</Badge>
											<Badge variant="outline" className="text-[10px]">
												{memory.source}
											</Badge>
											{memory.timesReinforced > 1 && (
												<span className="text-[10px] text-muted-foreground">
													reinforced {memory.timesReinforced}x
												</span>
											)}
										</div>
										{editingId === memory.id ? (
											<div className="flex items-center gap-2 mt-1">
												<Input
													value={editContent}
													onChange={(e) => setEditContent(e.target.value)}
													className="h-8 text-sm"
													autoFocus
												/>
												<Button size="sm" variant="outline" onClick={() => handleEdit(memory.id)}>
													Save
												</Button>
												<Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
													Cancel
												</Button>
											</div>
										) : (
											<p className="text-sm text-foreground">{memory.content}</p>
										)}
										<p className="text-[10px] text-muted-foreground mt-1">
											{new Date(memory.createdAt).toLocaleDateString()}
										</p>
									</div>
									{editingId !== memory.id && (
										<div className="flex items-center gap-1">
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
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
