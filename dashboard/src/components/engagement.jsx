import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card.jsx';
import { Skeleton } from './ui/skeleton.jsx';
import { Empty, EMPTY_COPY } from './empty.jsx';
import { num, day, hourLabel } from '../lib/format.js';
import { fillDays, fillHours } from '../lib/series.js';

const AXIS = {
  stroke: 'var(--viz-axis)',
  tick: { fill: 'var(--muted-foreground)', fontSize: 11 },
  tickLine: false,
};

function ChartTooltip({ active, payload, label, formatLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border-border rounded-md border px-2.5 py-1.5 text-xs shadow-md">
      <div className="text-muted-foreground mb-0.5">{formatLabel(label)}</div>
      <div className="tabular font-semibold">
        {num(payload[0].value)} {payload[0].value === 1 ? 'play' : 'plays'}
      </div>
    </div>
  );
}

export function Engagement({ data, loading }) {
  const days = data?.days ?? 30;
  const perDay = fillDays(data?.stats?.playsPerDay, days);
  const hours = fillHours(data?.stats?.peakHours);
  const anyPlays = perDay.some((d) => d.n > 0);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Plays per day</CardTitle>
          <CardDescription>Rounds started, last {days} days (Cairo time).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : !anyPlays ? (
            <Empty {...EMPTY_COPY.engagement} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={perDay} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis
                  dataKey="day"
                  {...AXIS}
                  tickFormatter={day}
                  minTickGap={28}
                  axisLine={{ stroke: 'var(--viz-axis)' }}
                />
                <YAxis {...AXIS} axisLine={false} allowDecimals={false} width={44} />
                <Tooltip
                  cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
                  content={<ChartTooltip formatLabel={day} />}
                />
                <Line
                  type="monotone"
                  dataKey="n"
                  stroke="var(--viz-series-1)"
                  strokeWidth={2}
                  dot={false}
                  /* r=4 → an 8px marker, the minimum readable hit target. */
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Peak hours</CardTitle>
          <CardDescription>
            When rounds are played, by hour of day (Cairo time), last {days} days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : !anyPlays ? (
            <Empty
              icon="🕐"
              title="No peak yet"
              hint="Hour-of-day fills in once rounds start landing — lunch and late evening are the ones to watch."
            />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hours} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis
                  dataKey="hour"
                  {...AXIS}
                  tickFormatter={hourLabel}
                  interval={2}
                  axisLine={{ stroke: 'var(--viz-axis)' }}
                />
                <YAxis {...AXIS} axisLine={false} allowDecimals={false} width={44} />
                <Tooltip
                  cursor={{ fill: 'var(--muted)' }}
                  content={<ChartTooltip formatLabel={hourLabel} />}
                />
                {/* 4px rounded data-end, anchored square to the baseline. */}
                <Bar dataKey="n" fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
