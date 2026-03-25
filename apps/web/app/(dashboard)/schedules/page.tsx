'use client';

import {
	useScheduledAgentsQuery,
	useRunAgentNowMutation,
	useUpdateAgentMutation,
	type ScheduledAgent,
} from '@/lib/queries/use-agents';
import { CheckCircle2, Clock, Loader2, Play, Power, PowerOff, XCircle } from 'lucide-react';
import { useState } from 'react';

function cronToHuman(cron: string): string {
	const [min, hour, dom, mon, dow] = cron.split(' ');
	const parts: string[] = [];

	if (dow !== '*') {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		parts.push(dow.split(',').map(d => days[parseInt(d)] || d).join(', '));
	} else if (dom !== '*') {
		parts.push(`day ${dom}`);
	} else {
		parts.push('daily');
	}

	if (hour !== '*' && min !== '*') {
		const h = parseInt(hour);
		const m = parseInt(min);
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		parts.push(`at ${h12}:${m.toString().padStart(2, '0')} ${ampm}`);
	} else if (hour !== '*') {
		parts.push(`every hour at :${min}`);
	} else if (min !== '*') {
		parts.push(`every ${min} min`);
	}

	return parts.join(' ') || cron;
}

function formatDuration(ms: number | null): string {
	if (!ms) return '-';
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

export default function SchedulesPage() {
	const { data, isLoading } = useScheduledAgentsQuery();
	const runNow = useRunAgentNowMutation();
	const updateAgent = useUpdateAgentMutation();
	const [runningId, setRunningId] = useState<string | null>(null);

	const agents = data?.data ?? [];

	async function handleToggle(agent: ScheduledAgent) {
		const newEnabled = agent.trigger?.enabled === false;
		await updateAgent.mutateAsync({
			id: agent.id,
			trigger: { ...agent.trigger, enabled: newEnabled },
		});
	}

	async function handleRunNow(agentId: string) {
		setRunningId(agentId);
		try {
			await runNow.mutateAsync(agentId);
		} finally {
			setTimeout(() => setRunningId(null), 2000);
		}
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold">Scheduled Jobs</h1>
				<p className="text-muted-foreground text-sm">Agents that run automatically on a schedule. Requires browser to be open.</p>
			</div>

			{isLoading ? (
				<p className="text-muted-foreground text-sm">Loading...</p>
			) : agents.length === 0 ? (
				<div className="border border-dashed border-border rounded-lg p-8 text-center">
					<Clock className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
					<p className="text-sm text-muted-foreground">No scheduled agents yet.</p>
					<p className="text-xs text-muted-foreground/60 mt-1">Create an agent with a cron schedule from the Agents page.</p>
				</div>
			) : (
				<div className="space-y-3">
					{agents.map((agent) => {
						const trigger = agent.trigger;
						const enabled = trigger?.enabled !== false;
						const run = agent.latestRun;
						const isRunning = runningId === agent.id;

						return (
							<div key={agent.id} className="border border-border rounded-lg p-4">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h3 className="font-medium text-sm truncate">{agent.name}</h3>
											<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
												enabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
											}`}>
												{enabled ? 'Active' : 'Paused'}
											</span>
										</div>
										{agent.description && (
											<p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.description}</p>
										)}
										<div className="flex items-center gap-3 mt-2">
											<code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">{trigger?.cron}</code>
											<span className="text-xs text-muted-foreground">{cronToHuman(trigger?.cron ?? '')}</span>
											{agent.domains?.length ? (
												<span className="text-[10px] text-muted-foreground/60">{agent.domains.join(', ')}</span>
											) : null}
										</div>
									</div>

									<div className="flex items-center gap-1.5 flex-shrink-0">
										<button
											onClick={() => handleRunNow(agent.id)}
											disabled={isRunning || !enabled}
											className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
											title="Run now"
										>
											{isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
											Run
										</button>
										<button
											onClick={() => handleToggle(agent)}
											className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border transition-colors ${
												enabled
													? 'border-border hover:bg-red-500/10 hover:text-red-600 hover:border-red-200'
													: 'border-border hover:bg-green-500/10 hover:text-green-600 hover:border-green-200'
											}`}
											title={enabled ? 'Pause schedule' : 'Enable schedule'}
										>
											{enabled ? <PowerOff size={12} /> : <Power size={12} />}
											{enabled ? 'Pause' : 'Enable'}
										</button>
									</div>
								</div>

								{/* Latest run */}
								{run && (
									<div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs text-muted-foreground">
										<div className="flex items-center gap-1">
											{run.status === 'completed' ? (
												<CheckCircle2 size={12} className="text-green-500" />
											) : run.status === 'failed' ? (
												<XCircle size={12} className="text-red-500" />
											) : (
												<Loader2 size={12} className="animate-spin" />
											)}
											<span className={run.status === 'failed' ? 'text-red-500' : ''}>{run.status}</span>
										</div>
										<span>{formatTimeAgo(run.createdAt)}</span>
										<span>{formatDuration(run.durationMs)}</span>
										{run.toolCalls > 0 && <span>{run.toolCalls} tools</span>}
										{run.error && (
											<span className="text-red-500 truncate max-w-[200px]" title={run.error}>{run.error}</span>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
