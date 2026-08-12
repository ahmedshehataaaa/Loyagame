import { useState } from 'react';
import { Search, Flag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx';
import { Input } from './ui/input.jsx';
import { Badge } from './ui/badge.jsx';
import { Skeleton } from './ui/skeleton.jsx';
import { Pager } from './pager.jsx';
import { Empty, EMPTY_COPY } from './empty.jsx';
import { usePlayers } from '../lib/api.js';
import { maskPhone, num, stamp } from '../lib/format.js';

export function Players() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const { data, isPending, isError } = usePlayers({ page, q });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Players</CardTitle>
            <CardDescription>
              {isPending ? 'Loading…' : `${num(total)} registered by phone number.`}
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search
              className="text-subtle-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <label htmlFor="player-search" className="sr-only">
              Search by phone number
            </label>
            <Input
              id="player-search"
              className="pl-8"
              placeholder="Search phone…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {isError ? (
          <Empty
            icon="⚠️"
            title="Could not load players"
            hint="The admin API returned an error. Check the deployment logs."
          />
        ) : isPending ? (
          <TableSkeleton cols={7} />
        ) : rows.length === 0 ? (
          <Empty
            {...(q
              ? {
                  icon: '🔎',
                  title: 'No player matches that number',
                  hint: 'Search matches anywhere in the phone number.',
                }
              : EMPTY_COPY.players)}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>First seen</TableHead>
                <TableHead className="text-right">Plays</TableHead>
                <TableHead className="text-right">High score</TableHead>
                <TableHead className="text-right">Coupons</TableHead>
                <TableHead>Last round</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.phone}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {maskPhone(r.phone)}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {stamp(r.firstSeen)}
                  </TableCell>
                  <TableCell className="text-right">{num(r.plays)}</TableCell>
                  <TableCell className="text-right">{num(r.highScore)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {num(r.redeemed)}
                    <span className="text-subtle-foreground"> / {num(r.wins)}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {stamp(r.lastSeen)}
                  </TableCell>
                  <TableCell>
                    {r.flagged ? (
                      <Badge variant="warning">
                        <Flag aria-hidden="true" />
                        Flagged
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          disabled={isPending}
        />
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ cols = 5, rows = 6 }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
