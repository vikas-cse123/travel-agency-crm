import { FilePlus2, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { useHotelVouchers } from '@/features/hotel-vouchers/hotel-vouchers.api';

export function HotelVouchersPage() {
  const [params, setParams] = useSearchParams();
  const list = useHotelVouchers(params);
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_UPDATE);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  /** Page changes keep the active filters, so they bypass `update`'s reset. */
  const setPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hotel Vouchers"
        description="Standalone service-confirmation vouchers for hotel stays."
        actions={
          canCreate ? (
            <Link to="/hotel-vouchers/new">
              <Button>
                <FilePlus2 className="h-4 w-4" /> New voucher
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            aria-label="Search hotel vouchers"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm"
            placeholder="Voucher number, guest or hotel…"
            value={params.get('search') ?? ''}
            onChange={(event) => update('search', event.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {list.isError ? (
          <p className="p-6 text-sm text-destructive">Could not load hotel vouchers.</p>
        ) : !list.data ? (
          <p className="p-6 text-sm text-muted-foreground">Loading hotel vouchers…</p>
        ) : list.data.data.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No hotel vouchers yet. Create one from a hotel stay.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.data.map((voucher) => (
              <li key={voucher.id}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-muted">
                  <Link
                    to={`/hotel-vouchers/${voucher.id}`}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1"
                  >
                    <span className="font-mono text-sm font-semibold">{voucher.voucherNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {voucher.guestName} · {voucher.hotelName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {voucher.checkIn} → {voucher.checkOut}
                    </span>
                  </Link>
                  {canUpdate && (
                    <Link
                      to={`/hotel-vouchers/${voucher.id}/edit`}
                      className="shrink-0 text-sm font-medium text-brand-600 hover:underline"
                    >
                      Edit
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {list.data && list.data.pagination.totalPages > 1 && (
        <Pagination
          page={list.data.pagination.page}
          pageSize={list.data.pagination.pageSize}
          total={list.data.pagination.total}
          totalPages={list.data.pagination.totalPages}
          onPage={setPage}
        />
      )}
    </div>
  );
}
