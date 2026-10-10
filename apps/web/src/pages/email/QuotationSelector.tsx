import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useQuotations } from '@/features/quotations/quotations.api';

const QUOTATION_PAGE_SIZE = '20';

/**
 * Searchable quotation dropdown shared by the Hotel and Itinerary email
 * workflows.
 *
 * - Opens on focus and immediately offers the first page of quotations the
 *   user may access — typing is for filtering, never a prerequisite.
 * - Typing filters through the existing debounced quotation search API.
 * - The list renders inline directly below the input (in normal document
 *   flow, inside containers without clipping), so it can never hide behind
 *   other content. There is no blur handler, so choosing a result cannot
 *   race with the dropdown closing; it closes on selection, Escape, or an
 *   outside pointer press.
 * - Uses the authenticated, company-scoped quotation list: only records the
 *   API returns are ever offered.
 */
export function QuotationSelector({
  selectedId,
  selectedLabel,
  onPick,
}: {
  /** Currently selected quotation id, or null when nothing is selected. */
  selectedId: string | null;
  /** Display label for the selection (from the loaded quotation record). */
  selectedLabel: string | null;
  /** Select a quotation, or null to clear the selection. */
  onPick: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const listParams = useMemo(() => {
    const params = new URLSearchParams({ pageSize: QUOTATION_PAGE_SIZE });
    if (debouncedSearch) params.set('search', debouncedSearch);
    return params;
  }, [debouncedSearch]);
  const quotationList = useQuotations(listParams);
  const results = quotationList.data?.data ?? [];
  const filtering = debouncedSearch !== '';
  const settled = quotationList.isSuccess && !quotationList.isFetching;

  // Close on an outside pointer press or Escape. Deliberately not on blur:
  // a blur handler would close the list before a result click lands.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  if (selectedId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
        <span className="min-w-0 truncate font-medium">{selectedLabel ?? 'Selected quotation'}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onPick(null)}>
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef}>
      <input
        aria-label="Search quotations"
        aria-expanded={open}
        aria-controls="quotation-results"
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground"
        placeholder="Search quotation number, customer, destination…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div id="quotation-results">
          {quotationList.isFetching && (
            <p className="mt-1 text-xs text-muted-foreground">Loading quotations…</p>
          )}
          {quotationList.isError && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              Quotation search failed.{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => void quotationList.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {settled && results.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {filtering
                ? `No quotations found for “${debouncedSearch}”.`
                : 'No quotations available.'}
            </p>
          )}
          {results.length > 0 && (
            <>
              {!filtering && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing recent quotations — type to filter.
                </p>
              )}
              <ul
                aria-label="Quotation results"
                className="mt-2 max-h-48 divide-y overflow-y-auto rounded-lg border border-border bg-card"
              >
                {results.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        onPick(row.id);
                        setSearch('');
                        setDebouncedSearch('');
                        setOpen(false);
                      }}
                    >
                      <span className="font-medium">{row.quotationNumber}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {row.customerName} · {row.destinationSummary}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!filtering && !quotationList.isFetching && (
            <p className="mt-1 text-xs text-muted-foreground">
              Search by quotation number, customer, or destination.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
