/**
 * SITEMAP.yaml — Navigation graph builder for domains.
 *
 * Passively builds a graph of pages (nodes) and navigation paths (edges)
 * as users browse. Stored as YAML in Supabase Storage. Deterministic code
 * builds the structure; the fast model generates descriptions for new nodes.
 *
 * S3 path: domains/{userId}/{domain}/SITEMAP.yaml
 */

import { normalizeUrlPattern } from '@afe/shared';
import yaml from 'js-yaml';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import { downloadDomainFile, uploadDomainFile } from './domain-files.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SitemapNode {
	title: string;
	type: string;
	description: string;
	elements: number;
	visits: number;
	lastVisited: string;
	examples: string[];
	discoveredAt: string;
}

export interface SitemapEdge {
	from: string;
	to: string;
	label: string;
	type: 'nav_link' | 'breadcrumb' | 'redirect' | 'form_submit';
	traversals: number;
}

export interface Sitemap {
	domain: string;
	version: number;
	lastUpdated: string;
	stats: {
		totalNodes: number;
		totalEdges: number;
		totalVisits: number;
		coverageScore: number;
	};
	nodes: Record<string, SitemapNode>;
	edges: SitemapEdge[];
}

interface PageIndexInput {
	url: string;
	urlPattern?: string;
	title?: string;
	pageType?: string;
	elements?: unknown[];
	navigationLinks?: { label: string; href: string }[];
}

const SITEMAP_FILE = 'SITEMAP.yaml';
const MAX_EXAMPLES = 5;

// ── Core ───────────────────────────────────────────────────────────────────

/** Load existing sitemap or create an empty one. */
export async function loadSitemap(userId: string, domain: string): Promise<Sitemap> {
	const content = await downloadDomainFile(userId, domain, SITEMAP_FILE);
	if (content) {
		try {
			return yaml.load(content) as Sitemap;
		} catch {
			// Corrupted YAML — start fresh
		}
	}
	return createEmptySitemap(domain);
}

function createEmptySitemap(domain: string): Sitemap {
	return {
		domain,
		version: 1,
		lastUpdated: new Date().toISOString(),
		stats: { totalNodes: 0, totalEdges: 0, totalVisits: 0, coverageScore: 0 },
		nodes: {},
		edges: [],
	};
}

/**
 * Merge a page index event into the sitemap. Returns whether changes were made.
 * Does NOT write to S3 — call saveSitemap() after if changed.
 */
export function mergePage(sitemap: Sitemap, pageIndex: PageIndexInput): boolean {
	const pathname = new URL(pageIndex.url).pathname;
	const pattern = pageIndex.urlPattern || normalizeUrlPattern(pathname);
	const now = new Date().toISOString();
	let changed = false;

	// ── Upsert node ──
	const existing = sitemap.nodes[pattern];
	if (existing) {
		existing.visits++;
		existing.lastVisited = now;
		existing.elements = pageIndex.elements?.length ?? existing.elements;

		// Update title if we got a better one (non-empty, not the URL)
		if (pageIndex.title && !existing.title) {
			existing.title = pageIndex.title;
			changed = true;
		}

		// Add new example URL (dedup, cap at MAX_EXAMPLES)
		if (!existing.examples.includes(pathname) && existing.examples.length < MAX_EXAMPLES) {
			existing.examples.push(pathname);
			changed = true;
		}

		// visits always increments so technically always changed,
		// but we only want to write when there's structural change
		changed = true;
	} else {
		// New node
		sitemap.nodes[pattern] = {
			title: pageIndex.title || pattern,
			type: pageIndex.pageType || 'other',
			description: '', // filled async by fast model
			elements: pageIndex.elements?.length ?? 0,
			visits: 1,
			lastVisited: now,
			examples: [pathname],
			discoveredAt: now,
		};
		changed = true;
	}

	// ── Upsert edges from navigation links ──
	if (pageIndex.navigationLinks?.length) {
		for (const link of pageIndex.navigationLinks) {
			if (!link.href || !link.label) continue;

			let targetPattern: string;
			try {
				const targetPath = link.href.startsWith('http') ? new URL(link.href).pathname : link.href;
				targetPattern = normalizeUrlPattern(targetPath);
			} catch {
				continue;
			}

			// Skip self-links
			if (targetPattern === pattern) continue;

			// Find existing edge
			const edgeIdx = sitemap.edges.findIndex((e) => e.from === pattern && e.to === targetPattern);

			if (edgeIdx >= 0) {
				// Update label if the new one is longer/better
				if (link.label.length > sitemap.edges[edgeIdx].label.length) {
					sitemap.edges[edgeIdx].label = link.label;
					changed = true;
				}
			} else {
				// New edge
				sitemap.edges.push({
					from: pattern,
					to: targetPattern,
					label: link.label.slice(0, 80),
					type: 'nav_link',
					traversals: 0,
				});
				changed = true;
			}
		}
	}

	// ── Recompute stats ──
	if (changed) {
		const nodes = Object.values(sitemap.nodes);
		sitemap.stats.totalNodes = nodes.length;
		sitemap.stats.totalEdges = sitemap.edges.length;
		sitemap.stats.totalVisits = nodes.reduce((sum, n) => sum + n.visits, 0);
		sitemap.stats.coverageScore =
			nodes.length > 0 ? nodes.filter((n) => n.description).length / nodes.length : 0;
		sitemap.lastUpdated = now;
	}

	return changed;
}

/** Increment traversal count when an agent actually navigates an edge. */
export function recordTraversal(sitemap: Sitemap, fromPattern: string, toPattern: string): void {
	const edge = sitemap.edges.find((e) => e.from === fromPattern && e.to === toPattern);
	if (edge) {
		edge.traversals++;
	}
}

/** Save sitemap to S3. */
export async function saveSitemap(userId: string, domain: string, sitemap: Sitemap): Promise<void> {
	const content = yaml.dump(sitemap, {
		lineWidth: 120,
		noRefs: true,
		sortKeys: false,
		quotingType: "'",
	});
	await uploadDomainFile(userId, domain, SITEMAP_FILE, content);
}

// ── Description generation ─────────────────────────────────────────────────

/**
 * Generate a description for a new node using the fast model. Fire-and-forget.
 * Updates the sitemap in-place and saves to S3 if successful.
 */
export async function generateNodeDescription(
	userId: string,
	domain: string,
	sitemap: Sitemap,
	pattern: string,
): Promise<void> {
	const node = sitemap.nodes[pattern];
	if (!node || node.description) return; // already has description

	try {
		const provider = getProvider();
		const model = getFastModel();

		const elementTypes = new Map<string, number>();
		// We don't have full element data here, just the count
		const prompt = `Given this web page:
- URL pattern: ${pattern}
- Page title: "${node.title}"
- Page type: ${node.type}
- Interactive elements: ${node.elements}

Write a single concise sentence (under 100 chars) describing this page's purpose and key capabilities. No quotes, no prefix.`;

		const stream = provider.chat({
			model,
			system:
				'You describe web pages in one short sentence. Be specific about what actions are available.',
			messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
		});

		const response = await collectStream(stream);
		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b) => (b as { type: 'text'; text: string }).text)
			.join('')
			.trim();

		if (text && text.length > 5) {
			node.description = text.slice(0, 150);
			// Recompute coverage
			const nodes = Object.values(sitemap.nodes);
			sitemap.stats.coverageScore =
				nodes.length > 0 ? nodes.filter((n) => n.description).length / nodes.length : 0;
			await saveSitemap(userId, domain, sitemap);
		}
	} catch (err) {
		// Fire-and-forget — don't fail the page index
		console.error(`[sitemap] Failed to generate description for ${pattern}:`, err);
	}
}

// ── Tree view for agent prompt ─────────────────────────────────────────────

/**
 * Render the sitemap as a tree-formatted string for injection into the agent prompt.
 * Capped at maxLines to stay within token budget.
 */
export function renderSitemapTree(sitemap: Sitemap, maxLines = 80): string {
	if (sitemap.stats.totalNodes === 0) return '';

	const lines: string[] = [];
	lines.push(`## Site Navigation Graph (${sitemap.domain})`);
	lines.push(
		`${sitemap.stats.totalNodes} pages mapped, ${sitemap.stats.totalEdges} navigation paths, ${sitemap.stats.totalVisits} total visits`,
	);
	lines.push('');

	// Sort nodes: most visited first, then alphabetically
	const sortedPatterns = Object.entries(sitemap.nodes)
		.sort((a, b) => b[1].visits - a[1].visits || a[0].localeCompare(b[0]))
		.map(([pattern]) => pattern);

	// Build adjacency list for outgoing edges
	const outgoing = new Map<string, SitemapEdge[]>();
	for (const edge of sitemap.edges) {
		if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
		outgoing.get(edge.from)!.push(edge);
	}

	for (const pattern of sortedPatterns) {
		if (lines.length >= maxLines) break;

		const node = sitemap.nodes[pattern];
		const desc = node.description ? ` — ${node.description}` : '';
		lines.push(`${pattern}${desc} (${node.type}, ${node.elements} elements)`);

		// Show outgoing edges
		const edges = outgoing.get(pattern) || [];
		const sortedEdges = edges.sort((a, b) => b.traversals - a.traversals);
		for (const edge of sortedEdges) {
			if (lines.length >= maxLines) break;
			const traversalInfo = edge.traversals > 0 ? ` (${edge.traversals} traversals)` : '';
			lines.push(`  → ${edge.to} — "${edge.label}" ${edge.type}${traversalInfo}`);
		}
	}

	if (sortedPatterns.length > lines.length - 3) {
		lines.push(
			`\n... and ${sortedPatterns.length - (lines.length - 3)} more pages. Use read_knowledge to see the full SITEMAP.yaml.`,
		);
	}

	return lines.join('\n');
}

// ── Public helper for updating sitemap from page index event ───────────────

/**
 * Main entry point: merge a page index into the sitemap and save.
 * Generates descriptions for new nodes in the background.
 */
export async function updateSitemap(
	userId: string,
	domain: string,
	pageIndex: PageIndexInput,
): Promise<void> {
	const sitemap = await loadSitemap(userId, domain);
	const pattern = pageIndex.urlPattern || normalizeUrlPattern(new URL(pageIndex.url).pathname);
	const isNewNode = !sitemap.nodes[pattern];

	const changed = mergePage(sitemap, pageIndex);

	if (changed) {
		await saveSitemap(userId, domain, sitemap);
	}

	// Generate description for new nodes (fire-and-forget)
	if (isNewNode) {
		generateNodeDescription(userId, domain, sitemap, pattern).catch(() => {});
	}
}
