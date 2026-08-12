import { cn } from '../../lib/utils.js';

export function Skeleton({ className, ...props }) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}
