import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class combiner: conditional classes, last-wins on conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
