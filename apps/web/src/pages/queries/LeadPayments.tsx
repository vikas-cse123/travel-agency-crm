import { useEffect, useState } from 'react';
import { Download, Eye, Landmark, Wallet, X } from 'lucide-react';
import {
  PAYMENT_METHODS,
  PERMISSIONS,
  labelForLookup,
  type PaymentMethodValue,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, inputClasses } from '@/components/ui/FormField';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatDateTime12Hour } from '@/utils/dateTime';
import { ApiError } from '@/api/client';
import {
  paymentVoucherDownloadUrl,
  useEnsureLeadPaymentCase,
  useGeneratePaymentVoucher,
  useLeadPaymentCase,
  useRecordStandalonePayment,
  type LeadPaymentCaseState,
  type PaymentTripDetails,
  type TripPaymentRow,
} from '@/features/payments/payments.api';

const money = (value: string | number | null | undefined, currency = 'INR') => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(n);
  } catch {
    return String(n);
  }
};

const paymentStatusLabel = (row: TripPaymentRow) =>
  row.reversedAt ? 'Reversed' : labelForLookup(row.paymentStatus);

const todayInput = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

async function openReceipt(paymentId: string): Promise<string | null> {
  try {
    const { url } = await paymentVoucherDownloadUrl(paymentId);
    window.open(url, '_blank', 'noopener');
    return null;
  } catch {
    return 'The receipt could not be opened.';
  }
}

function ReceiptCell({ row }: { row: TripPaymentRow }) {
  const { hasPermission } = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (!row.receipt) return <span className="text-slate-400">—</span>;
  if (!hasPermission(PERMISSIONS.PAYMENTS_VIEW_RECEIPTS))
    return <span className="font-mono text-xs">{row.receipt.receiptNumber}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        title={`Open receipt ${row.receipt.receiptNumber}`}
        aria-label={`Open receipt ${row.receipt.receiptNumber}`}
        className="font-mono text-xs font-medium text-brand-700 hover:underline"
        onClick={() => void openReceipt(row.id).then((message) => setError(message))}
      >
        {row.receipt.receiptNumber}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}

function PaymentRows({ payments }: { payments: TripPaymentRow[] }) {
  if (payments.length === 0)
    return <p className="py-4 text-center text-sm text-slate-500">No payments recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3 font-medium">Payment</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Amount</th>
            <th className="py-2 pr-3 font-medium">Method</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {payments.map((row) => (
            <tr key={row.id}>
              <td className="py-2 pr-3 font-mono text-xs">{row.paymentNumber}</td>
              <td className="py-2 pr-3 text-xs">{formatDateTime12Hour(row.receivedAt)}</td>
              <td className="py-2 pr-3 font-medium">{money(row.amount, row.currency)}</td>
              <td className="py-2 pr-3 text-xs">{labelForLookup(row.paymentMethod)}</td>
              <td className="py-2 pr-3 text-xs">{paymentStatusLabel(row)}</td>
              <td className="py-2">
                <ReceiptCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact payment summary + history for a lead. Never creates a case. */
export function LeadPaymentsCard({ queryId, onRecord }: { queryId: string; onRecord: () => void }) {
  const { hasPermission } = useAuth();
  const canView = hasPermission(PERMISSIONS.PAYMENTS_VIEW);
  const state = useLeadPaymentCase(queryId, canView);
  if (!canView) return null;
  const canRecord = hasPermission(PERMISSIONS.PAYMENTS_CREATE);

  if (state.isPending) return <div className="h-40 animate-pulse rounded-xl bg-slate-100" />;
  if (state.isError) {
    if (state.error instanceof ApiError && state.error.status === 403) return null;
    return (
      <div role="alert" className="rounded-xl border bg-card p-5 text-sm text-red-700 shadow-sm">
        Payment information could not be loaded.
      </div>
    );
  }
  const trip = state.data.case;
  const fullyPaidCard = trip != null && Number(trip.outstanding) <= 0 && trip.paymentCount > 0;
  return (
    <section className="rounded-xl border bg-card shadow-sm" aria-label="Lead payments">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-950">Payments</h2>
          <p className="mt-0.5 text-xs text-slate-500">Collections against this lead&apos;s trip</p>
        </div>
        {canRecord && (
          <Button
            size="sm"
            onClick={onRecord}
            disabled={fullyPaidCard}
            title={fullyPaidCard ? 'Trip fully paid' : 'Record a payment'}
          >
            <Landmark className="h-4 w-4" />
            Record Payment
          </Button>
        )}
      </div>
      <div className="space-y-4 p-4">
        {!trip ? (
          <EmptyState
            icon={Wallet}
            title="No payments recorded"
            {...(canRecord
              ? {
                  description:
                    'Record the first collection for this lead without leaving this page.',
                }
              : {})}
            action={
              canRecord ? (
                <Button size="sm" onClick={onRecord}>
                  <Landmark className="h-4 w-4" />
                  Record Payment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: 'Agreed', value: money(trip.tripAmount, trip.currency) },
                { label: 'Received', value: money(trip.collected, trip.currency) },
                { label: 'Outstanding', value: money(trip.outstanding, trip.currency) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="truncate text-xs text-slate-500">
              {trip.title} · {trip.paymentCount} payment{trip.paymentCount === 1 ? '' : 's'}
            </p>
            <PaymentRows payments={trip.payments} />
          </>
        )}
      </div>
    </section>
  );
}

function CaseSetupForm({
  queryId,
  initialTitle,
  initialAmount,
  initialCurrency,
  quotationNumber,
  quotationAmount,
  onResolved,
}: {
  queryId: string;
  initialTitle: string;
  initialAmount: number | null;
  initialCurrency: string;
  quotationNumber: string | null;
  quotationAmount: number | null;
  onResolved: (state: LeadPaymentCaseState) => void;
}) {
  const ensure = useEnsureLeadPaymentCase();
  const [title, setTitle] = useState(initialTitle);
  const [amount, setAmount] = useState(initialAmount != null ? String(initialAmount) : '');
  const [currency, setCurrency] = useState(initialCurrency);
  const [error, setError] = useState('');
  const amountNumber = Number(amount);
  const valid =
    title.trim().length >= 2 &&
    amount.trim() !== '' &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    currency.trim().length === 3 &&
    !ensure.isPending;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setError('');
        ensure.mutate(
          {
            queryId,
            title: title.trim(),
            tripAmount: amountNumber,
            currency: currency.trim().toUpperCase(),
          },
          {
            onSuccess: (resolved) => onResolved(resolved),
            onError: (failure) =>
              setError(
                failure instanceof ApiError && failure.message
                  ? failure.message
                  : 'The payment trip could not be created.',
              ),
          },
        );
      }}
    >
      <p className="text-sm text-slate-600">
        No usable trip amount was found
        {quotationNumber
          ? ` (linked ${quotationNumber}${
              quotationAmount != null ? `, final ${money(quotationAmount, initialCurrency)}` : ''
            })`
          : ' and the lead has no linked quotation'}
        . Enter the agreed trip amount to continue — nothing is recorded yet.
      </p>
      <FormField label="Trip title" required>
        <input
          aria-label="Trip title"
          className={inputClasses(false)}
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <FormField label="Agreed trip amount" required>
          <input
            aria-label="Agreed trip amount"
            className={inputClasses(false)}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>
        <FormField label="Currency" required>
          <input
            aria-label="Currency"
            className={inputClasses(false)}
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </FormField>
      </div>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!valid} isLoading={ensure.isPending}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({ trip }: { trip: PaymentTripDetails }) {
  const record = useRecordStandalonePayment();
  const voucher = useGeneratePaymentVoucher('');
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(todayInput());
  const [method, setMethod] = useState<PaymentMethodValue>('BANK_TRANSFER');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [doneId, setDoneId] = useState<string | null>(null);
  const [doneNumber, setDoneNumber] = useState<string | null>(null);
  const [voucherError, setVoucherError] = useState('');

  const outstanding = Number(trip.outstanding);
  const fullyPaid = trip.paymentCount > 0 && outstanding <= 0;
  const amountNumber = Number(amount);
  const canSubmit =
    !fullyPaid &&
    amount.trim() !== '' &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    Boolean(receivedAt) &&
    Boolean(method) &&
    !record.isPending;

  if (fullyPaid && !doneId) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          This trip is fully paid ({money(trip.collected, trip.currency)} received). No further
          payment can be recorded.
        </div>
        <PaymentRows payments={trip.payments} />
      </div>
    );
  }

  if (doneId) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Payment {doneNumber ?? doneId} recorded for {money(amount, trip.currency)}.
        </div>
        {voucherError && (
          <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {voucherError}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={voucher.isPending}
            onClick={() =>
              voucher.mutate(undefined, {
                onSuccess: (receipt) => {
                  setVoucherError('');
                  void openReceipt(receipt.id).then((message) => {
                    if (message) setVoucherError(message);
                  });
                },
                onError: () => setVoucherError('The receipt could not be generated.'),
              })
            }
          >
            <Eye className="h-4 w-4" />
            Generate &amp; view receipt
          </Button>
        </div>
        <PaymentRows payments={trip.payments} />
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        setError('');
        record.mutate(
          {
            caseId: trip.id,
            amount: amountNumber,
            currency: trip.currency,
            paymentMethod: method,
            paymentStatus: 'RECEIVED',
            receivedAt: new Date(`${receivedAt}T00:00:00`),
            referenceNumber: referenceNumber.trim() || undefined,
            bankName: bankName.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          {
            onSuccess: (created: unknown) => {
              const row = created as { id: string; paymentNumber?: string } | undefined;
              setDoneId(row?.id ?? null);
              setDoneNumber(row?.paymentNumber ?? null);
              setAmount('');
            },
            onError: (failure) =>
              setError(
                failure instanceof ApiError && failure.message
                  ? failure.message
                  : 'The payment could not be recorded.',
              ),
          },
        );
      }}
    >
      <dl className="grid grid-cols-3 gap-3">
        {[
          { label: 'Agreed', value: money(trip.tripAmount, trip.currency) },
          { label: 'Received', value: money(trip.collected, trip.currency) },
          { label: 'Outstanding', value: money(trip.outstanding, trip.currency) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {label}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <FormField
        label="Amount received"
        required
        hint={`Outstanding: ${money(trip.outstanding, trip.currency)}`}
      >
        <input
          aria-label="Amount received"
          className={inputClasses(false)}
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Payment date" required>
          <input
            aria-label="Payment date"
            type="date"
            className={inputClasses(false)}
            value={receivedAt}
            onChange={(event) => setReceivedAt(event.target.value)}
          />
        </FormField>
        <FormField label="Payment method" required>
          <select
            aria-label="Payment method"
            className={inputClasses(false)}
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethodValue)}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {labelForLookup(value)}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Reference number" hint="UPI ref, cheque no., etc.">
          <input
            aria-label="Reference number"
            className={inputClasses(false)}
            placeholder="e.g. UPI123"
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
          />
        </FormField>
        <FormField label="Bank">
          <input
            aria-label="Bank"
            className={inputClasses(false)}
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
          />
        </FormField>
      </div>
      <FormField label="Notes">
        <textarea
          aria-label="Notes"
          className={inputClasses(false)}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </FormField>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit} isLoading={record.isPending}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

/** Record-payment dialog for a lead. Resolves (or creates) the lead's payment
 * case, then records against it with the existing payments system. */
export function RecordLeadPaymentDialog({
  queryId,
  onClose,
}: {
  queryId: string;
  onClose: () => void;
}) {
  const ensure = useEnsureLeadPaymentCase();
  const [resolved, setResolved] = useState<LeadPaymentCaseState | null>(null);

  useEffect(() => {
    ensure.mutate({ queryId });
    // Resolve once per dialog open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const state = resolved ?? ensure.data;
  const trip = state?.case ?? null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Record payment"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-xl bg-brand-700 px-5 py-3 text-white">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Landmark className="h-5 w-5" /> Record Payment
          </h2>
          <button
            type="button"
            aria-label="Close record payment"
            onClick={onClose}
            className="rounded p-1 hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {state && (
            <p className="text-sm text-slate-600">
              {state.lead.customerName} · {state.lead.queryNumber}
              {state.quotation && (
                <>
                  {' '}
                  · linked {state.quotation.quotationNumber}
                  {state.quotation.finalAmount != null &&
                    ` · ${money(
                      state.quotation.finalAmount,
                      state.quotation.currency ?? trip?.currency ?? 'INR',
                    )}`}
                </>
              )}
            </p>
          )}
          {ensure.isPending && (
            <div className="h-40 animate-pulse rounded-xl bg-slate-100" aria-label="Loading" />
          )}
          {ensure.isError && (
            <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {ensure.error instanceof ApiError && ensure.error.message
                ? ensure.error.message
                : 'The payment trip could not be loaded.'}
            </div>
          )}
          {state && (state.requiresAmount || !trip) && (
            <CaseSetupForm
              queryId={queryId}
              initialTitle={state.suggestion.title}
              initialAmount={state.suggestion.tripAmount}
              initialCurrency={state.suggestion.currency}
              quotationNumber={state.suggestion.quotationNumber}
              quotationAmount={
                state.quotation?.finalAmount != null ? Number(state.quotation.finalAmount) : null
              }
              onResolved={(next) => setResolved(next)}
            />
          )}
          {state && trip && <PaymentForm trip={trip} />}
          {state && trip && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Receipts are available from each payment row on this lead and on the Payments page.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
