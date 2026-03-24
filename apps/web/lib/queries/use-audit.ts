import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface AuditLog {
	id: string;
	action: string;
	safetyLevel: string;
	approved: boolean;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export function useAuditLogsQuery(params: { limit?: number; offset?: number; safetyLevel?: string } = {}) {
	const { limit = 50, offset = 0, safetyLevel } = params;
	return useQuery({
		queryKey: ['auditLogs', { limit, offset, safetyLevel }],
		queryFn: async () => {
			const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (safetyLevel) search.set('safetyLevel', safetyLevel);
			const res = await apiFetch(`/api/audit?${search}`);
			if (!res.ok) throw new Error('Failed to fetch audit logs');
			return res.json() as Promise<{ logs: AuditLog[]; total: number }>;
		},
	});
}
