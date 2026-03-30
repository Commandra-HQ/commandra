import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface Site {
	id: string;
	domain: string;
	totalPages: number;
	totalElements: number;
	lastCrawledAt: string | null;
	createdAt: string;
}

export interface SitePage {
	id: string;
	url: string;
	urlPattern: string | null;
	title: string | null;
	pageType: string | null;
	elements: unknown[];
	navigationLinks: unknown[];
	lastIndexedAt: string | null;
}

export function useSitesQuery(params: { limit?: number; offset?: number } = {}) {
	const { limit = 25, offset = 0 } = params;
	return useQuery({
		queryKey: ['sites', { limit, offset }],
		queryFn: async () => {
			const res = await apiFetch(`/api/sites?limit=${limit}&offset=${offset}`);
			if (!res.ok) throw new Error('Failed to fetch sites');
			return res.json() as Promise<{ sites: Site[]; total: number }>;
		},
	});
}

export function useSiteDomainQuery(domain: string | null) {
	return useQuery({
		queryKey: ['siteDomain', domain],
		queryFn: async () => {
			const res = await apiFetch(`/api/sites/${domain}`);
			if (!res.ok) throw new Error('Failed to fetch site');
			return res.json() as Promise<{ site: Site; pages: SitePage[] }>;
		},
		enabled: !!domain,
	});
}
