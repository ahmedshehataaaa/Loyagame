import { cn } from '../../lib/utils.js';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        'bg-card text-card-foreground rounded-lg border shadow-xs',
        'border-border',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-sm leading-none font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-muted-foreground text-xs', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
