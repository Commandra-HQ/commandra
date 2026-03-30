import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
	offset: number;
	limit: number;
	total: number;
	onPageChange: (offset: number) => void;
}

export function Pagination({ offset, limit, total, onPageChange }: PaginationProps) {
	if (total <= limit) return null;

	const currentPage = Math.floor(offset / limit) + 1;
	const totalPages = Math.ceil(total / limit);

	return (
		<div className="flex items-center justify-between pt-3">
			<span className="text-xs font-mono text-muted-foreground">
				{offset + 1}–{Math.min(offset + limit, total)} of {total}
			</span>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(Math.max(0, offset - limit))}
					disabled={offset === 0}
					className="h-7 w-7 p-0"
				>
					<ChevronLeft size={14} />
				</Button>
				<span className="text-xs font-mono text-muted-foreground px-2">
					{currentPage}/{totalPages}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(offset + limit)}
					disabled={offset + limit >= total}
					className="h-7 w-7 p-0"
				>
					<ChevronRight size={14} />
				</Button>
			</div>
		</div>
	);
}
