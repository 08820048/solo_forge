import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive';

export function Badge({ className, variant = 'default', ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const variants: Record<BadgeVariant, string> = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-muted text-foreground',
    success: 'bg-emerald-600 text-white dark:bg-emerald-500',
    warning: 'bg-amber-500 text-black',
    destructive: 'bg-destructive text-destructive-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-border',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

