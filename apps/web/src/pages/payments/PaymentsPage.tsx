import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  PERMISSIONS,
  labelForLookup,
  type PaymentMethodValue,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { MasterSelect } from '@/components/ui/MasterSelect';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCustomers } from '@/features/customers/customers.api';
import { useLeads } from '@/features/queries/queries.api';
import { formatDateTime12Hour } from '@/utils/dateTime';
import {
  useCreatePaymentTrip,
  useGeneratePaymentVoucher,
  usePaymentTrip,
  usePaymentTrips,
  useRecordStandalonePayment,
  useReverseStandalonePayment,
  useStandalonePayments,
  paymentVoucherDownloadUrl,
  type StandalonePayment,
} from '@/features/payments/payments.api';

const inputClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground';

const money = (value: string | null | undefined, currency = 'INR') =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value));

const CUSTOMER_LOOKUPS = new URLSearchParams('pageSize=100');
const LEAD_LOOKUPS = new URLSearchParams('pageSize=100');

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PaymentDetail({ row }: { row: StandalonePayment }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Payment Number</dt>
        <dd className="mt-1 text-sm font-medium">{row.paymentNumber}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Customer</dt>
        <dd className="mt-1 text-sm font-medium">{row.paymentCase.customerName}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Trip</dt>
        <dd className="mt-1 text-sm font-medium">{row.paymentCase.title}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Payment Date</dt>
        <dd className="mt-1 text-sm font-medium">{formatDateTime12Hour(row.receivedAt)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Amount</dt>
        <dd className="mt-1 text-sm font-medium">{money(row.amount, row.currency)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Currency</dt>
        <dd className="mt-1 text-sm font-medium">{row.currency}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Payment Method</dt>
        <dd className="mt-1 text-sm font-medium">{labelForLookup(row.paymentMethod)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Reference Number</dt>
        <dd className="mt-1 text-sm font-medium">{row.referenceNumber ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Bank Name</dt>
        <dd className="mt-1 text-sm font-medium">{row.bankName ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Status</dt>
        <dd className="mt-1 text-sm font-medium">
          {row.reversedAt ? 'Reversed' : labelForLookup(row.paymentStatus)}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Recorded By</dt>
        <dd className="mt-1 text-sm font-medium">{row.recordedBy?.fullName ?? '—'}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs uppercase text-muted-foreground">Notes</dt>
        <dd className="mt-1 text-sm font-medium">{row.notes ?? '—'}</dd>
      </div>
      {row.reversedAt && (
        <div className="rounded-lg bg-red-50 p-3 sm:col-span-2 lg:col-span-3">
          <dt className="text-xs uppercase text-red-700">Reversed</dt>
          <dd className="mt-1 text-sm text-red-700">
            {formatDateTime12Hour(row.reversedAt)} by {row.reversedBy?.fullName ?? '—'}
            {row.reversalReason ? ` — ${row.reversalReason}` : ''}
          </dd>
        </div>
      )}
    </dl>
  );
}

function TripHistory({ caseId, currency }: { caseId: string; currency: string }) {
  const trip = usePaymentTrip(caseId);
  const payments = trip.data?.payments ?? [];
  if (trip.isLoading) {
    return <p className="mt-4 text-sm text-muted-foreground">Loading trip history…</p>;
  }
  if (payments.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      <h4 className="mb-2 text-sm font-semibold">Trip payment history</h4>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground">
            <th className="px-2 py-1 font-medium">Date</th>
            <th className="px-2 py-1 font-medium">Amount</th>
            <th className="px-2 py-1 font-medium">Method</th>
            <th className="px-2 py-1 font-medium">Reference</th>
            <th className="px-2 py-1 font-medium">Status</th>
            <th className="px-2 py-1 font-medium">Voucher</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id} className="border-t border-border">
              <td className="px-2 py-1">{formatDateTime12Hour(payment.receivedAt)}</td>
              <td className="px-2 py-1 font-medium">{money(payment.amount, currency)}</td>
              <td className="px-2 py-1">{labelForLookup(payment.paymentMethod)}</td>
              <td className="px-2 py-1">{payment.referenceNumber ?? '—'}</td>
              <td className="px-2 py-1">
                {payment.reversedAt ? 'Reversed' : labelForLookup(payment.paymentStatus)}
              </td>
              <td className="px-2 py-1">{payment.receipt?.receiptNumber ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentsPage() {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission(PERMISSIONS.PAYMENTS_CREATE);
  const [params, setParams] = useSearchParams();
  const ledger = useStandalonePayments(params);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  const rows = ledger.data?.data ?? [];
  const summary = ledger.data?.summary;
  const pagination = ledger.data?.pagination;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description="Customer collections across trips. Standalone payments are the single source of truth."
        actions={
          canRecord ? (
            <Button onClick={() => setRecordOpen((open) => !open)}>
              {recordOpen ? 'Close' : '+ Record Payment'}
            </Button>
          ) : undefined
        }
      />

      {recordOpen && canRecord && <RecordPaymentPanel onDone={() => setRecordOpen(false)} />}

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            label="Total Collected"
            value={money(summary.totalCollected)}
            hint={`${summary.paymentCount} payment${summary.paymentCount === 1 ? '' : 's'} in filter`}
          />
          <SummaryCard label="Payments" value={String(summary.paymentCount)} hint="In filter" />
          <SummaryCard label="Received Today" value={money(summary.receivedToday)} />
          <SummaryCard label="Received This Month" value={money(summary.receivedThisMonth)} />
        </div>
      )}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="mb-4 grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <input
            aria-label="Search payments"
            className={inputClass}
            placeholder="Search customer, trip, reference…"
            value={params.get('search') ?? ''}
            onChange={(event) => update('search', event.target.value)}
          />
          <select
            aria-label="Filter by payment method"
            className={inputClass}
            value={params.get('paymentMethod') ?? ''}
            onChange={(event) => update('paymentMethod', event.target.value)}
          >
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {labelForLookup(method)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by payment status"
            className={inputClass}
            value={params.get('paymentStatus') ?? ''}
            onChange={(event) => update('paymentStatus', event.target.value)}
          >
            <option value="">All statuses</option>
            {PAYMENT_RECORD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {labelForLookup(status)}
              </option>
            ))}
          </select>
          <input
            aria-label="Payment date from"
            type="date"
            className={inputClass}
            value={params.get('dateFrom') ?? ''}
            onChange={(event) => update('dateFrom', event.target.value)}
          />
          <input
            aria-label="Payment date to"
            type="date"
            className={inputClass}
            value={params.get('dateTo') ?? ''}
            onChange={(event) => update('dateTo', event.target.value)}
          />
        </div>

        {ledger.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading payments…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No payments found"
            description="Record a payment against a customer trip to see it here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Customer</th>
                  <th className="px-2 py-2 font-medium">Trip</th>
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Method</th>
                  <th className="px-2 py-2 font-medium">Reference</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Receipt</th>
                  <th className="w-20 px-2 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-border align-top">
                      <td className="px-2 py-2 font-medium">{row.paymentCase.customerName}</td>
                      <td className="px-2 py-2 font-medium">{row.paymentCase.title}</td>
                      <td className="px-2 py-2">{formatDateTime12Hour(row.receivedAt)}</td>
                      <td className="px-2 py-2 font-medium">{money(row.amount, row.currency)}</td>
                      <td className="px-2 py-2">{labelForLookup(row.paymentMethod)}</td>
                      <td className="px-2 py-2">{row.referenceNumber ?? '—'}</td>
                      <td className="px-2 py-2">
                        {row.reversedAt ? 'Reversed' : labelForLookup(row.paymentStatus)}
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={
                            row.receipt
                              ? `Open voucher ${row.receipt.receiptNumber}`
                              : `Voucher for payment ${row.paymentNumber}`
                          }
                          onClick={() => setExpandedId(row.id)}
                        >
                          {row.receipt ? row.receipt.receiptNumber : 'Voucher'}
                        </Button>
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} payment ${row.paymentNumber} details`}
                          onClick={() =>
                            setExpandedId((current) => (current === row.id ? null : row.id))
                          }
                        >
                          {expandedId === row.id ? 'Hide' : 'View'}
                        </Button>
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr className="border-t border-border bg-muted/30">
                        <td colSpan={9} className="px-2 py-4">
                          <PaymentDetail row={row} />
                          <TripHistory caseId={row.paymentCase.id} currency={row.currency} />
                          <PaymentVoucherBlock
                            row={row}
                            canGenerate={
                              hasPermission(PERMISSIONS.PAYMENTS_GENERATE_RECEIPTS) &&
                              !row.reversedAt
                            }
                          />
                          {hasPermission(PERMISSIONS.PAYMENTS_REVERSE) && !row.reversedAt && (
                            <ReversePayment row={row} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-4">
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ReversePayment({ row }: { row: StandalonePayment }) {
  const reverse = useReverseStandalonePayment();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  if (!confirming) {
    return (
      <div className="mt-4">
        <Button type="button" size="sm" variant="danger" onClick={() => setConfirming(true)}>
          Reverse Payment
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-red-200 p-3">
      <FormField label="Reversal reason *">
        <textarea
          aria-label={`Reversal reason for ${row.paymentNumber}`}
          className={inputClass}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this payment being reversed?"
        />
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="danger"
          isLoading={reverse.isPending}
          disabled={!reason.trim()}
          onClick={() => {
            setError('');
            reverse.mutate(
              { paymentId: row.id, reason: reason.trim() },
              {
                onSuccess: () => {
                  setConfirming(false);
                  setReason('');
                },
                onError: (failure) =>
                  setError(failure instanceof Error ? failure.message : String(failure)),
              },
            );
          }}
        >
          Confirm reversal
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PaymentVoucherBlock({
  row,
  canGenerate,
}: {
  row: StandalonePayment;
  canGenerate: boolean;
}) {
  const generate = useGeneratePaymentVoucher(row.id);
  const [error, setError] = useState('');

  const openPdfInNewTab = async (task: () => Promise<{ url: string }>) => {
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Allow pop-ups for this site so the voucher can open in a new tab.');
      return;
    }
    tab.opener = null;
    try {
      const { url } = await task();
      tab.location.replace(url);
    } catch (failure) {
      tab.close();
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const viewVoucher = () =>
    openPdfInNewTab(async () => {
      const target = await paymentVoucherDownloadUrl(row.id);
      const fetched = await fetch(target.url);
      if (!fetched.ok) throw new Error(`Voucher download failed (HTTP ${fetched.status}).`);
      const blob = await fetched.blob();
      return { url: URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })) };
    });

  const downloadVoucher = () => openPdfInNewTab(() => paymentVoucherDownloadUrl(row.id));

  return (
    <div className="mt-4 rounded-lg border p-3">
      <h4 className="text-sm font-semibold">Voucher</h4>
      {row.receipt ? (
        <p className="mt-1 text-sm text-muted-foreground">{row.receipt.receiptNumber}</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Not Generated</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {canGenerate && !row.receipt && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            isLoading={generate.isPending}
            onClick={() => {
              setError('');
              generate.mutate(undefined, {
                onError: (failure) =>
                  setError(failure instanceof Error ? failure.message : String(failure)),
              });
            }}
          >
            Generate Voucher
          </Button>
        )}
        {row.receipt && (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => void viewVoucher()}>
              View
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void downloadVoucher()}
            >
              Download
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function RecordPaymentPanel({ onDone }: { onDone: () => void }) {
  const [tripSearch, setTripSearch] = useState('');
  const [caseId, setCaseId] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>('BANK_TRANSFER');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const tripParams = useMemo(() => {
    const next = new URLSearchParams();
    if (tripSearch.trim()) next.set('search', tripSearch.trim());
    next.set('pageSize', '10');
    return next;
  }, [tripSearch]);
  const lookups = usePaymentTrips(tripParams);
  const trip = usePaymentTrip(caseId || undefined);
  const record = useRecordStandalonePayment();

  const tripOptions = lookups.data?.data ?? [];
  const tripSearchActive = tripSearch.trim() !== '';
  const tripSearchSettled = lookups.isSuccess && !lookups.isFetching;

  const handleTripSearchChange = (value: string) => {
    setTripSearch(value);
    if (selectedLabel !== null && value !== selectedLabel) {
      setSelectedLabel(null);
      setCaseId('');
    }
  };

  const selectTrip = (option: { id: string; customerName: string; title: string }) => {
    const label = `${option.customerName} · ${option.title}`;
    setCaseId(option.id);
    setSelectedLabel(label);
    setTripSearch(label);
    setCreatingTrip(false);
  };

  const details = caseId ? trip.data : undefined;
  const outstandingBefore =
    details?.outstanding !== undefined && details?.outstanding !== null
      ? Number(details.outstanding)
      : null;
  const amountValue = Number(amount);
  const outstandingAfter =
    outstandingBefore === null || !Number.isFinite(amountValue)
      ? null
      : Math.max(0, outstandingBefore - amountValue);
  const canSubmit =
    Boolean(caseId) &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    Boolean(receivedAt) &&
    Boolean(paymentMethod) &&
    !record.isPending;

  const submit = () => {
    if (!details || !canSubmit) return;
    setError('');
    record.mutate(
      {
        caseId,
        amount: amountValue,
        currency: details.currency,
        paymentMethod,
        paymentStatus: 'RECEIVED',
        receivedAt,
        referenceNumber: referenceNumber.trim() || undefined,
        bankName: bankName.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => onDone(),
        onError: (failure) =>
          setError(failure instanceof Error ? failure.message : String(failure)),
      },
    );
  };

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Record payment">
      <h2 className="mb-1 text-base font-semibold">Record Payment</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Payments are recorded against a customer trip. Overpayments beyond the outstanding balance
        are rejected by the server.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <FormField label="Customer / Trip *">
            <input
              aria-label="Search customer trips"
              className={inputClass}
              placeholder="Type a customer or trip name…"
              value={tripSearch}
              onChange={(event) => handleTripSearchChange(event.target.value)}
            />
          </FormField>
          {tripSearchActive && !caseId && tripOptions.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Select a trip from the search results.
            </p>
          )}
          {tripSearchActive &&
            !caseId &&
            tripSearchSettled &&
            tripOptions.length === 0 &&
            !creatingTrip && (
              <p className="mt-1 text-xs text-muted-foreground">
                No trips found for “{tripSearch.trim()}”. Create the trip below, then record its
                payment.
              </p>
            )}
          {tripOptions.length > 0 && (
            <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-lg border">
              {tripOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() =>
                      selectTrip({
                        id: option.id,
                        customerName: option.customerName,
                        title: option.title,
                      })
                    }
                  >
                    {option.customerName} · {option.title} · Outstanding{' '}
                    {money(option.outstanding, option.currency)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!caseId && (
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setCreatingTrip((open) => !open)}
              >
                {creatingTrip ? 'Cancel new trip' : 'New trip'}
              </Button>
            </div>
          )}
        </div>

        {creatingTrip && !caseId && (
          <NewTripForm
            onCreated={(id, label) => {
              setCaseId(id);
              setSelectedLabel(label);
              setTripSearch(label);
              setCreatingTrip(false);
            }}
          />
        )}

        {details && (
          <div className="rounded-lg bg-muted/40 p-3 text-sm md:col-span-2">
            <p className="font-medium">
              {details.customerName} · {details.title}
            </p>
            <p className="mt-1 text-muted-foreground">
              Trip Amount: {money(details.tripAmount, details.currency)} · Already Paid:{' '}
              {money(details.collected, details.currency)} · Outstanding:{' '}
              {money(details.outstanding, details.currency)} · {labelForLookup(details.status)}
            </p>
          </div>
        )}

        <FormField label="Amount *">
          <input
            aria-label="Payment amount"
            type="number"
            min={0}
            step="any"
            className={inputClass}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>
        <FormField label="Payment Date *">
          <input
            aria-label="Payment date"
            type="date"
            className={inputClass}
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
          />
        </FormField>
        <FormField label="Payment Method *">
          <select
            aria-label="Payment method"
            className={inputClass}
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as PaymentMethodValue)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {labelForLookup(method)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reference Number">
          <input
            aria-label="Payment reference number"
            className={inputClass}
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            placeholder="UPI123"
          />
        </FormField>
        <FormField label="Bank Name">
          <input
            aria-label="Payment bank name"
            className={inputClass}
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
          />
        </FormField>
        <div className="md:col-span-2">
          <FormField label="Notes">
            <textarea
              aria-label="Payment notes"
              className={inputClass}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </div>
      </div>

      {outstandingBefore !== null && outstandingAfter !== null && (
        <p className="mt-3 text-sm font-medium" aria-live="polite">
          Outstanding before payment: {money(String(outstandingBefore), details?.currency)} + This
          payment: {money(amount, details?.currency)} = Outstanding after payment:{' '}
          {money(String(outstandingAfter), details?.currency)}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button isLoading={record.isPending} disabled={!canSubmit} onClick={submit}>
          Record payment
        </Button>
      </div>
    </section>
  );
}

function NewTripForm({ onCreated }: { onCreated: (id: string, label: string) => void }) {
  const customers = useCustomers(CUSTOMER_LOOKUPS);
  const leads = useLeads(LEAD_LOOKUPS);
  const createTrip = useCreatePaymentTrip();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [queryId, setQueryId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [tripAmount, setTripAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [error, setError] = useState('');

  const customerOptions = useMemo(
    () =>
      (customers.data?.data ?? []).map((customer) => ({
        id: customer.id,
        label: customer.displayName,
        hint: customer.primaryPhone ?? customer.email ?? undefined,
      })),
    [customers.data],
  );
  const leadOptions = useMemo(
    () =>
      (leads.data?.data ?? []).map((lead) => ({
        id: lead.id,
        label: lead.customerName,
        hint: lead.queryNumber ?? undefined,
      })),
    [leads.data],
  );

  const pickCustomer = (id: string | null) => {
    setCustomerId(id);
    if (!id) return;
    const customer = (customers.data?.data ?? []).find((row) => row.id === id);
    if (!customer) return;
    setCustomerName(customer.displayName);
    if (customer.primaryPhone) setCustomerPhone(customer.primaryPhone);
    if (customer.email) setCustomerEmail(customer.email);
  };

  const pickLead = (id: string | null) => {
    setQueryId(id);
    if (!id) return;
    const lead = (leads.data?.data ?? []).find((row) => row.id === id);
    if (!lead) return;
    if (!customerId) {
      setCustomerName(lead.customerName);
    }
    if (!title.trim()) {
      setTitle(`${lead.customerName} Trip`);
    }
    const expected = Number(lead.expectedAmount);
    if (!tripAmount && Number.isFinite(expected) && expected > 0) {
      setTripAmount(String(expected));
    }
  };

  const amountValue = Number(tripAmount);
  const canSubmit =
    customerName.trim().length >= 2 &&
    title.trim().length >= 2 &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    currency.trim().length === 3 &&
    !createTrip.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setError('');
    createTrip.mutate(
      {
        customerId,
        queryId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        customerEmail: customerEmail.trim() || null,
        title: title.trim(),
        tripAmount: amountValue,
        currency: currency.trim().toUpperCase(),
      },
      {
        onSuccess: (created) => {
          onCreated(created.id, `${created.customerName} · ${created.title}`);
        },
        onError: (failure) =>
          setError(failure instanceof Error ? failure.message : String(failure)),
      },
    );
  };

  return (
    <div className="space-y-4 rounded-lg border p-4 md:col-span-2">
      <h3 className="text-sm font-semibold">New trip</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm font-medium">Customer (optional)</span>
          <MasterSelect
            ariaLabel="Customer"
            placeholder="Select a customer master, or type the name below"
            options={customerOptions}
            value={customerId}
            onSelect={(option) => pickCustomer(option?.id ?? null)}
            loading={customers.isLoading}
          />
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium">Lead (optional)</span>
          <MasterSelect
            ariaLabel="Lead"
            placeholder="Link a lead to prefill this trip"
            options={leadOptions}
            value={queryId}
            onSelect={(option) => pickLead(option?.id ?? null)}
            loading={leads.isLoading}
          />
        </div>
        <FormField label="Customer Name *">
          <input
            aria-label="Trip customer name"
            className={inputClass}
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
          />
        </FormField>
        <FormField label="Trip Title *">
          <input
            aria-label="Trip title"
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Singapore Family Trip"
          />
        </FormField>
        <FormField label="Customer Phone">
          <input
            aria-label="Trip customer phone"
            className={inputClass}
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
          />
        </FormField>
        <FormField label="Customer Email">
          <input
            aria-label="Trip customer email"
            className={inputClass}
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
          />
        </FormField>
        <FormField label="Trip Amount *">
          <input
            aria-label="Trip amount"
            type="number"
            min={0}
            step="any"
            className={inputClass}
            value={tripAmount}
            onChange={(event) => setTripAmount(event.target.value)}
          />
        </FormField>
        <FormField label="Currency *">
          <input
            aria-label="Trip currency"
            className={inputClass}
            maxLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </FormField>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button isLoading={createTrip.isPending} disabled={!canSubmit} onClick={submit}>
          Create trip
        </Button>
      </div>
    </div>
  );
}
