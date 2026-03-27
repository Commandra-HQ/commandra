'use client';

import { apiFetch } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	MiniMap,
	type Node,
	Position,
	ReactFlow,
	useEdgesState,
	useNodesState,
} from '@xyflow/react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { Badge } from '@/components/ui/badge';
import { type GraphEdge, type GraphNode, useSiteGraph } from '@/lib/queries/use-site-graph';
import dagre from 'dagre';
import { ArrowLeft, Map } from 'lucide-react';

// ── Colors by page type ──────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
	dashboard: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
	table: { bg: '#1a3a2a', border: '#22c55e', text: '#86efac' },
	form: { bg: '#3d2e1a', border: '#f59e0b', text: '#fcd34d' },
	detail: { bg: '#2d1f3d', border: '#a855f7', text: '#c4b5fd' },
	settings: { bg: '#2a2a2a', border: '#6b7280', text: '#9ca3af' },
	other: { bg: '#1f2937', border: '#4b5563', text: '#9ca3af' },
};

function getTypeColor(type: string) {
	return TYPE_COLORS[type] || TYPE_COLORS.other;
}

// ── Custom node component ────────────────────────────────────────────────

type SiteNodeData = GraphNode & Record<string, unknown>;

function SiteNode({ data }: { data: SiteNodeData }) {
	const d = data;
	const colors = getTypeColor(d.type);

	return (
		<div
			style={{
				background: colors.bg,
				borderColor: colors.border,
				borderWidth: 2,
				borderStyle: 'solid',
				minWidth: 180,
				maxWidth: 260,
			}}
			className="px-3 py-2.5 rounded-md shadow-lg"
		>
			<Handle
				type="target"
				position={Position.Top}
				className="!bg-transparent !border-0 !w-0 !h-0"
			/>
			<div className="flex items-center gap-1.5 mb-1">
				<span
					className="font-mono text-[11px] font-semibold truncate"
					style={{ color: colors.text }}
				>
					{d.id}
				</span>
			</div>
			<p className="text-[11px] text-white/80 truncate font-medium">{d.title}</p>
			{d.description && (
				<p className="text-[10px] text-white/50 mt-0.5 line-clamp-2">{d.description}</p>
			)}
			<div className="flex items-center gap-2 mt-1.5 text-[10px] text-white/40 font-mono">
				<Badge
					variant="outline"
					className="text-[9px] px-1 py-0 border-white/20"
					style={{ color: colors.text }}
				>
					{d.type}
				</Badge>
				<span>{d.elements} el</span>
				<span>{d.visits} visits</span>
			</div>
			<Handle
				type="source"
				position={Position.Bottom}
				className="!bg-transparent !border-0 !w-0 !h-0"
			/>
		</div>
	);
}

const nodeTypes = { siteNode: SiteNode };

// ── Dagre layout ─────────────────────────────────────────────────────────

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

function layoutGraph(
	graphNodes: GraphNode[],
	graphEdges: GraphEdge[],
): { nodes: Node[]; edges: Edge[] } {
	const g = new dagre.graphlib.Graph();
	g.setDefaultEdgeLabel(() => ({}));
	g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100, edgesep: 30 });

	const nodeIds = new Set(graphNodes.map((n) => n.id));

	for (const node of graphNodes) {
		g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}

	// Build hierarchy edges from URL path structure (parent-child)
	// e.g. /settings/profile is a child of /settings
	const hierarchyEdges: { source: string; target: string; label: string }[] = [];

	for (const node of graphNodes) {
		const segments = node.id.split('/').filter(Boolean);
		for (let i = segments.length - 1; i > 0; i--) {
			const parentPath = `/${segments.slice(0, i).join('/')}`;
			if (nodeIds.has(parentPath)) {
				hierarchyEdges.push({ source: parentPath, target: node.id, label: segments[segments.length - 1] });
				g.setEdge(parentPath, node.id);
				break;
			}
		}
	}

	// Also add non-shared navigation edges (from the API) that aren't already hierarchy edges
	const hierarchySet = new Set(hierarchyEdges.map((e) => `${e.source}→${e.target}`));
	for (const edge of graphEdges) {
		const key = `${edge.source}→${edge.target}`;
		if (!hierarchySet.has(key) && g.hasNode(edge.source) && g.hasNode(edge.target)) {
			g.setEdge(edge.source, edge.target);
		}
	}

	dagre.layout(g);

	const nodes: Node[] = graphNodes.map((gn) => {
		const pos = g.node(gn.id);
		return {
			id: gn.id,
			type: 'siteNode',
			position: {
				x: (pos?.x ?? 0) - NODE_WIDTH / 2,
				y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
			},
			data: { ...gn } as SiteNodeData,
		};
	});

	// Render hierarchy edges (solid) + nav edges (dashed, lighter)
	const edges: Edge[] = [];

	// Hierarchy edges — solid, prominent
	for (let i = 0; i < hierarchyEdges.length; i++) {
		const he = hierarchyEdges[i];
		edges.push({
			id: `h-${i}`,
			source: he.source,
			target: he.target,
			style: { stroke: '#6b7280', strokeWidth: 2 },
			markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280', width: 12, height: 12 },
		});
	}

	// Navigation edges — dashed, subtle, only non-hierarchy ones
	for (let i = 0; i < graphEdges.length; i++) {
		const ge = graphEdges[i];
		const key = `${ge.source}→${ge.target}`;
		if (hierarchySet.has(key)) continue;
		if (!g.hasNode(ge.source) || !g.hasNode(ge.target)) continue;

		edges.push({
			id: `e-${i}`,
			source: ge.source,
			target: ge.target,
			label: ge.label,
			labelStyle: { fontSize: 9, fill: '#4b5563', fontFamily: 'monospace' },
			labelBgStyle: { fill: '#0a0a0a', fillOpacity: 0.8 },
			labelBgPadding: [4, 2] as [number, number],
			style: {
				stroke: '#374151',
				strokeWidth: 1,
				strokeDasharray: '4 4',
			},
			markerEnd: { type: MarkerType.ArrowClosed, color: '#374151', width: 10, height: 10 },
		});
	}

	return { nodes, edges };
}

// ── Node detail panel ────────────────────────────────────────────────────

function NodeDetail({ node, onClose }: { node: GraphNode; onClose: () => void }) {
	const colors = getTypeColor(node.type);

	return (
		<div className="absolute top-4 right-4 w-72 bg-background border border-border shadow-xl z-10 p-4 space-y-3">
			<div className="flex items-center justify-between">
				<span className="font-mono text-xs font-semibold" style={{ color: colors.text }}>
					{node.id}
				</span>
				<button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">
					close
				</button>
			</div>

			<div className="space-y-1.5">
				<p className="text-sm font-medium">{node.title}</p>
				{node.description && <p className="text-xs text-muted-foreground">{node.description}</p>}
			</div>

			<div className="grid grid-cols-3 gap-2 text-center">
				<div className="bg-surface p-2 rounded">
					<p className="text-lg font-mono font-bold">{node.visits}</p>
					<p className="text-[10px] text-muted-foreground">visits</p>
				</div>
				<div className="bg-surface p-2 rounded">
					<p className="text-lg font-mono font-bold">{node.elements}</p>
					<p className="text-[10px] text-muted-foreground">elements</p>
				</div>
				<div className="bg-surface p-2 rounded">
					<Badge
						variant="outline"
						className="text-[10px]"
						style={{ color: colors.text, borderColor: colors.border }}
					>
						{node.type}
					</Badge>
				</div>
			</div>

			{node.examples.length > 0 && (
				<div>
					<p className="text-[10px] text-muted-foreground font-mono mb-1">Example URLs</p>
					<div className="space-y-0.5">
						{node.examples.slice(0, 5).map((url) => (
							<p key={url} className="text-[11px] font-mono text-muted-foreground truncate">
								{url}
							</p>
						))}
					</div>
				</div>
			)}

			<div className="text-[10px] text-muted-foreground font-mono">
				Discovered {new Date(node.discoveredAt).toLocaleDateString()}
				{' · '}
				Last visited {new Date(node.lastVisited).toLocaleDateString()}
			</div>
		</div>
	);
}

// ── Main page ────────────────────────────────────────────────────────────

export default function SiteGraphPage() {
	const params = useParams();
	const router = useRouter();
	const domain = decodeURIComponent(params.domain as string);
	const { data, isLoading, error } = useSiteGraph(domain);
	const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
	const queryClient = useQueryClient();

	const buildMutation = useMutation({
		mutationFn: async () => {
			const res = await apiFetch(`/api/sites/${encodeURIComponent(domain)}/graph/build`, {
				method: 'POST',
			});
			if (!res.ok) throw new Error('Build failed');
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['site-graph', domain] });
		},
	});

	const { layoutNodes, layoutEdges } = useMemo(() => {
		if (!data?.nodes.length) return { layoutNodes: [], layoutEdges: [] };
		const { nodes, edges } = layoutGraph(data.nodes, data.edges);
		return { layoutNodes: nodes, layoutEdges: edges };
	}, [data]);

	const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

	// Sync layout when data changes (useNodesState only uses initial value)
	useEffect(() => {
		if (layoutNodes.length > 0) {
			setNodes(layoutNodes);
			setEdges(layoutEdges);
		}
	}, [layoutNodes, layoutEdges, setNodes, setEdges]);

	const onNodeClick = useCallback(
		(_: React.MouseEvent, node: Node) => {
			const graphNode = data?.nodes.find((n) => n.id === node.id);
			if (graphNode) setSelectedNode(graphNode);
		},
		[data],
	);

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-8">
				<span className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading graph...</p>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="border border-border py-16 text-center">
				<Map size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
				<p className="text-sm text-muted-foreground mb-3">
					No navigation graph yet. Browse {domain} with the extension, then build the graph.
				</p>
				<button
					onClick={() => buildMutation.mutate()}
					disabled={buildMutation.isPending}
					className="text-xs font-mono px-3 py-1.5 border border-border hover:border-foreground/30 transition-colors"
				>
					{buildMutation.isPending ? 'Building...' : 'Build Graph from Indexed Pages'}
				</button>
			</div>
		);
	}

	if (data.nodes.length === 0) {
		return (
			<div className="border border-border py-16 text-center">
				<Map size={24} strokeWidth={1.5} className="mx-auto text-muted-foreground mb-3" />
				<p className="text-sm text-muted-foreground mb-3">
					No pages discovered yet. Visit pages on {domain} to build the graph.
				</p>
				<button
					onClick={() => buildMutation.mutate()}
					disabled={buildMutation.isPending}
					className="text-xs font-mono px-3 py-1.5 border border-border hover:border-foreground/30 transition-colors"
				>
					{buildMutation.isPending ? 'Building...' : 'Build Graph from Indexed Pages'}
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<button
						onClick={() => router.push('/sites')}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						<ArrowLeft size={16} />
					</button>
					<div>
						<h2 className="text-sm font-medium font-mono">{domain}</h2>
						<p className="text-[11px] text-muted-foreground font-mono mt-0.5">
							{data.stats.totalNodes} pages · {data.stats.totalEdges} paths ·{' '}
							{data.stats.totalVisits} total visits
							{data.stats.coverageScore < 1 && (
								<span> · {Math.round(data.stats.coverageScore * 100)}% described</span>
							)}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<button
						onClick={() => buildMutation.mutate()}
						disabled={buildMutation.isPending}
						className="text-[11px] font-mono px-2.5 py-1 border border-border hover:border-foreground/30 transition-colors text-muted-foreground hover:text-foreground"
					>
						{buildMutation.isPending ? 'Rebuilding...' : 'Rebuild'}
					</button>
				</div>
				{/* Legend */}
				<div className="flex items-center gap-3">
					{Object.entries(TYPE_COLORS)
						.slice(0, 5)
						.map(([type, colors]) => (
							<div key={type} className="flex items-center gap-1">
								<div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.border }} />
								<span className="text-[10px] text-muted-foreground font-mono">{type}</span>
							</div>
						))}
				</div>
			</div>

			{/* Graph */}
			<div className="border border-border relative" style={{ height: 'calc(100vh - 180px)' }}>
				<ReactFlow
					nodes={nodes}
					edges={edges}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onNodeClick={onNodeClick}
					nodeTypes={nodeTypes}
					fitView
					fitViewOptions={{ padding: 0.2 }}
					minZoom={0.1}
					maxZoom={2}
					proOptions={{ hideAttribution: true }}
					defaultEdgeOptions={{
						type: 'smoothstep',
					}}
				>
					<Background color="#1f2937" gap={20} size={1} />
					<Controls
						showInteractive={false}
						className="!bg-background !border-border !shadow-none [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground"
					/>
					<MiniMap
						nodeColor={(node) => {
							const d = node.data as unknown as GraphNode;
							return getTypeColor(d?.type || 'other').border;
						}}
						maskColor="rgba(0, 0, 0, 0.7)"
						className="!bg-background !border-border"
					/>
				</ReactFlow>

				{selectedNode && <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />}
			</div>
		</div>
	);
}
