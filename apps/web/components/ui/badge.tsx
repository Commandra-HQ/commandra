import { cn } from '@/lib/utils';
import { type VariantProps, cva } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

const badgeVariants = cva(
	'inline-flex items-center border px-2.5 py-0.5 text-xs font-medium font-mono uppercase tracking-wider transition-colors focus:outline-none focus:ring-1 focus:ring-ring',
	{
		variants: {
			variant: {
				default: 'border-border bg-secondary text-foreground',
				secondary: 'border-border bg-secondary text-secondary-foreground',
				destructive: 'border-destructive/20 bg-destructive/5 text-destructive',
				outline: 'border-border text-foreground',
				success: 'border-success/20 bg-success/5 text-success',
				warning: 'border-warning/20 bg-warning/5 text-warning',
			},
		},
		defaultVariants: { variant: 'default' },
	},
);

interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
