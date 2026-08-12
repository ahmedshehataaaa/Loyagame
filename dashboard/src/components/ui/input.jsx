import { cn } from '../../lib/utils.js';

export function Input({ className, type = 'text', ...props }) {
  return (
    <input
      type={type}
      className={cn(
        'border-input bg-card flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors',
        'placeholder:text-subtle-foreground',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
