import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

/* Status variants borrow the RESERVED status palette, and every one of them is
   rendered with a text label (and, at the call site, an icon). A status colour
   never carries meaning on its own here — on the light surface `warning` and
   `serious` sit below 3:1 by design, and the label is the mitigation. */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'border-border text-muted-foreground bg-muted',
        good: 'border-transparent bg-status-good/12 text-status-good-text',
        warning: 'border-transparent bg-status-warning/18 text-foreground',
        serious: 'border-transparent bg-status-serious/18 text-foreground',
        critical: 'border-transparent bg-status-critical/14 text-status-critical',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
