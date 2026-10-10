import { useMemo, useState } from 'react';
import { BedDouble, CalendarDays, Download, Eye, FilePlus2, MapPin, Pencil, Search, Trash2, Users } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  hotelVoucherDownloadUrl,
  useDeleteHotelVoucher,
  useGenerateHotelVoucherPdf,
  useHotelVouchers,
  type HotelVoucher,
} from '@/features/hotel-vouchers/hotel-vouchers.api';
import { VoucherBrandingControl } from './VoucherBrandingDialog';
import './hotel-vouchers.css';

/** Display-only DD-MM-YYYY for API YYYY-MM-DD values. Never mutates payloads. */
export function formatVoucherDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '—';
  const [, year, month, day] = match;
  if (!year || !month || !day) return '—';
  if (Number(month) < 1 || Number(month) > 12) return '—';
  if (Number(day) < 1 || Number(day) > 31) return '—';
  return `${day}-${month}-${year}`;
}

function VoucherRowActions({ voucher }: { voucher: HotelVoucher }) {
  const generate = useGenerateHotelVoucherPdf(voucher.id);
  const [error, setError] = useState('');
  const [openBusy, setOpenBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const openInViewer = async () => {
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Allow pop-ups for this site so the PDF can open in a new tab.');
      return;
    }
    tab.opener = null;
    setOpenBusy(true);
    try {
      const document = await generate.mutateAsync();
      const target = await hotelVoucherDownloadUrl(voucher.id, document.id);
      try {
        const fetched = await fetch(target.url);
        if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
        const blob = await fetched.blob();
        tab.location.replace(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })));
      } catch {
        tab.location.replace(target.url);
      }
    } catch (failure) {
      tab.close();
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setOpenBusy(false);
    }
  };

  const downloadFile = async () => {
    setError('');
    setDownloadBusy(true);
    try {
      const document = await generate.mutateAsync();
      const target = await hotelVoucherDownloadUrl(voucher.id, document.id);
      const anchor = window.document.createElement('a');
      anchor.href = target.url;
      anchor.download = target.fileName || `hotel-voucher-${voucher.guestName}.pdf`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1.5 vouchers-actions">
      <button
        type="button"
        aria-label={`Open voucher for ${voucher.guestName}`}
        title="Open voucher"
        disabled={openBusy || downloadBusy}
        onClick={() => void openInViewer()}
        className="vouchers-action-btn vouchers-action-btn--teal"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`Download voucher for ${voucher.guestName}`}
        title="Download voucher"
        disabled={openBusy || downloadBusy}
        onClick={() => void downloadFile()}
        className="vouchers-action-btn vouchers-action-btn--blue"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
      </button>
      {error && (
        <span role="alert" className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Row-level delete reusing the detail page's confirmation + authorized
 * operation. Confirms with guest/hotel info (never the internal voucher
 * number); on success the list query invalidates and the row disappears.
 */
function VoucherDeleteButton({
  voucher,
  onDeleted,
  onError,
}: {
  voucher: HotelVoucher;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const remove = useDeleteHotelVoucher();
  const deleteVoucher = async () => {
    if (
      !window.confirm(
        `Delete voucher for ${voucher.guestName} at ${voucher.hotelName}? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await remove.mutateAsync(voucher.id);
      onDeleted();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <button
      type="button"
      aria-label={`Delete voucher for ${voucher.guestName}`}
      title="Delete voucher"
      disabled={remove.isPending}
      onClick={() => void deleteVoucher()}
      className="vouchers-action-btn vouchers-action-btn--red"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export function HotelVouchersPage() {
  const [params, setParams] = useSearchParams();
  // Server-side pagination: always request 20 rows so numbering, ranges and
  // page counts are computed on full pages (backend defaults match).
  const listParams = useMemo(() => {
    const next = new URLSearchParams(params);
    if (!next.get('pageSize')) next.set('pageSize', '20');
    return next;
  }, [params]);
  const list = useHotelVouchers(listParams);
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_UPDATE);
  const canExport = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_EXPORT);
  const canDelete = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_DELETE);
  const canViewBranding = hasPermission(PERMISSIONS.SETTINGS_VIEW);
  const canUpdateBranding = hasPermission(PERMISSIONS.SETTINGS_UPDATE);
  const [actionError, setActionError] = useState('');

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

  const page = list.data?.pagination.page ?? 1;
  const pageSize = list.data?.pagination.pageSize ?? 20;
  const base = (page - 1) * pageSize;
  const rowCount = list.data?.data.length ?? 0;

  return (
    <div className="space-y-5 vouchers-page">
      <PageHeader
        title="Hotel Vouchers"
        description=""
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewBranding && <VoucherBrandingControl canUpdate={canUpdateBranding} />}
            {canCreate ? (
              <Link to="/hotel-vouchers/new">
                <Button>
                  <FilePlus2 className="h-4 w-4" /> New voucher
                </Button>
              </Link>
            ) : undefined}
          </div>
        }
      />

      <div className="vouchers-toolbar">
        <div className="vouchers-search">
          <Search className="vouchers-search-icon h-4 w-4" aria-hidden="true" />
          <input
            aria-label="Search hotel vouchers"
            placeholder="Guest or hotel…"
            value={params.get('search') ?? ''}
            onChange={(event) => update('search', event.target.value)}
          />
        </div>
      </div>

      <div className="vouchers-card">
        {actionError && (
          <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </p>
        )}
        {list.isError ? (
          <p className="p-6 text-sm text-destructive">Could not load hotel vouchers.</p>
        ) : !list.data ? (
          <p className="p-6 text-sm text-muted-foreground">Loading hotel vouchers…</p>
        ) : list.data.data.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No hotel vouchers yet. Create one from a hotel stay.
          </p>
        ) : (
          <div className="vouchers-table-scroll">
            <table className="vouchers-table">
              <thead className="vouchers-thead">
                <tr>
                  <th scope="col" style={{ width: 56 }}>
                    No.
                  </th>
                  <th scope="col">
                    Guest / Hotel
                  </th>
                  <th scope="col">
                    Stay Dates
                  </th>
                  <th scope="col">
                    Created By
                  </th>
                  <th scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="vouchers-tbody">
                {list.data.data.map((voucher, index) => {
                  const pax = voucher.adults + voucher.children;
                  const rowNo = base + index + 1;
                  return (
                    <tr key={voucher.id}>
                      <td className="vouchers-no">
                        {rowNo}
                      </td>
                      <td>
                        <Link
                          to={`/hotel-vouchers/${voucher.id}`}
                          className="vouchers-guest-link block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        >
                          <span
                            className="vouchers-guest block truncate"
                            title={`${voucher.guestName} · ${voucher.hotelName}`}
                          >
                            {voucher.guestName} · {voucher.hotelName}
                          </span>
                          <span className="vouchers-meta">
                            {voucher.hotelCity && (
                              <span className="vouchers-meta-item">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{voucher.hotelCity}</span>
                              </span>
                            )}
                            <span className="vouchers-meta-item">
                              <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              {pax} guest{pax === 1 ? '' : 's'}
                            </span>
                            <span className="vouchers-meta-item">
                              <BedDouble className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                              {voucher.rooms} room{voucher.rooms === 1 ? '' : 's'}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="vouchers-stay">
                          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          {formatVoucherDate(voucher.checkIn)} → {formatVoucherDate(voucher.checkOut)}
                        </span>
                        {typeof voucher.nights === 'number' && (
                          <span className="vouchers-nights">
                            {voucher.nights} night{voucher.nights === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td className="vouchers-creator">
                        {voucher.createdBy?.fullName?.trim() ? voucher.createdBy.fullName : '—'}
                      </td>
                      <td>
                        <div className="vouchers-actions">
                          {canExport && <VoucherRowActions voucher={voucher} />}
                          {canUpdate && (
                            <Link
                              to={`/hotel-vouchers/${voucher.id}/edit`}
                              aria-label={`Edit voucher for ${voucher.guestName}`}
                              title="Edit voucher"
                              className="vouchers-action-btn vouchers-action-btn--blue"
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          )}
                          {canDelete && (
                            <VoucherDeleteButton
                              voucher={voucher}
                              onDeleted={() => {
                                // Last row of a later page: step back so the
                                // list never strands on an empty page.
                                if (rowCount === 1 && page > 1) setPage(page - 1);
                              }}
                              onError={setActionError}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
