import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			className={cn(
				'flex h-9 w-full border border-border bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 appearance-none bg-[url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEgMS41TDYgNi41TDExIDEuNSIgc3Ryb2tlPSIjODg4IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+")] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8',
				className,
			)}
			{...props}
		>
			{children}
		</select>
	);
}

export { Select };
