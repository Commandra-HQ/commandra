import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface UsageSummary {
	totalRuns: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalThinkingTokens: number;
	totalTokensUsed: number;
	totalCostUsd: string;
}

export interface UsageByAgent {
	agentId: string;
	agentName: string | null;
	totalRuns: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokensUsed: number;
	totalCostUsd: string;
	lastRunAt: string;
}

export function useUsageSummary(params?: { from?: string; to?: string; agentId?: string }) {
	const searchParams = new URLSearchParams();
	if (params?.from) searchParams.set('from', params.from);
	if (params?.to) searchParams.set('to', params.to);
	if (params?.agentId) searchParams.set('agentId', params.agentId);
	const qs = searchParams.toString();

	return useQuery({
		queryKey: ['usage', 'summary', params],
		queryFn: async () => {
			const res = await apiFetch(`/api/usage/summary${qs ? `?${qs}` : ''}`);
			if (!res.ok) throw new Error('Failed to fetch usage summary');
			const json = await res.json();
			return json.data as UsageSummary;
		},
	});
}

export function useUsageByAgent(params?: { from?: string; to?: string }) {
	const searchParams = new URLSearchParams();
	if (params?.from) searchParams.set('from', params.from);
	if (params?.to) searchParams.set('to', params.to);
	const qs = searchParams.toString();

	return useQuery({
		queryKey: ['usage', 'by-agent', params],
		queryFn: async () => {
			const res = await apiFetch(`/api/usage/by-agent${qs ? `?${qs}` : ''}`);
			if (!res.ok) throw new Error('Failed to fetch usage by agent');
			const json = await res.json();
			return json.data as UsageByAgent[];
		},
	});
}
