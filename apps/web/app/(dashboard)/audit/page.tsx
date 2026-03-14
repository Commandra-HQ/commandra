'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { Shield } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AuditLog {
	id: string;
	action: string;
	safetyLevel: 'safe' | 'review' | 'blocked';
	approved: boolean;
	metadata: Record<string, unknown>;
	createdAt: string;
}

const SAFETY_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
	safe: 'success',
	review: 'warning',
	blocked: 'destructive',
};

export default function AuditPage() {
	const [logs, setLogs] = useState<AuditLog[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState<string>('all');

	useEffect(() => {
		fetchLogs();
	}, []);

	async function fetchLogs() {
		try {
			const res = await apiFetch('/api/audit');
			if (res.ok) {
				const data = await res.json();
				setLogs(data.logs || []);
			}
		} catch (err) {
			console.error('Failed to fetch audit logs:', err);
		} finally {
			setLoading(false);
		}
	}

	const filtered = filter === 'all' ? logs : logs.filter((l) => l.safetyLevel === filter);

	if (loading) {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
				<p className="text-muted-foreground mt-1">Every action the agent has taken.</p>
			</div>

			{/* Filters */}
			<div className="flex gap-2">
				{['all', 'safe', 'review', 'blocked'].map((f) => (
					<button
						key={f}
						onClick={() => setFilter(f)}
						className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
							filter === f
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-border hover:bg-muted'
						}`}
					>
						{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
					</button>
				))}
			</div>

			{filtered.length === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Shield size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground">No audit logs yet.</p>
					</CardContent>
				</Card>
			) : (
				<Card>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b">
									<th className="text-left p-3 font-medium text-muted-foreground">Time</th>
									<th className="text-left p-3 font-medium text-muted-foreground">Action</th>
									<th className="text-left p-3 font-medium text-muted-foreground">Safety</th>
									<th className="text-left p-3 font-medium text-muted-foreground">Approved</th>
									<th className="text-left p-3 font-medium text-muted-foreground">Details</th>
								</tr>
							</thead>
							<tbody>
								{filtered.map((log) => (
									<tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
										<td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
											{new Date(log.createdAt).toLocaleString()}
										</td>
										<td className="p-3 font-mono text-xs">{log.action}</td>
										<td className="p-3">
											<Badge variant={SAFETY_VARIANT[log.safetyLevel] || 'secondary'}>
												{log.safetyLevel}
											</Badge>
										</td>
										<td className="p-3 text-xs">
											{log.approved ? (
												<span className="text-green-600">Yes</span>
											) : (
												<span className="text-red-600">No</span>
											)}
										</td>
										<td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
											{log.metadata?.args ? JSON.stringify(log.metadata.args) : '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
			)}
		</div>
	);
}
