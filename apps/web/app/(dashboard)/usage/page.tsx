'use client';

import { useUsageByAgent, useUsageSummary } from '@/lib/queries/use-usage';
import { Activity, DollarSign, Zap } from 'lucide-react';

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}

function formatCost(usd: string): string {
	const n = parseFloat(usd);
	if (n === 0) return '$0.00';
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

export default function UsagePage() {
	const { data: summary, isLoading: summaryLoading } = useUsageSummary();
	const { data: byAgent, isLoading: agentLoading } = useUsageByAgent();

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Usage</h1>
				<p className="text-muted-foreground text-sm">Token usage and cost tracking across all agents.</p>
			</div>

			{/* Summary cards */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<SummaryCard
					icon={<Activity className="h-4 w-4" />}
					label="Total Runs"
					value={summary?.totalRuns?.toString() ?? '—'}
					loading={summaryLoading}
				/>
				<SummaryCard
					icon={<Zap className="h-4 w-4" />}
					label="Input Tokens"
					value={summary ? formatTokens(summary.totalInputTokens) : '—'}
					sub={summary ? `${formatTokens(summary.totalCacheReadTokens)} cached` : undefined}
					loading={summaryLoading}
				/>
				<SummaryCard
					icon={<Zap className="h-4 w-4" />}
					label="Output Tokens"
					value={summary ? formatTokens(summary.totalOutputTokens) : '—'}
					sub={summary?.totalThinkingTokens ? `${formatTokens(summary.totalThinkingTokens)} thinking` : undefined}
					loading={summaryLoading}
				/>
				<SummaryCard
					icon={<DollarSign className="h-4 w-4" />}
					label="Estimated Cost"
					value={summary ? formatCost(summary.totalCostUsd) : '—'}
					loading={summaryLoading}
				/>
			</div>

			{/* Per-agent breakdown */}
			<div>
				<h2 className="mb-3 text-lg font-semibold">By Agent</h2>
				{agentLoading ? (
					<p className="text-muted-foreground text-sm">Loading...</p>
				) : !byAgent?.length ? (
					<p className="text-muted-foreground text-sm">No agent runs recorded yet. Usage data will appear after agents execute tasks.</p>
				) : (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b bg-muted/50">
									<th className="px-4 py-2 text-left font-medium">Agent</th>
									<th className="px-4 py-2 text-right font-medium">Runs</th>
									<th className="px-4 py-2 text-right font-medium">Input</th>
									<th className="px-4 py-2 text-right font-medium">Output</th>
									<th className="px-4 py-2 text-right font-medium">Total</th>
									<th className="px-4 py-2 text-right font-medium">Cost</th>
									<th className="px-4 py-2 text-right font-medium">Last Run</th>
								</tr>
							</thead>
							<tbody>
								{byAgent.map((a) => (
									<tr key={a.agentId} className="border-b last:border-0">
										<td className="px-4 py-2 font-medium">{a.agentName ?? a.agentId.slice(0, 8)}</td>
										<td className="px-4 py-2 text-right tabular-nums">{a.totalRuns}</td>
										<td className="px-4 py-2 text-right tabular-nums">{formatTokens(a.totalInputTokens)}</td>
										<td className="px-4 py-2 text-right tabular-nums">{formatTokens(a.totalOutputTokens)}</td>
										<td className="px-4 py-2 text-right tabular-nums">{formatTokens(a.totalTokensUsed)}</td>
										<td className="px-4 py-2 text-right tabular-nums">{formatCost(a.totalCostUsd)}</td>
										<td className="px-4 py-2 text-right text-muted-foreground">
											{a.lastRunAt ? new Date(a.lastRunAt).toLocaleDateString() : '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

function SummaryCard({
	icon,
	label,
	value,
	sub,
	loading,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	sub?: string;
	loading: boolean;
}) {
	return (
		<div className="rounded-lg border p-4">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				{icon}
				{label}
			</div>
			<div className="mt-1 text-2xl font-bold tabular-nums">
				{loading ? <span className="animate-pulse text-muted-foreground">...</span> : value}
			</div>
			{sub && <div className="text-xs text-muted-foreground">{sub}</div>}
		</div>
	);
}
