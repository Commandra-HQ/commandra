import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Agent {
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
	trigger?: { cron?: string; enabled?: boolean };
	autonomy?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentFile {
	name: string;
	size: number;
	updatedAt: string;
}

export interface AgentRun {
	id: string;
	agentId: string;
	status: string;
	toolCalls: number;
	tokensUsed: number;
	durationMs: number | null;
	error: string | null;
	createdAt: string;
}

export function useAgentsQuery(params: { limit?: number; offset?: number } = {}) {
	const { limit = 25, offset = 0 } = params;
	return useQuery({
		queryKey: ['agents', { limit, offset }],
		queryFn: async () => {
			const res = await apiFetch(`/api/agents?limit=${limit}&offset=${offset}`);
			if (!res.ok) throw new Error('Failed to fetch agents');
			return res.json() as Promise<{ agents: Agent[]; total: number }>;
		},
	});
}

export function useAgentQuery(id: string | null) {
	return useQuery({
		queryKey: ['agent', id],
		queryFn: async () => {
			const res = await apiFetch(`/api/agents/${id}`);
			if (!res.ok) throw new Error('Failed to fetch agent');
			return res.json() as Promise<{ agent: Agent }>;
		},
		enabled: !!id,
	});
}

export function useAgentFilesQuery(id: string | null) {
	return useQuery({
		queryKey: ['agentFiles', id],
		queryFn: async () => {
			const res = await apiFetch(`/api/agents/${id}/files`);
			if (!res.ok) throw new Error('Failed to fetch agent files');
			return res.json() as Promise<{ files: AgentFile[] }>;
		},
		enabled: !!id,
	});
}

export function useAgentRunsQuery(params: { id: string | null; limit?: number; offset?: number }) {
	const { id, limit = 20, offset = 0 } = params;
	return useQuery({
		queryKey: ['agentRuns', id, { limit, offset }],
		queryFn: async () => {
			const res = await apiFetch(`/api/agents/${id}/runs?limit=${limit}&offset=${offset}`);
			if (!res.ok) throw new Error('Failed to fetch agent runs');
			return res.json() as Promise<{ runs: AgentRun[]; total: number }>;
		},
		enabled: !!id,
	});
}

export function useCreateAgentMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: {
			slug: string;
			name: string;
			description?: string;
			model?: string;
			maxIterations?: number;
			domains?: string[];
			tools?: string[];
			trigger?: { cron?: string; enabled?: boolean };
			autonomy?: string;
		}) => {
			const res = await apiFetch('/api/agents', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Failed to create agent');
			}
			return res.json() as Promise<{ agent: Agent }>;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['agents'] });
			queryClient.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export function useUpdateAgentMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, ...data }: { id: string } & Partial<Agent>) => {
			const res = await apiFetch(`/api/agents/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (!res.ok) throw new Error('Failed to update agent');
			return res.json() as Promise<{ agent: Agent }>;
		},
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['agents'] });
			queryClient.invalidateQueries({ queryKey: ['agent', vars.id] });
		},
	});
}

export function useDeleteAgentMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const res = await apiFetch(`/api/agents/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed to delete agent');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['agents'] });
			queryClient.invalidateQueries({ queryKey: ['stats'] });
		},
	});
}

export interface ScheduledAgent extends Agent {
	latestRun: (AgentRun & { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: string }) | null;
}

export interface ScheduledTask {
	id: string;
	agentId: string | null;
	agentName: string | null;
	agentSlug: string | null;
	task: string;
	runAt: string;
	status: string;
	error: string | null;
	createdAt: string;
}

export function useScheduledAgentsQuery() {
	return useQuery({
		queryKey: ['agents', 'scheduled'],
		queryFn: async () => {
			const res = await apiFetch('/api/agents/scheduled');
			if (!res.ok) throw new Error('Failed to fetch scheduled agents');
			return res.json() as Promise<{ data: ScheduledAgent[]; tasks: ScheduledTask[] }>;
		},
	});
}

export function useRunAgentNowMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (agentId: string) => {
			const res = await apiFetch(`/api/agents/${agentId}/run-now`, { method: 'POST' });
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Failed to run agent');
			}
			return res.json() as Promise<{ conversationId: string }>;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['agents', 'scheduled'] });
			queryClient.invalidateQueries({ queryKey: ['agentRuns'] });
		},
	});
}

export function useUpdateAgentFileMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, filename, content }: { id: string; filename: string; content: string }) => {
			const res = await apiFetch(`/api/agents/${id}/files/${filename}`, {
				method: 'PUT',
				body: content,
			});
			if (!res.ok) throw new Error('Failed to update file');
		},
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['agentFiles', vars.id] });
		},
	});
}
