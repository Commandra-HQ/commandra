import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface DailyPoint {
	date: string;
	count: number;
}

export interface RecentConversation {
	id: string;
	title: string | null;
	outcome: string | null;
	createdAt: string;
}

export interface StatsData {
	conversations: number;
	actions: number;
	sites: number;
	agents: number;
	dailyConversations: DailyPoint[];
	dailyActions: DailyPoint[];
	recentConversations: RecentConversation[];
	agentRunStats: { status: string; count: number }[];
	actionBreakdown: { safetyLevel: string; count: number }[];
	outcomeBreakdown: { outcome: string; count: number }[];
}

export function useStatsQuery() {
	return useQuery({
		queryKey: ['stats'],
		queryFn: async () => {
			const res = await apiFetch('/api/stats');
			if (!res.ok) throw new Error('Failed to fetch stats');
			return res.json() as Promise<StatsData>;
		},
	});
}
