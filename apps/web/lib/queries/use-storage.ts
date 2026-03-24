import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface StorageStats {
	totalSizeBytes: number;
	totalFiles: number;
	maxSizeBytes: number;
	categories: { name: string; fileCount: number; sizeBytes: number }[];
}

export interface StorageFile {
	name: string;
	path: string;
	domain: string;
	category: string;
	sizeBytes: number;
	createdAt: number;
}

export function useStorageStatsQuery() {
	return useQuery({
		queryKey: ['storageStats'],
		queryFn: async () => {
			const res = await apiFetch('/api/storage/stats');
			if (!res.ok) throw new Error('Failed to fetch storage stats');
			return res.json() as Promise<StorageStats>;
		},
	});
}

export function useStorageFilesQuery(params: { category: string; limit?: number; offset?: number; domain?: string }) {
	const { category, limit = 50, offset = 0, domain } = params;
	return useQuery({
		queryKey: ['storageFiles', category, { limit, offset, domain }],
		queryFn: async () => {
			const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			if (domain) search.set('domain', domain);
			const res = await apiFetch(`/api/storage/${category}?${search}`);
			if (!res.ok) throw new Error('Failed to fetch files');
			return res.json() as Promise<{ files: StorageFile[]; total: number }>;
		},
		enabled: !!category,
	});
}

export function useDeleteStorageFileMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ category, domain, filename }: { category: string; domain: string; filename: string }) => {
			const res = await apiFetch(`/api/storage/${category}/${domain}/${filename}`, {
				method: 'DELETE',
			});
			if (!res.ok) throw new Error('Failed to delete file');
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['storageFiles'] });
			queryClient.invalidateQueries({ queryKey: ['storageStats'] });
		},
	});
}
