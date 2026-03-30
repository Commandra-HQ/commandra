import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Memory {
	id: string;
	domain: string;
	category: string;
	content: string;
	source: string;
	confidence: number;
	timesReinforced: number;
	createdAt: string;
	updatedAt: string;
}

export function useMemoriesQuery(
	params: { limit?: number; offset?: number; domain?: string; category?: string } = {},
) {
	const { limit = 30, offset = 0, domain, category } = params;
	return useQuery({
		queryKey: ['memories', { limit, offset, domain, category }],
		queryFn: async () => {
			const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (domain) search.set('domain', domain);
			if (category) search.set('category', category);
			const res = await apiFetch(`/api/memory?${search}`);
			if (!res.ok) throw new Error('Failed to fetch memories');
			return res.json() as Promise<{ memories: Memory[]; total: number }>;
		},
	});
}

export function useAddMemoryMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: { domain: string; category: string; content: string }) => {
			const res = await apiFetch('/api/memory', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (!res.ok) throw new Error('Failed to add memory');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['memories'] });
		},
	});
}

export function useEditMemoryMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, content }: { id: string; content: string }) => {
			const res = await apiFetch(`/api/memory/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content }),
			});
			if (!res.ok) throw new Error('Failed to edit memory');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['memories'] });
		},
	});
}

export function useDeleteMemoryMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const res = await apiFetch(`/api/memory/${id}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Failed to delete memory');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['memories'] });
		},
	});
}
