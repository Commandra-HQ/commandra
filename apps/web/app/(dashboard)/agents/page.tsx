'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import {
	Bot,
	ChevronDown,
	ChevronRight,
	FileText,
	Plus,
	Save,
	Trash2,
	Upload,
	X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface Agent {
	id: string;
	slug: string;
	name: string;
	description: string;
	model?: string;
	maxIterations?: number;
	tools?: string[];
	domains?: string[];
	soul?: string;
	skills?: string;
}

interface AgentFile {
	name: string;
	size: number;
	updatedAt: string;
}

export default function AgentsPage() {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [agentFiles, setAgentFiles] = useState<Record<string, AgentFile[]>>({});
	const [fileContents, setFileContents] = useState<Record<string, string>>({});
	const [editingFile, setEditingFile] = useState<{ agentId: string; filename: string } | null>(
		null,
	);
	const [editContent, setEditContent] = useState('');
	const [saving, setSaving] = useState(false);
	const [newAgent, setNewAgent] = useState({
		slug: '',
		name: '',
		description: '',
		model: '',
		maxIterations: '',
		domains: '',
		tools: '',
	});

	useEffect(() => {
		fetchAgents();
	}, []);

	async function fetchAgents() {
		try {
			const res = await apiFetch('/api/agents');
			if (res.ok) {
				const data = await res.json();
				setAgents(data.agents || []);
			}
		} catch (err) {
			console.error('Failed to fetch agents:', err);
		} finally {
			setLoading(false);
		}
	}

	async function handleCreate() {
		if (!newAgent.slug.trim() || !newAgent.name.trim()) return;
		try {
			const body: Record<string, unknown> = {
				slug: newAgent.slug,
				name: newAgent.name,
				description: newAgent.description,
			};
			if (newAgent.model) body.model = newAgent.model;
			if (newAgent.maxIterations) body.maxIterations = Number(newAgent.maxIterations);
			if (newAgent.domains.trim()) body.domains = newAgent.domains.split(',').map((d) => d.trim()).filter(Boolean);
			if (newAgent.tools.trim()) body.tools = newAgent.tools.split(',').map((t) => t.trim()).filter(Boolean);

			const res = await apiFetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				setShowCreate(false);
				setNewAgent({ slug: '', name: '', description: '', model: '', maxIterations: '', domains: '', tools: '' });
				fetchAgents();
			}
		} catch (err) {
			console.error('Failed to create agent:', err);
		}
	}

	async function handleDelete(id: string) {
		try {
			const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
			if (res.ok) {
				setAgents((prev) => prev.filter((a) => a.id !== id));
				if (expandedId === id) setExpandedId(null);
			}
		} catch (err) {
			console.error('Failed to delete agent:', err);
		}
	}

	async function toggleExpand(agent: Agent) {
		if (expandedId === agent.id) {
			setExpandedId(null);
			return;
		}
		setExpandedId(agent.id);

		// Fetch full agent (hydrated with files) + file list
		try {
			const [agentRes, filesRes] = await Promise.all([
				apiFetch(`/api/agents/${agent.id}`),
				apiFetch(`/api/agents/${agent.id}/files`),
			]);
			if (agentRes.ok) {
				const data = await agentRes.json();
				setAgents((prev) => prev.map((a) => (a.id === agent.id ? data.agent : a)));
			}
			if (filesRes.ok) {
				const data = await filesRes.json();
				setAgentFiles((prev) => ({ ...prev, [agent.id]: data.files || [] }));
			}
		} catch (err) {
			console.error('Failed to load agent details:', err);
		}
	}

	async function loadFileContent(agentId: string, filename: string) {
		const key = `${agentId}/${filename}`;
		if (fileContents[key] !== undefined) return fileContents[key];
		try {
			const res = await apiFetch(`/api/agents/${agentId}/files/${filename}`);
			if (res.ok) {
				const text = await res.text();
				setFileContents((prev) => ({ ...prev, [key]: text }));
				return text;
			}
		} catch (err) {
			console.error('Failed to load file:', err);
		}
		return '';
	}

	async function startEditFile(agentId: string, filename: string) {
		const content = await loadFileContent(agentId, filename);
		setEditingFile({ agentId, filename });
		setEditContent(content || '');
	}

	async function saveFile() {
		if (!editingFile) return;
		setSaving(true);
		try {
			const res = await apiFetch(
				`/api/agents/${editingFile.agentId}/files/${editingFile.filename}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'text/plain' },
					body: editContent,
				},
			);
			if (res.ok) {
				const key = `${editingFile.agentId}/${editingFile.filename}`;
				setFileContents((prev) => ({ ...prev, [key]: editContent }));
				setEditingFile(null);
				// Refresh file list
				const filesRes = await apiFetch(`/api/agents/${editingFile.agentId}/files`);
				if (filesRes.ok) {
					const data = await filesRes.json();
					setAgentFiles((prev) => ({ ...prev, [editingFile.agentId]: data.files || [] }));
				}
			}
		} catch (err) {
			console.error('Failed to save file:', err);
		} finally {
			setSaving(false);
		}
	}

	async function createNewFile(agentId: string) {
		const filename = prompt('Filename (e.g. SOUL.md, SKILLS.md, LEARNINGS.md):');
		if (!filename?.trim()) return;
		setEditingFile({ agentId, filename: filename.trim() });
		setEditContent('');
	}

	const KNOWN_FILES = ['SOUL.md', 'SKILLS.md', 'LEARNINGS.md', 'ERRORS.md'];

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
						Specialized agents with custom identities, tools, and domains.
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

			{/* Create form */}
			{showCreate && (
				<Card>
					<CardContent className="pt-5 space-y-3">
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Slug
								</label>
								<Input
									placeholder="github-helper"
									value={newAgent.slug}
									onChange={(e) =>
										setNewAgent({ ...newAgent, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })
									}
								/>
								<p className="text-[10px] text-muted-foreground mt-0.5">
									Lowercase, hyphens, underscores only
								</p>
							</div>
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Name
								</label>
								<Input
									placeholder="GitHub Helper"
									value={newAgent.name}
									onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
								/>
							</div>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Description
							</label>
							<Input
								placeholder="What does this agent do?"
								value={newAgent.description}
								onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Model
								</label>
								<select
									value={newAgent.model}
									onChange={(e) => setNewAgent({ ...newAgent, model: e.target.value })}
									className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
								>
									<option value="">Default (strong)</option>
									<option value="strong">Strong</option>
									<option value="fast">Fast</option>
								</select>
							</div>
							<div>
								<label className="text-xs font-medium text-muted-foreground mb-1 block">
									Max Iterations
								</label>
								<Input
									type="number"
									placeholder="15"
									value={newAgent.maxIterations}
									onChange={(e) => setNewAgent({ ...newAgent, maxIterations: e.target.value })}
								/>
							</div>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Domains (comma-separated)
							</label>
							<Input
								placeholder="github.com, *.github.com"
								value={newAgent.domains}
								onChange={(e) => setNewAgent({ ...newAgent, domains: e.target.value })}
							/>
						</div>
						<div>
							<label className="text-xs font-medium text-muted-foreground mb-1 block">
								Tool Allowlist (comma-separated, leave empty for all)
							</label>
							<Input
								placeholder="navigate, read_text, click_element"
								value={newAgent.tools}
								onChange={(e) => setNewAgent({ ...newAgent, tools: e.target.value })}
							/>
						</div>
						<Button size="sm" onClick={handleCreate}>
							Create Agent
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Agent list */}
			{agents.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Bot size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">
							No agents yet. Create one to get started.
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-2">
					{agents.map((agent) => {
						const isExpanded = expandedId === agent.id;
						const files = agentFiles[agent.id] || [];

						return (
							<Card key={agent.id}>
								<CardContent className="py-3 px-4">
									{/* Header */}
									<div className="flex items-center justify-between">
										<button
											onClick={() => toggleExpand(agent)}
											className="flex items-center gap-2 flex-1 min-w-0 text-left"
										>
											{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
											<Bot size={16} className="text-primary shrink-0" />
											<span className="font-medium text-sm">{agent.name}</span>
											<Badge variant="outline" className="text-[10px] ml-1">
												{agent.slug}
											</Badge>
											{agent.model && (
												<Badge variant="secondary" className="text-[10px]">
													{agent.model}
												</Badge>
											)}
										</button>
										<div className="flex items-center gap-1 ml-2">
											<Button
												size="icon"
												variant="ghost"
												className="h-7 w-7 text-destructive hover:text-destructive"
												onClick={() => handleDelete(agent.id)}
											>
												<Trash2 size={13} />
											</Button>
										</div>
									</div>

									{agent.description && (
										<p className="text-xs text-muted-foreground mt-1 ml-8">
											{agent.description}
										</p>
									)}

									{/* Tags */}
									{(agent.domains?.length || agent.tools?.length) && (
										<div className="flex gap-1.5 flex-wrap mt-2 ml-8">
											{agent.domains?.map((d) => (
												<Badge key={d} variant="default" className="text-[10px]">
													{d}
												</Badge>
											))}
											{agent.tools?.map((t) => (
												<Badge key={t} variant="secondary" className="text-[10px]">
													{t}
												</Badge>
											))}
										</div>
									)}

									{/* Expanded: Files */}
									{isExpanded && (
										<div className="mt-4 ml-8 space-y-3">
											<div className="flex items-center justify-between">
												<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
													Agent Files
												</h4>
												<Button
													size="sm"
													variant="outline"
													className="h-7 text-xs"
													onClick={() => createNewFile(agent.id)}
												>
													<Upload size={12} className="mr-1" />
													New File
												</Button>
											</div>

											{/* Quick-create buttons for known files that don't exist yet */}
											{KNOWN_FILES.filter(
												(f) => !files.some((af) => af.name === f),
											).length > 0 && (
												<div className="flex gap-1.5 flex-wrap">
													{KNOWN_FILES.filter(
														(f) => !files.some((af) => af.name === f),
													).map((f) => (
														<button
															key={f}
															onClick={() => {
																setEditingFile({ agentId: agent.id, filename: f });
																setEditContent('');
															}}
															className="px-2 py-1 text-[10px] rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
														>
															+ {f}
														</button>
													))}
												</div>
											)}

											{files.length === 0 && !editingFile && (
												<p className="text-xs text-muted-foreground">
													No files yet. Create SOUL.md to give this agent a personality.
												</p>
											)}

											{files.map((file) => (
												<div
													key={file.name}
													className="flex items-center justify-between p-2 rounded border border-border hover:bg-muted/50"
												>
													<div className="flex items-center gap-2">
														<FileText size={14} className="text-muted-foreground" />
														<span className="text-sm">{file.name}</span>
														<span className="text-[10px] text-muted-foreground">
															{file.size > 0 ? `${(file.size / 1024).toFixed(1)} KB` : ''}
														</span>
													</div>
													<Button
														size="sm"
														variant="ghost"
														className="h-7 text-xs"
														onClick={() => startEditFile(agent.id, file.name)}
													>
														Edit
													</Button>
												</div>
											))}

											{/* File editor */}
											{editingFile?.agentId === agent.id && (
												<div className="space-y-2">
													<div className="flex items-center justify-between">
														<span className="text-sm font-medium">
															{editingFile.filename}
														</span>
														<div className="flex items-center gap-1">
															<Button
																size="sm"
																className="h-7 text-xs"
																onClick={saveFile}
																disabled={saving}
															>
																<Save size={12} className="mr-1" />
																{saving ? 'Saving...' : 'Save'}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																className="h-7 text-xs"
																onClick={() => setEditingFile(null)}
															>
																Cancel
															</Button>
														</div>
													</div>
													<textarea
														value={editContent}
														onChange={(e) => setEditContent(e.target.value)}
														className="w-full min-h-[200px] rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
														placeholder={getPlaceholder(editingFile.filename)}
													/>
												</div>
											)}

											{/* Soul/Skills preview if loaded */}
											{agent.soul && !editingFile && (
												<div className="p-3 rounded bg-muted/50 border border-border">
													<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
														SOUL.md Preview
													</p>
													<p className="text-xs text-foreground whitespace-pre-wrap line-clamp-4">
														{agent.soul}
													</p>
												</div>
											)}
										</div>
									)}
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}

function getPlaceholder(filename: string): string {
	switch (filename) {
		case 'SOUL.md':
			return 'You are a GitHub specialist. You help users navigate repositories, review PRs, and manage issues efficiently...';
		case 'SKILLS.md':
			return '## Learned Skills\n\n- Navigate to PR review page using the "Pull requests" tab\n- Filter issues by label using the sidebar...';
		case 'LEARNINGS.md':
			return '## Corrections & Discoveries\n\n- User prefers squash merges over regular merges\n- The "Files changed" tab loads slowly on large PRs...';
		case 'ERRORS.md':
			return '## Failure Patterns\n\n- Clicking "Merge" too quickly after approval causes a race condition...';
		default:
			return '';
	}
}
