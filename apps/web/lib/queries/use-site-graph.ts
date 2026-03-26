import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';

export interface GraphNode {
	id: string;
	title: string;
	type: string;
	description: string;
	elements: number;
	visits: number;
	lastVisited: string;
	examples: string[];
	discoveredAt: string;
}

export interface GraphEdge {
	source: string;
	target: string;
	label: string;
	type: string;
	traversals: number;
}

export interface SiteGraph {
	domain: string;
	stats: {
		totalNodes: number;
		totalEdges: number;
		totalVisits: number;
		coverageScore: number;
	};
	lastUpdated: string;
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function useSiteGraph(domain: string) {
	return useQuery<SiteGraph>({
		queryKey: ['site-graph', domain],
		queryFn: async () => {
			const res = await apiFetch(`/api/sites/${encodeURIComponent(domain)}/graph`);
			if (!res.ok) throw new Error('Failed to fetch site graph');
			return res.json();
		},
		staleTime: 60_000,
		enabled: !!domain,
	});
}
