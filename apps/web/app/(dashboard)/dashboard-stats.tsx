'use client';

import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Bot, Globe, History, Shield, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DailyPoint {
	date: string;
	count: number;
}

interface RecentConversation {
	id: string;
	title: string | null;
	outcome: string | null;
	createdAt: string;
}

interface Stats {
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

function fillDays(data: DailyPoint[], days: number): { label: string; value: number }[] {
	const map = new Map(data.map((d) => [d.date, d.count]));
	const result: { label: string; value: number }[] = [];
	const now = new Date();
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		result.push({ label, value: map.get(key) ?? 0 });
	}
	return result;
}

function BarChart({
	data,
	height = 120,
}: {
	data: { label: string; value: number }[];
	height?: number;
}) {
	const max = Math.max(...data.map((d) => d.value), 1);
	const barWidth = 100 / data.length;

	return (
		<div className="w-full">
			<svg
				viewBox={`0 0 ${data.length * 40} ${height + 20}`}
				className="w-full"
				preserveAspectRatio="none"
			>
				{data.map((d, i) => {
					const barH = (d.value / max) * height;
					return (
						<g key={i}>
							<rect
								x={i * 40 + 4}
								y={height - barH}
								width={32}
								height={Math.max(barH, 1)}
								className="fill-foreground/20"
							/>
							{d.value > 0 && (
								<text
									x={i * 40 + 20}
									y={height - barH - 4}
									textAnchor="middle"
									className="fill-muted-foreground"
									fontSize="9"
									fontFamily="monospace"
								>
									{d.value}
								</text>
							)}
						</g>
					);
				})}
			</svg>
			<div className="flex justify-between px-1 mt-1">
				{data
					.filter((_, i) => i % 2 === 0 || data.length <= 7)
					.map((d, i) => (
						<span key={i} className="text-[10px] font-mono text-muted-foreground">
							{d.label}
						</span>
					))}
			</div>
		</div>
	);
}

function HorizontalBar({
	items,
}: {
	items: { label: string; value: number; className?: string }[];
}) {
	const total = items.reduce((s, i) => s + i.value, 0) || 1;

	return (
		<div className="space-y-2">
			{items.map((item) => (
				<div key={item.label} className="space-y-1">
					<div className="flex justify-between text-xs font-mono">
						<span className="text-muted-foreground">{item.label}</span>
						<span className="text-foreground">{item.value}</span>
					</div>
					<div className="h-1.5 bg-muted w-full">
						<div
							className={item.className || 'bg-muted-foreground'}
							style={{ width: `${(item.value / total) * 100}%`, height: '100%' }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

function timeAgo(dateStr: string) {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	return `${days}d ago`;
}

const outcomeIndicator: Record<string, string> = {
	success: 'bg-success',
	failure: 'bg-error',
	partial: 'bg-warning',
};

export function DashboardStats() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetchStats();
	}, []);

	async function fetchStats() {
		try {
			const res = await apiFetch('/api/stats');
			if (res.ok) {
				setStats(await res.json());
			}
		} catch {
			// Stats unavailable
		} finally {
			setLoading(false);
		}
	}

	const counters = [
		{ label: 'Conversations', value: stats?.conversations ?? 0, icon: History },
		{ label: 'Agent Actions', value: stats?.actions ?? 0, icon: Zap },
		{ label: 'Agents', value: stats?.agents ?? 0, icon: Bot },
		{ label: 'Sites Indexed', value: stats?.sites ?? 0, icon: Globe },
	];

	const dailyConvs = fillDays(stats?.dailyConversations ?? [], 14);
	const dailyActs = fillDays(stats?.dailyActions ?? [], 14);

	const runStats = (stats?.agentRunStats ?? []).map((r) => ({
		label: r.status,
		value: r.count,
		className:
			r.status === 'completed'
				? 'bg-success'
				: r.status === 'failed'
					? 'bg-error'
					: 'bg-warning',
	}));

	const safetyStats = (stats?.actionBreakdown ?? []).map((a) => ({
		label: a.safetyLevel,
		value: a.count,
		className:
			a.safetyLevel === 'safe'
				? 'bg-success'
				: a.safetyLevel === 'review'
					? 'bg-warning'
					: 'bg-error',
	}));

	const outcomeStats = (stats?.outcomeBreakdown ?? []).map((o) => ({
		label: o.outcome ?? 'unknown',
		value: o.count,
		className: outcomeIndicator[o.outcome] || 'bg-foreground/20',
	}));

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="grid gap-1 sm:grid-cols-4">
					{[1, 2, 3, 4].map((i) => (
						<Card key={i}>
							<CardContent className="p-5">
								<div className="h-12 animate-pulse bg-muted" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Counter cards */}
			<div className="grid gap-1 sm:grid-cols-4">
				{counters.map((item) => (
					<Card key={item.label}>
						<CardContent className="p-5">
							<div className="flex items-center justify-between mb-3">
								<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
									{item.label}
								</span>
								<item.icon size={14} strokeWidth={1.5} className="text-dim" />
							</div>
							<div className="text-2xl font-mono font-medium text-foreground">
								{item.value.toLocaleString()}
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			{/* Activity charts */}
			<div className="grid gap-1 md:grid-cols-2">
				<Card>
					<CardContent className="p-5">
						<div className="flex items-center justify-between mb-4">
							<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
								Conversations — Last 14 days
							</span>
						</div>
						<BarChart data={dailyConvs} />
					</CardContent>
				</Card>
				<Card>
					<CardContent className="p-5">
						<div className="flex items-center justify-between mb-4">
							<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
								Actions — Last 14 days
							</span>
						</div>
						<BarChart data={dailyActs} />
					</CardContent>
				</Card>
			</div>

			{/* Bottom row: recent conversations + breakdowns */}
			<div className="grid gap-1 md:grid-cols-3">
				{/* Recent conversations */}
				<Card className="md:col-span-2">
					<CardContent className="p-5">
						<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-4">
							Recent Conversations
						</span>
						{(stats?.recentConversations ?? []).length === 0 ? (
							<p className="text-sm text-muted-foreground font-mono">
								No conversations yet.
							</p>
						) : (
							<div className="space-y-0">
								{stats?.recentConversations.map((conv) => (
									<div
										key={conv.id}
										className="flex items-center justify-between py-2 border-b border-border last:border-0"
									>
										<div className="flex items-center gap-3 min-w-0">
											{conv.outcome && (
												<div
													className={`status-pixel ${outcomeIndicator[conv.outcome] || 'bg-foreground/20'}`}
												/>
											)}
											<span className="text-sm font-mono truncate">
												{conv.title || 'Untitled'}
											</span>
										</div>
										<span className="text-xs font-mono text-muted-foreground whitespace-nowrap ml-4">
											{timeAgo(conv.createdAt)}
										</span>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>

				{/* Breakdowns */}
				<div className="space-y-1">
					{outcomeStats.length > 0 && (
						<Card>
							<CardContent className="p-5">
								<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-4">
									Outcomes
								</span>
								<HorizontalBar items={outcomeStats} />
							</CardContent>
						</Card>
					)}
					{safetyStats.length > 0 && (
						<Card>
							<CardContent className="p-5">
								<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-4">
									Safety Classification
								</span>
								<HorizontalBar items={safetyStats} />
							</CardContent>
						</Card>
					)}
					{runStats.length > 0 && (
						<Card>
							<CardContent className="p-5">
								<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground block mb-4">
									Agent Runs
								</span>
								<HorizontalBar items={runStats} />
							</CardContent>
						</Card>
					)}
				</div>
			</div>
		</div>
	);
}
