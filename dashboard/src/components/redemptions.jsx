import { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.jsx';
import { Badge } from './ui/badge.jsx';
import { Pager } from './pager.jsx';
import { TableSkeleton } from './players.jsx';
import { Empty, EMPTY_COPY } from './empty.jsx';
import { useRedemptions } from '../lib/api.js';
import { maskPhone, maskCode, num, pct, stamp } from '../lib/format.js';

export function Redemptions() {
  const [page, setPage] = useState(1);
  const { data, isPending, isError } = useRedemptions({ page });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Redemptions</CardTitle>
        <CardDescription>
          {isPending
            ? 'Loading…'
            : `${num(data?.redeemed ?? 0)} of ${num(total)} coupons redeemed · ${pct(data?.rate)} rate. Newest first.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {isError ? (
          <Empty
            icon="⚠️"
            title="Could not load redemptions"
            hint="The admin API returned an error. Check the deployment logs."
          />
        ) : isPending ? (
          <TableSkeleton cols={6} />
        ) : rows.length === 0 ? (
          <Empty {...EMPTY_COPY.redemptions} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Prize</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Redeemed by</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {/* `codeTail` is the last 4 characters, truncated in the
                        RPC — the full bearer token never leaves Postgres. Only
                        present where the 2026-08-12 section of schema.sql has
                        been applied; otherwise it renders as an em dash. */}
                    {maskCode(r.codeTail)}
                  </TableCell>
                  <TableCell className="font-medium">{r.prize}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {maskPhone(r.phone)}
                  </TableCell>
                  <TableCell>
                    {r.redeemed ? (
                      <Badge variant="good">
                        <Check aria-hidden="true" />
                        Redeemed
                      </Badge>
                    ) : (
                      <Badge variant="neutral">
                        <Clock aria-hidden="true" />
                        Outstanding
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {r.redeemedBy || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {stamp(r.redeemedAt || r.wonAt)}
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
