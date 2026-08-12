import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils.js';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-9 w-full items-center justify-start gap-1 overflow-x-auto rounded-lg p-1 sm:w-auto',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'ring-offset-background focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:outline-none',
        'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }) {
  return (
    <TabsPrimitive.Content
      className={cn('ring-offset-background focus-visible:outline-none', className)}
      {...props}
    />
  );
}
