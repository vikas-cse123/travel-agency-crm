import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Download, Eye, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
// Shared plain-or-markup renderer (same helper the editor uses).
import { richTextToDisplayHtml, SafeRichText } from '@/pages/masters/MasterUi';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  hotelVoucherDownloadUrl,
  useDeleteHotelVoucher,
  useGenerateHotelVoucherPdf,
  useHotelVoucher,
} from '@/features/hotel-vouchers/hotel-vouchers.api';
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

/** Viewer tab title from a download filename (`{Lead} - {Hotel}.pdf`). */
function friendlyTitle(fileName: string | null | undefined): string | undefined {
  if (!fileName) return undefined;
  const title = fileName.replace(/\.pdf$/i, '').trim();
  return title.length > 0 ? title : undefined;
}

export function HotelVoucherDetailsPage() {
  const { voucherId } = useParams();
  const navigate = useNavigate();
  const voucher = useHotelVoucher(voucherId);
  const remove = useDeleteHotelVoucher();
  const generate = useGenerateHotelVoucherPdf(voucherId ?? '');
  const { hasPermission } = useAuth();
  const [actionError, setActionError] = useState('');

  const canUpdate = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_DELETE);
  const canExport = hasPermission(PERMISSIONS.HOTEL_VOUCHERS_EXPORT);

  if (voucher.isError) return <Navigate to="/hotel-vouchers" replace />;
  if (!voucher.data) return <p className="p-6 text-sm text-muted-foreground">Loading voucher…</p>;
  const value = voucher.data;
  const latestDoc = value.documents?.[0] ?? null;
  const pricingRows = value.pricing ?? [];
  const guestRows = value.guests ?? [];
  const packageItems = value.packageIncludes ?? [];
  // Room/meal rows with a legacy-scalar fallback for vouchers saved before
  // stay rows existed (single room/meal snapshots).
  const stayRoomRows =
    (value.stayRooms ?? []).length > 0
      ? (value.stayRooms ?? [])
      : value.roomTypeName
        ? [
            {
              id: 'legacy-room',
              roomType: value.roomTypeName,
              rooms: value.rooms,
              extraBedQuantity: null,
              childWithoutBedQuantity: null,
              notes: null,
            },
          ]
        : [];
  const stayMealRows =
    (value.stayMeals ?? []).length > 0
      ? (value.stayMeals ?? [])
      : value.mealPlanName
        ? [{ id: 'legacy-meal', mealPlan: value.mealPlanName }]
        : [];

  const run = async (task: () => Promise<unknown>) => {
    setActionError('');
    try {
      await task();
    } catch (error) {
      if (error instanceof Error) setActionError(error.message);
    }
  };

  const ensurePdf = async () => {
    if (latestDoc) return latestDoc;
    const generated = await generate.mutateAsync();
    return generated;
  };

  /**
   * Open the PDF in a new tab (project convention: open `about:blank`
   * synchronously inside the click handler so popup blockers allow it, run
   * the async API work, then navigate the tab to the signed URL).
   */
  const openPdfInNewTab = async (task: () => Promise<{ url: string; title: string | undefined }>) => {
    setActionError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setActionError('Allow pop-ups for this site so the PDF can open in a new tab.');
      return;
    }
    tab.opener = null;
    tab.document.title = 'Opening PDF…';
    tab.document.body.innerHTML = '<p style="font:16px system-ui;padding:32px">Opening PDF…</p>';
    try {
      const { url, title } = await task();
      // Friendly tab title so saving from the viewer suggests the readable
      // `{Lead} - {Hotel}` filename instead of a blob or storage key.
      if (title) tab.document.title = title;
      tab.location.replace(url);
    } catch (error) {
      tab.close();
      if (error instanceof Error) setActionError(error.message);
    }
  };

  const downloadLatest = () =>
    openPdfInNewTab(async () => {
      const document = await ensurePdf();
      const target = await hotelVoucherDownloadUrl(value.id, document.id);
      return { url: target.url, title: friendlyTitle(target.fileName) };
    });

  /**
   * Open the generated PDF in the browser viewer (not a download).
   * The signed URL forces attachment disposition, so the bytes are fetched
   * and shown through a blob URL instead; if that fetch fails, fall back to
   * the signed URL itself so the user still receives the file. Generates the
   * PDF first when none exists yet, so Open never dead-ends on a missing
   * document — the same generate-first flow Download already uses.
   */
  const openExistingPdf = async () => {
    setActionError('');
    let document;
    try {
      document = await ensurePdf();
    } catch (error) {
      if (error instanceof Error) setActionError(error.message);
      return;
    }
    if (!document) {
      setActionError('Hotel voucher PDF could not be generated. Please try again.');
      return;
    }
    await openPdfInNewTab(async () => {
      const target = await hotelVoucherDownloadUrl(value.id, document.id);
      const title = friendlyTitle(target.fileName);
      try {
        const fetched = await fetch(target.url);
        if (!fetched.ok) throw new Error(`HTTP ${fetched.status}`);
        const blob = await fetched.blob();
        return { url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })), title };
      } catch {
        return { url: target.url, title };
      }
    });
  };

  const deleteVoucher = async () => {
    if (!window.confirm(`Delete voucher ${value.voucherNumber}? This cannot be undone.`))
      return;
    await run(async () => {
      await remove.mutateAsync(value.id);
      navigate('/hotel-vouchers');
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hotel Voucher ${value.voucherNumber}`}
        description={`Voucher snapshots stay frozen even if masters change.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/hotel-vouchers">
              <Button variant="secondary" title="Back to hotel vouchers">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
              </Button>
            </Link>
            {canUpdate && (
              <Link to={`/hotel-vouchers/${value.id}/edit`}>
                <Button variant="secondary" title="Edit voucher">
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                </Button>
              </Link>
            )}
            {canExport && (
              <>
                <Button
                  variant="secondary"
                  title="Open the voucher PDF in the browser"
                  isLoading={generate.isPending}
                  onClick={() => void openExistingPdf()}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" /> Open Voucher
                </Button>
                <Button
                  variant="secondary"
                  title="Download the voucher PDF"
                  isLoading={generate.isPending}
                  onClick={() => void downloadLatest()}
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                variant="danger"
                title="Delete this voucher"
                isLoading={remove.isPending}
                onClick={deleteVoucher}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </Button>
            )}
          </div>
        }
      />
      {actionError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {value.nights != null ? `${value.nights} night${value.nights === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Guest" value={value.guestName} />
          <Detail label="Phone" value={value.guestPhone ?? '—'} />
          <Detail label="Email" value={value.guestEmail ?? '—'} />
          <Detail
            label="Travellers"
            value={`${value.adults} adult${value.adults === 1 ? '' : 's'}${value.children ? `, ${value.children} children` : ''}`}
          />
          <Detail label="Hotel" value={value.hotelName} />
          <Detail label="City" value={value.hotelCity ?? '—'} />
          <Detail label="Hotel address" value={value.hotelAddress ?? '—'} />
          <Detail label="Hotel phone" value={value.hotelPhone ?? '—'} />
          <Detail label="Hotel email" value={value.hotelEmail ?? '—'} />
          <Detail label="Star rating" value={value.hotelStarRating ?? '—'} />
          <Detail label="Check-in" value={value.checkIn} />
          <Detail label="Check-out" value={value.checkOut} />
          <Detail label="Rooms" value={String(value.rooms)} />
          <Detail
            label={value.confirmationNumberLabel?.trim() || 'Confirmation'}
            value={value.confirmationNumber ?? '—'}
          />
          <Detail
            label={value.bookingIdLabel?.trim() || 'Booking ID'}
            value={value.bookingId ?? '—'}
          />        </dl>
        {stayRoomRows.length > 0 && (
          <div className="mt-5 overflow-x-auto border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Rooms</h3>
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Room Type</th>
                  <th className="px-2 py-1 font-medium">Rooms</th>
                  <th className="px-2 py-1 font-medium">Extra Bed</th>
                  <th className="px-2 py-1 font-medium">Child w/o Bed</th>
                  <th className="px-2 py-1 font-medium">Remark</th>
                </tr>
              </thead>
              <tbody>
                {stayRoomRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1">{row.roomType}</td>
                    <td className="px-2 py-1">{row.rooms}</td>
                    <td className="px-2 py-1">{row.extraBedQuantity ?? '—'}</td>
                    <td className="px-2 py-1">{row.childWithoutBedQuantity ?? '—'}</td>
                    <td className="px-2 py-1">{row.notes?.trim() ? row.notes : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stayMealRows.length > 0 && (
          <div className="mt-5 overflow-x-auto border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Meal Plans</h3>
            <table className="w-full min-w-[320px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Meal Plan</th>
                </tr>
              </thead>
              <tbody>
                {stayMealRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1">{row.mealPlan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pricingRows.length > 0 && (
          <div className="mt-5 overflow-x-auto border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Pricing</h3>
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Room Type</th>
                  <th className="px-2 py-1 font-medium">Unit</th>
                  <th className="px-2 py-1 font-medium">Quantity</th>
                  <th className="px-2 py-1 font-medium">GST %</th>
                  <th className="px-2 py-1 font-medium">Amount</th>
                  <th className="px-2 py-1 font-medium">Taxable Pay</th>
                  <th className="px-2 py-1 font-medium">GST + Service</th>
                </tr>
              </thead>
              <tbody>
                {pricingRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1">{row.roomType}</td>
                    <td className="px-2 py-1">{row.unit}</td>
                    <td className="px-2 py-1">{row.quantity}</td>
                    <td className="px-2 py-1">{row.gst ?? '—'}</td>
                    <td className="px-2 py-1">{row.amount ?? '—'}</td>
                    <td className="px-2 py-1">{row.taxablePay ?? '—'}</td>
                    <td className="px-2 py-1">{row.gstService ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm font-medium">
              Total Payable Amount:{' '}
              {pricingRows
                .reduce((sum, row) => sum + (row.gstService ?? 0), 0)
                .toLocaleString('en-IN')}
            </p>
          </div>
        )}
        {guestRows.length > 0 && (
          <div className="mt-5 overflow-x-auto border-t pt-4">
            <h3 className="mb-2 text-sm font-semibold">Guest Information</h3>
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Guest Name</th>
                  <th className="px-2 py-1 font-medium">No of Pax</th>
                </tr>
              </thead>
              <tbody>
                {guestRows.map((row, index) => (
                  <tr key={row.id} className="border-t border-border">
                    <td className="px-2 py-1 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-1">{row.guestName}</td>
                    <td className="px-2 py-1">{row.paxType === 'ADULT' ? 'Adult' : 'Child'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {packageItems.length > 0 && (
          <div className="mt-5 border-t pt-4 text-sm">
            <h3 className="mb-2 text-sm font-semibold">Package Includes</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {packageItems.map((item, index) => (
                <li key={`${index}-${item}`}>
                  <span dangerouslySetInnerHTML={{ __html: richTextToDisplayHtml(item) }} />
                </li>
              ))}
            </ol>
          </div>
        )}
        {(value.specialRequests || value.remarks || value.termsSnapshot) && (
          <div className="mt-5 space-y-3 border-t pt-4 text-sm">
            {value.specialRequests && (
              <p>
                <strong>Special requests:</strong> {value.specialRequests}
              </p>
            )}
            {value.remarks && (
              <p>
                <strong>Remarks:</strong> {value.remarks}
              </p>
            )}
            {value.termsSnapshot && (
              <div>
                <strong>Terms &amp; conditions:</strong>
                <SafeRichText html={value.termsSnapshot} empty="" />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
