'use client';

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from '@tanstack/react-table';
import { Pagination } from './pagination';

interface DataTableProps<TData> {
	columns: ColumnDef<TData, unknown>[];
	data: TData[];
	total?: number;
	offset?: number;
	limit?: number;
	onPageChange?: (offset: number) => void;
	emptyMessage?: string;
}

export function DataTable<TData>({
	columns,
	data,
	total,
	offset = 0,
	limit = 25,
	onPageChange,
	emptyMessage = 'No data.',
}: DataTableProps<TData>) {
	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		rowCount: total,
	});

	return (
		<div>
			<div className="border border-border">
				<table className="w-full">
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} className="border-b border-border bg-surface">
								{headerGroup.headers.map((header) => (
									<th
										key={header.id}
										className="px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-medium"
									>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</th>
								))}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.length === 0 ? (
							<tr>
								<td
									colSpan={columns.length}
									className="px-3 py-8 text-center text-sm font-mono text-muted-foreground"
								>
									{emptyMessage}
								</td>
							</tr>
						) : (
							table.getRowModel().rows.map((row) => (
								<tr key={row.id} className="border-b border-border last:border-0 hover:bg-elevated/50">
									{row.getVisibleCells().map((cell) => (
										<td key={cell.id} className="px-3 py-2 text-sm">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
			{total != null && onPageChange && (
				<Pagination offset={offset} limit={limit} total={total} onPageChange={onPageChange} />
			)}
		</div>
	);
}
