import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Settings {
	llmProvider: string;
	llmApiKey: string | null;
	llmModelStrong: string;
	llmModelFast: string;
}

export function useSettingsQuery() {
	return useQuery({
		queryKey: ['settings'],
		queryFn: async () => {
			const res = await apiFetch('/api/settings');
			if (!res.ok) throw new Error('Failed to fetch settings');
			return res.json() as Promise<{ settings: Settings }>;
		},
	});
}

export function useUpdateSettingsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: Partial<Settings>) => {
			const res = await apiFetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (!res.ok) throw new Error('Failed to update settings');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['settings'] });
		},
	});
}
