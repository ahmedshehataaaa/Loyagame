import { Skeleton } from './ui/skeleton.jsx';
import { cn } from '../lib/utils.js';

/* A headline number is a STAT TILE, not a one-bar chart. Values keep
   proportional figures (they stand alone); only table columns and axis ticks
   get tabular-nums. */
export function StatTile({ label, value, hint, loading, hero = false, className }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.07em] uppercase">
        {label}
      </div>
      {loading ? (
        <Skeleton className={cn('w-24', hero ? 'h-11' : 'h-8')} />
      ) : (
        <div
          className={cn(
            'leading-none font-bold tracking-tight',
            hero ? 'text-[44px]' : 'text-[30px]',
          )}
        >
          {value}
        </div>
      )}
      {hint ? <div className="text-subtle-foreground text-xs">{hint}</div> : null}
    </div>
  );
}

/** A single ratio against its limit reads as a meter, not a two-slice pie. */
export function Meter({ label, value, total, hint, tone = 'series' }) {
  const safeTotal = Number(total) || 0;
  const pctFilled = safeTotal > 0 ? Math.min(100, (Number(value) / safeTotal) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        <span className="tabular text-sm font-semibold">
          {Number(value) || 0}
          <span className="text-subtle-foreground font-normal"> / {safeTotal}</span>
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'good' ? 'bg-status-good' : 'bg-viz-series-1',
          )}
          style={{ width: `${pctFilled}%` }}
        />
      </div>
      {hint ? <div className="text-subtle-foreground text-xs">{hint}</div> : null}
    </div>
  );
}
