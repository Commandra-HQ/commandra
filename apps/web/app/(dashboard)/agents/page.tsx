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
import { type Agent, AgentCard } from './agent-card';
import { AgentCreateForm, EMPTY_AGENT, type NewAgentData } from './agent-form';

export default function AgentsPage() {
	const [offset, setOffset] = useState(0);
	const [showCreate, setShowCreate] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [fileContents, setFileContents] = useState<Record<string, string>>({});
	const [savingFile, setSavingFile] = useState<string | null>(null);
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
			body.domains = newAgent.domains
				.split(',')
				.map((d) => d.trim())
				.filter(Boolean);
		if (newAgent.tools.trim())
			body.tools = newAgent.tools
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
		if (newAgent.cron.trim()) body.trigger = { cron: newAgent.cron.trim(), enabled: true };

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

	async function loadFile(agentId: string, filename: string) {
		const key = `${agentId}/${filename}`;
		if (fileContents[key] !== undefined) return;
		try {
			const res = await apiFetch(`/api/agents/${agentId}/files/${filename}`);
			if (res.ok) {
				const content = await res.text();
				setFileContents((prev) => ({ ...prev, [key]: content }));
			}
		} catch {
			setFileContents((prev) => ({ ...prev, [key]: '' }));
		}
	}

	async function saveFile(agentId: string, filename: string, content: string) {
		setSavingFile(filename);
		try {
			await updateFileMutation.mutateAsync({ id: agentId, filename, content });
			const key = `${agentId}/${filename}`;
			setFileContents((prev) => ({ ...prev, [key]: content }));
		} finally {
			setSavingFile(null);
		}
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
		saveFile(agentId, filename.trim(), '');
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
								fileContents={Object.fromEntries(
									Object.entries(fileContents)
										.filter(([k]) => k.startsWith(`${agent.id}/`))
										.map(([k, v]) => [k.split('/').slice(1).join('/'), v]),
								)}
								savingFile={savingFile}
								onToggleExpand={() => toggleExpand(agent)}
								onDelete={() => handleDelete(agent.id)}
								onToggleSchedule={() => handleToggleSchedule(agent)}
								onCreateNewFile={() => createNewFile(agent.id)}
								onSaveFile={(filename, content) => saveFile(agent.id, filename, content)}
								onLoadFile={(filename) => loadFile(agent.id, filename)}
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
