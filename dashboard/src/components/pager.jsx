import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button.jsx';
import { num } from '../lib/format.js';

/* `total` is optional: /api/admin-fraud reports has-more instead of a count
   (see the comment in that handler), so the pager falls back to a plain
   "page N" when it has no total to count against. */
export function Pager({ page, pageSize, total, hasMore, onPage, disabled }) {
  const known = Number.isFinite(total);
  const lastPage = known ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canNext = known ? page < lastPage : Boolean(hasMore);
  const canPrev = page > 1;

  if (!canPrev && !canNext) return null;

  return (
    <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
      <p className="text-subtle-foreground text-xs">
        {known ? (
          <>
            Page {num(page)} of {num(lastPage)} &middot; {num(total)} total
          </>
        ) : (
          <>Page {num(page)}</>
        )}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(page - 1)}
          disabled={disabled || !canPrev}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={disabled || !canNext}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
