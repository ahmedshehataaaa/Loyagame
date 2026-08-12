import { cn } from '../../lib/utils.js';

export function Table({ className, ...props }) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }) {
  return (
    <tr className={cn('hover:bg-muted/60 border-b transition-colors', className)} {...props} />
  );
}

export function TableHead({ className, ...props }) {
  return (
    <th
      className={cn(
        'text-muted-foreground h-9 px-3 text-left align-middle text-xs font-semibold tracking-wide whitespace-nowrap uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
