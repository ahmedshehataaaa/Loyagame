import { useState } from 'react';
import { TriangleAlert, Flag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx';
import { Badge } from './ui/badge.jsx';
import { Pager } from './pager.jsx';
import { TableSkeleton } from './players.jsx';
import { Empty, EMPTY_COPY } from './empty.jsx';
import { useFraud } from '../lib/api.js';
import { maskPhone, num, stamp } from '../lib/format.js';

/* resolve_run() sets runs.suspicious for three distinct reasons but records a
   single marker in client_meta, so the specific trip is not recoverable per
   row. These are the checks it applies, shown so an operator reading the tab
   knows what "suspicious" actually means. */
const REASON_COPY = {
  resolve_flag: 'Failed a resolve check (impossible score, too-fast round, or a stale token)',
  unknown: 'Flagged before a reason was recorded',
};

export function Fraud() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError } = useFraud({ page });

  const rows = data?.rows ?? [];
  const pageSize = data?.pageSize ?? 25;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flagged rounds</CardTitle>
        <CardDescription>
          Runs the server marked suspicious at resolve time. Score alone never issues a prize
          &mdash; a flagged run is blocked from the wheel draw regardless.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {isError ? (
          <Empty
            icon="⚠️"
            title="Could not load flagged rounds"
            hint="The admin API returned an error. Check the deployment logs."
          />
        ) : isPending ? (
          <TableSkeleton cols={5} />
        ) : rows.length === 0 ? (
          <Empty {...EMPTY_COPY.fraud} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Player</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {stamp(r.at)}
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    {maskPhone(r.phone)}
                  </TableCell>
                  <TableCell className="text-right">{num(r.score)}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <span className="inline-flex items-start gap-1.5">
                      <TriangleAlert
                        className="text-status-serious mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {REASON_COPY[r.reason] ?? r.reason}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* Not a per-run review status — no such column exists.
                        This is whether the PLAYER carries review flags. */}
                    {r.playerFlagged ? (
                      <Badge variant="warning">
                        <Flag aria-hidden="true" />
                        Under review
                      </Badge>
                    ) : (
                      <span className="text-subtle-foreground text-xs">Not reviewed</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager
          page={page}
          pageSize={pageSize}
          hasMore={data?.hasMore}
          onPage={setPage}
          disabled={isPending}
        />
      </CardContent>
    </Card>
  );
}
