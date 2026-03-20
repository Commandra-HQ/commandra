'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Bot, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Agent, type AgentFile, AgentCard } from './agent-card';
import { type NewAgentData, EMPTY_AGENT, AgentCreateForm } from './agent-form';

export default function AgentsPage() {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [loading, setLoading] = useState(true);
	const [showCreate, setShowCreate] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [agentFiles, setAgentFiles] = useState<Record<string, AgentFile[]>>({});
	const [fileContents, setFileContents] = useState<Record<string, string>>({});
	const [editingFile, setEditingFile] = useState<{ agentId: string; filename: string } | null>(null);
	const [editContent, setEditContent] = useState('');
	const [saving, setSaving] = useState(false);
	const [newAgent, setNewAgent] = useState<NewAgentData>(EMPTY_AGENT);

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
			if (newAgent.cron.trim()) body.trigger = { cron: newAgent.cron.trim(), enabled: true };

			const res = await apiFetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				setShowCreate(false);
				setNewAgent(EMPTY_AGENT);
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

	async function startEditFile(agentId: string, filename: string) {
		const key = `${agentId}/${filename}`;
		let content = fileContents[key];
		if (content === undefined) {
			try {
				const res = await apiFetch(`/api/agents/${agentId}/files/${filename}`);
				if (res.ok) {
					content = await res.text();
					setFileContents((prev) => ({ ...prev, [key]: content! }));
				}
			} catch (err) {
				console.error('Failed to load file:', err);
			}
		}
		setEditingFile({ agentId, filename });
		setEditContent(content || '');
	}

	async function saveFile() {
		if (!editingFile) return;
		setSaving(true);
		try {
			const res = await apiFetch(
				`/api/agents/${editingFile.agentId}/files/${editingFile.filename}`,
				{ method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: editContent },
			);
			if (res.ok) {
				const key = `${editingFile.agentId}/${editingFile.filename}`;
				setFileContents((prev) => ({ ...prev, [key]: editContent }));
				setEditingFile(null);
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

	async function handleToggleSchedule(agent: Agent) {
		const newEnabled = agent.trigger?.enabled === false;
		try {
			const res = await apiFetch(`/api/agents/${agent.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trigger: { ...agent.trigger, enabled: newEnabled } }),
			});
			if (res.ok) {
				const data = await res.json();
				setAgents((prev) => prev.map((a) => (a.id === agent.id ? data.agent : a)));
			}
		} catch (err) {
			console.error('Failed to toggle schedule:', err);
		}
	}

	function createNewFile(agentId: string) {
		const filename = prompt('Filename (e.g. SOUL.md, SKILLS.md, LEARNINGS.md):');
		if (!filename?.trim()) return;
		setEditingFile({ agentId, filename: filename.trim() });
		setEditContent('');
	}

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
					{showCreate ? <X size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
					{showCreate ? 'Cancel' : 'Create Agent'}
				</Button>
			</div>

			{showCreate && (
				<AgentCreateForm data={newAgent} onChange={setNewAgent} onCreate={handleCreate} />
			)}

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
					{agents.map((agent) => (
						<AgentCard
							key={agent.id}
							agent={agent}
							isExpanded={expandedId === agent.id}
							files={agentFiles[agent.id] || []}
							editingFile={editingFile}
							editContent={editContent}
							saving={saving}
							onToggleExpand={() => toggleExpand(agent)}
							onDelete={() => handleDelete(agent.id)}
							onToggleSchedule={() => handleToggleSchedule(agent)}
							onStartEdit={(filename) => startEditFile(agent.id, filename)}
							onCreateNewFile={() => createNewFile(agent.id)}
							onEditContentChange={setEditContent}
							onSaveFile={saveFile}
							onCancelEdit={() => setEditingFile(null)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
