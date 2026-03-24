'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { apiFetch } from '@/lib/api';
import {
	useAgentFilesQuery,
	useAgentRunsQuery,
	useAgentsQuery,
	useCreateAgentMutation,
	useDeleteAgentMutation,
	useUpdateAgentFileMutation,
	useUpdateAgentMutation,
} from '@/lib/queries/use-agents';
import { Bot, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { type Agent, type AgentFile, AgentCard } from './agent-card';
import { type NewAgentData, EMPTY_AGENT, AgentCreateForm } from './agent-form';

export default function AgentsPage() {
	const [offset, setOffset] = useState(0);
	const [showCreate, setShowCreate] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [fileContents, setFileContents] = useState<Record<string, string>>({});
	const [editingFile, setEditingFile] = useState<{ agentId: string; filename: string } | null>(null);
	const [editContent, setEditContent] = useState('');
	const [newAgent, setNewAgent] = useState<NewAgentData>(EMPTY_AGENT);
	const limit = 25;

	const { data, isLoading } = useAgentsQuery({ limit, offset });
	const { data: filesData } = useAgentFilesQuery(expandedId);
	const { data: runsData } = useAgentRunsQuery({ id: expandedId, limit: 10 });
	const createMutation = useCreateAgentMutation();
	const deleteMutation = useDeleteAgentMutation();
	const updateMutation = useUpdateAgentMutation();
	const updateFileMutation = useUpdateAgentFileMutation();

	const agents = data?.agents ?? [];
	const total = data?.total ?? 0;
	const agentFiles = filesData?.files ?? [];
	const agentRuns = runsData?.runs;

	async function handleCreate() {
		if (!newAgent.slug.trim() || !newAgent.name.trim()) return;
		const body: Record<string, unknown> = {
			slug: newAgent.slug,
			name: newAgent.name,
			description: newAgent.description,
		};
		if (newAgent.model) body.model = newAgent.model;
		if (newAgent.maxIterations) body.maxIterations = Number(newAgent.maxIterations);
		if (newAgent.domains.trim())
			body.domains = newAgent.domains.split(',').map((d) => d.trim()).filter(Boolean);
		if (newAgent.tools.trim())
			body.tools = newAgent.tools.split(',').map((t) => t.trim()).filter(Boolean);
		if (newAgent.cron.trim())
			body.trigger = { cron: newAgent.cron.trim(), enabled: true };

		await createMutation.mutateAsync(body as Parameters<typeof createMutation.mutateAsync>[0]);
		setShowCreate(false);
		setNewAgent(EMPTY_AGENT);
	}

	async function handleDelete(id: string) {
		await deleteMutation.mutateAsync(id);
		if (expandedId === id) setExpandedId(null);
	}

	function toggleExpand(agent: Agent) {
		setExpandedId(expandedId === agent.id ? null : agent.id);
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
			} catch {
				// Failed to load file
			}
		}
		setEditingFile({ agentId, filename });
		setEditContent(content || '');
	}

	async function saveFile() {
		if (!editingFile) return;
		await updateFileMutation.mutateAsync({
			id: editingFile.agentId,
			filename: editingFile.filename,
			content: editContent,
		});
		const key = `${editingFile.agentId}/${editingFile.filename}`;
		setFileContents((prev) => ({ ...prev, [key]: editContent }));
		setEditingFile(null);
	}

	async function handleToggleSchedule(agent: Agent) {
		const newEnabled = agent.trigger?.enabled === false;
		await updateMutation.mutateAsync({
			id: agent.id,
			trigger: { ...agent.trigger, enabled: newEnabled },
		} as Parameters<typeof updateMutation.mutateAsync>[0]);
	}

	function createNewFile(agentId: string) {
		const filename = prompt('Filename (e.g. SOUL.md, SKILLS.md, LEARNINGS.md):');
		if (!filename?.trim()) return;
		setEditingFile({ agentId, filename: filename.trim() });
		setEditContent('');
	}

	if (isLoading && offset === 0) {
		return (
			<div className="flex items-center gap-2 py-8">
				<div className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-end">
				<Button size="sm" onClick={() => setShowCreate(!showCreate)}>
					{showCreate ? <X size={14} className="mr-1.5" /> : <Plus size={14} className="mr-1.5" />}
					{showCreate ? 'Cancel' : 'Create Agent'}
				</Button>
			</div>

			{showCreate && (
				<AgentCreateForm data={newAgent} onChange={setNewAgent} onCreate={handleCreate} />
			)}

			{agents.length === 0 && offset === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Bot size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground font-mono">
							No agents yet. Create one to get started.
						</p>
					</CardContent>
				</Card>
			) : (
				<>
					<div className="space-y-2">
						{agents.map((agent) => (
							<AgentCard
								key={agent.id}
								agent={agent}
								isExpanded={expandedId === agent.id}
								files={expandedId === agent.id ? agentFiles : []}
								editingFile={editingFile}
								editContent={editContent}
								saving={updateFileMutation.isPending}
								onToggleExpand={() => toggleExpand(agent)}
								onDelete={() => handleDelete(agent.id)}
								onToggleSchedule={() => handleToggleSchedule(agent)}
								onStartEdit={(filename) => startEditFile(agent.id, filename)}
								onCreateNewFile={() => createNewFile(agent.id)}
								onEditContentChange={setEditContent}
								onSaveFile={saveFile}
								onCancelEdit={() => setEditingFile(null)}
								runs={expandedId === agent.id ? agentRuns : undefined}
							/>
						))}
					</div>
					<Pagination offset={offset} limit={limit} total={total} onPageChange={setOffset} />
				</>
			)}
		</div>
	);
}
