'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { type AuditLog, useAuditLogsQuery } from '@/lib/queries/use-audit';
import type { ColumnDef } from '@tanstack/react-table';
import { Shield } from 'lucide-react';
import { useState } from 'react';

const SAFETY_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
	safe: 'success',
	review: 'warning',
	blocked: 'destructive',
};

const columns: ColumnDef<AuditLog, unknown>[] = [
	{
		accessorKey: 'createdAt',
		header: 'Time',
		cell: ({ row }) => (
			<span className="text-xs text-muted-foreground whitespace-nowrap font-mono">
				{new Date(row.original.createdAt).toLocaleString()}
			</span>
		),
	},
	{
		accessorKey: 'action',
		header: 'Action',
		cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
	},
	{
		accessorKey: 'safetyLevel',
		header: 'Safety',
		cell: ({ row }) => (
			<Badge variant={SAFETY_VARIANT[row.original.safetyLevel] || 'secondary'}>
				{row.original.safetyLevel}
			</Badge>
		),
	},
	{
		accessorKey: 'approved',
		header: 'Approved',
		cell: ({ row }) =>
			row.original.approved ? (
				<span className="text-xs text-success font-mono">Yes</span>
			) : (
				<span className="text-xs text-error font-mono">No</span>
			),
	},
	{
		id: 'details',
		header: 'Details',
		cell: ({ row }) => (
			<span className="text-xs text-muted-foreground max-w-[200px] truncate block font-mono">
				{row.original.metadata?.args
					? JSON.stringify(row.original.metadata.args)
					: '—'}
			</span>
		),
	},
];

export default function AuditPage() {
	const [filter, setFilter] = useState<string>('all');
	const [offset, setOffset] = useState(0);
	const limit = 50;

	const { data, isLoading } = useAuditLogsQuery({
		limit,
		offset,
		safetyLevel: filter === 'all' ? undefined : filter,
	});

	const logs = data?.logs ?? [];
	const total = data?.total ?? 0;

	// Reset offset when filter changes
	function handleFilterChange(f: string) {
		setFilter(f);
		setOffset(0);
	}

	if (isLoading && offset === 0) {
		return (
			<div className="flex items-center gap-2 py-8">
				<div className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col flex-1 min-h-0">
			{/* Filters — sticky top */}
			<div className="flex gap-1 flex-shrink-0 pb-3">
				{['all', 'safe', 'review', 'blocked'].map((f) => (
					<button
						key={f}
						onClick={() => handleFilterChange(f)}
						className={`px-3 py-1.5 text-xs font-mono font-medium border transition-colors ${
							filter === f
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-background text-foreground border-border hover:bg-muted'
						}`}
					>
						{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
					</button>
				))}
			</div>

			{logs.length === 0 && offset === 0 ? (
				<Card>
					<CardContent className="py-12 text-center">
						<Shield size={32} className="mx-auto text-muted-foreground mb-3" />
						<p className="text-sm text-muted-foreground font-mono">No audit logs yet.</p>
					</CardContent>
				</Card>
			) : (
				<DataTable
					columns={columns}
					data={logs}
					total={total}
					offset={offset}
					limit={limit}
					onPageChange={setOffset}
					emptyMessage="No audit logs found."
					fillHeight
				/>
			)}
		</div>
	);
}
