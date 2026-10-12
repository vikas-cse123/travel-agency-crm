import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  History,
  Landmark,
  Mail,
  MapPin,
  MessageSquarePlus,
  Pencil,
  Phone,
  Trash2,
  UserRound,
  UserRoundCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  CONTACT_METHODS,
  PERMISSIONS,
  labelForLookup,
  type ContactMethodValue,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useDeleteLead,
  useLeadAction,
  useLeadLookups,
  useLeadWorkspace,
  useNoteAction,
  useNotes,
  useTimeline,
  type Lead,
} from '@/features/queries/queries.api';
import { formatTravelMonthYear, leadTravelDatesLabel } from '@/features/quotations/travel-dates';
import { useLeadPaymentCase } from '@/features/payments/payments.api';
import { LeadPaymentsCard, RecordLeadPaymentDialog } from './LeadPayments';

const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

/** Labelled read-only fact used across the sales summary cards. */
const Info = ({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) => (
  <div className="min-w-0">
    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-1 flex min-w-0 items-start gap-2 text-sm font-medium text-slate-900">
      {icon && <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>}
      <span className="min-w-0 break-words">{children || '—'}</span>
    </dd>
  </div>
);

/** Consistent card shell for every section of the sales workspace. */
const Section = ({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-950">
        <Icon className="h-4 w-4 text-brand-600" aria-hidden="true" />
        {title}
      </h2>
      {action}
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

const TABS = [
  ['lead-information', 'Lead Information'],
  ['quotations', 'Quotations'],
  ['notes', 'Notes'],
  ['timeline', 'Timeline'],
] as const;
type TabKey = (typeof TABS)[number][0];

const formatMoney = (value: string | number | null | undefined, currency = 'INR'): string => {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
  } catch {
    return String(amount);
  }
};

const travellerCountLabel = (lead: Lead): string => {
  const parts: string[] = [];
  if (lead.adults > 0) parts.push(`${lead.adults} Adult${lead.adults === 1 ? '' : 's'}`);
  if (lead.childrenWithBed > 0) parts.push(`${lead.childrenWithBed} Child with Bed`);
  if (lead.childrenWithoutBed > 0) parts.push(`${lead.childrenWithoutBed} Child without Bed`);
  if (lead.infants > 0) parts.push(`${lead.infants} Infant${lead.infants === 1 ? '' : 's'}`);
  if (lead.rooms > 0) parts.push(`${lead.rooms} Room${lead.rooms === 1 ? '' : 's'}`);
  return parts.join(' · ');
};

/** Named travellers collected on the lead form, kept positional per category. */
const namedTravellers = (lead: Lead): string[] => {
  const names: string[] = [];
  const collect = (list: Array<string | null> | null, category: string) => {
    (list ?? []).forEach((name, index) => {
      const cleaned = (name ?? '').trim();
      if (cleaned) names.push(`${category} ${index + 1}: ${cleaned}`);
    });
  };
  collect(lead.adultNames, 'Adult');
  collect(lead.childWithBedNames, 'Child With Bed');
  collect(lead.childWithoutBedNames, 'Child Without Bed');
  collect(lead.infantNames, 'Infant');
  return names;
};

/**
 * Lead sales workspace: who the lead is, how to reach them, where and when
 * they travel, the current stage, quotations, collected money and history.
 *
 * UI-only composition over the existing workspace, notes, timeline, payments
 * and quotation APIs. Booking, Follow-ups, reminders and Priority are
 * intentionally not rendered here — their backends are untouched.
 */
export function LeadDetailsPage() {
  const { queryId = '' } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (
    TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'lead-information'
  ) as TabKey;
  const setTab = (next: TabKey) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  };

  const workspace = useLeadWorkspace(queryId);
  const notes = useNotes(queryId);
  const timeline = useTimeline(queryId);
  const lookups = useLeadLookups();
  const action = useLeadAction(queryId);
  const remove = useDeleteLead(queryId);
  const noteAction = useNoteAction(queryId);

  const canViewPayments = hasPermission(PERMISSIONS.PAYMENTS_VIEW);
  const canRecordPayment = hasPermission(PERMISSIONS.PAYMENTS_CREATE);
  // Pure read of the server-resolved payment case; never creates anything.
  const paymentCase = useLeadPaymentCase(queryId, canViewPayments);

  const [stage, setStage] = useState('');
  const [stageReason, setStageReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [noteIsContact, setNoteIsContact] = useState(false);
  const [contactMethod, setContactMethod] = useState<ContactMethodValue>('PHONE');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  if (workspace.isLoading) return <div className="h-96 animate-pulse rounded-xl bg-card" />;
  if (workspace.isError || !workspace.data)
    return (
      <div className="rounded-xl bg-card p-12 text-center">
        <h1 className="text-xl font-semibold">Lead unavailable</h1>
        <p className="mt-2 text-slate-500">It may not exist or is outside your visibility scope.</p>
        <Link className="mt-4 inline-block text-brand-700" to="/queries">
          Back to leads
        </Link>
      </div>
    );

  const q = workspace.data.lead;
  const allowed = workspace.data.permissions;
  const dateTime = (value: string) =>
    new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
      timeZone: workspace.data.timezone,
    }).format(new Date(value));

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/queries');
  };

  const trip = paymentCase.data?.case ?? null;
  const latestQuotation =
    workspace.data.quotations.latest ?? workspace.data.quotations.items[0] ?? null;
  const latestVersion = latestQuotation?.versions[0] ?? null;

  const travelDateLabel =
    [
      leadTravelDatesLabel(
        q.travelStartDate,
        q.travelEndDate,
        q.itinerary.length
          ? q.itinerary.reduce((sum, row) => sum + row.nights, 0) + 1
          : undefined,
      ),
      formatTravelMonthYear(q.travelMonth, q.travelYear),
    ]
      .filter(Boolean)
      .join(' • ') || '';
  const monthYearLabel = formatTravelMonthYear(q.travelMonth, q.travelYear) ?? '';
  const orderedItinerary = [...q.itinerary].sort((a, b) => a.sequence - b.sequence);
  const countsLabel = travellerCountLabel(q);
  const travellerNames = namedTravellers(q);
  const serviceLabels = q.services.map((s) => labelForLookup(s.serviceType));
  const hasTravelData =
    travelDateLabel !== '' ||
    monthYearLabel !== '' ||
    (q.departureCountry ?? '') !== '' ||
    (q.departureCity ?? '') !== '' ||
    orderedItinerary.length > 0 ||
    countsLabel !== '' ||
    serviceLabels.length > 0;
  const hasCommercialData =
    latestVersion != null ||
    Boolean(q.expectedAmount) ||
    Boolean(q.budgetMin) ||
    Boolean(q.budgetMax) ||
    Boolean(q.expectedMargin) ||
    (canViewPayments && trip != null && trip.paymentCount > 0);

  return (
    <div className="space-y-5">
      {/* A. Compact lead header */}
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={handleBack}
            className="shrink-0 rounded-lg p-2 hover:bg-slate-50"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Lead details
            </p>
            <h1 className="mt-1 break-words text-2xl font-semibold text-slate-950">
              {q.customerName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{q.queryNumber}</span>
              <span aria-hidden="true">•</span>
              <span>Created {dateTime(q.createdAt)}</span>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700">
                {labelForLookup(q.leadStage)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {q.phone && (
                <a
                  href={`tel:${q.phone.replace(/\s+/g, '')}`}
                  className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {q.phone}
                </a>
              )}
              {q.email && (
                <a
                  href={`mailto:${q.email}`}
                  className="inline-flex min-w-0 items-center gap-1.5 font-medium text-brand-700 hover:underline"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="break-all">{q.email}</span>
                </a>
              )}
            </div>
            {q.customer && (
              <span className="mt-2 inline-block text-xs font-medium text-slate-500">
                {q.customer.customerNumber} customer record
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:pl-11 lg:pl-0">
          {canRecordPayment && (
            <Button onClick={() => setPayOpen(true)}>
              <Landmark className="h-4 w-4" />
              Record Payment
            </Button>
          )}
          {allowed.canEdit && (
            <Link to={`/queries/${q.id}/edit`}>
              <Button variant="secondary">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
          {allowed.canDelete && (
            <Button
              variant="danger"
              isLoading={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently delete lead ${q.queryNumber}? This cannot be undone.`,
                  )
                ) {
                  remove.mutate(undefined, { onSuccess: () => navigate('/queries') });
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete Lead
            </Button>
          )}
        </div>
      </header>

      {/* B. Section navigation */}
      <nav
        className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1"
        aria-label="Lead sections"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              tab === key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* C. Lead Information — unified contact, travel and commercial view */}
      {tab === 'lead-information' && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <Section title="Contact & Lead" icon={UserRound}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Info label="Lead source">{labelForLookup(q.leadSource)}</Info>
                <Info label="Assignee">{q.assignedTo?.fullName ?? 'Unassigned'}</Info>
                {q.lastContactedAt && (
                  <Info label="Last contacted">{dateTime(q.lastContactedAt)}</Info>
                )}
              </dl>
            </Section>

            {hasTravelData && (
              <Section title="Travel Details" icon={MapPin}>
                <div className="space-y-5">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    {travelDateLabel !== '' && <Info label="Dates">{travelDateLabel}</Info>}
                    {monthYearLabel !== '' && (
                      <Info label="Travel month">{monthYearLabel}</Info>
                    )}
                    {q.departureCountry && (
                      <Info label="Departure country">{q.departureCountry}</Info>
                    )}
                    {q.departureCity && <Info label="Departure city">{q.departureCity}</Info>}
                    {countsLabel !== '' && (
                      <Info label="Travellers" icon={<Users className="h-4 w-4" />}>
                        {countsLabel}
                      </Info>
                    )}
                    {serviceLabels.length > 0 && (
                      <Info label="Services">{serviceLabels.join(', ')}</Info>
                    )}
                    {q.tripType && <Info label="Trip type">{q.tripType}</Info>}
                  </dl>
                  {travellerNames.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Traveller names</h3>
                      <ul className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                        {travellerNames.map((name) => (
                          <li key={name} className="rounded-lg bg-slate-50 px-3 py-2">
                            {name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {orderedItinerary.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Destinations</h3>
                      <div className="mt-2 space-y-2">
                        {orderedItinerary.map((row) => (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">
                              {row.sequence}
                            </span>
                            <strong>
                              {row.destination}, {row.country}
                            </strong>
                            <span>{row.nights} nights</span>
                            <span className="text-slate-500">
                              {row.arrivalDate
                                ? new Date(row.arrivalDate).toLocaleDateString()
                                : 'Dates open'}
                            </span>
                            {row.notes && (
                              <span className="w-full text-slate-500">{row.notes}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {hasCommercialData && (
              <Section title="Commercial Information" icon={Wallet}>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {latestVersion && latestQuotation && (
                    <Info label="Latest quotation">
                      <Link
                        className="text-brand-700 hover:underline"
                        to={`/quotations/${latestQuotation.id}`}
                      >
                        {latestQuotation.quotationNumber}
                      </Link>{' '}
                      · {formatMoney(latestVersion.finalAmount, latestVersion.currency)}
                    </Info>
                  )}
                  {q.expectedAmount && (
                    <Info label="Expected amount">
                      {formatMoney(q.expectedAmount, q.currency)}
                    </Info>
                  )}
                  {(q.budgetMin || q.budgetMax) && (
                    <Info label="Budget">
                      {`${formatMoney(q.budgetMin ?? q.budgetMax, q.currency)} – ${formatMoney(q.budgetMax ?? q.budgetMin, q.currency)}`}
                    </Info>
                  )}
                  {q.expectedMargin && (
                    <Info label="Expected margin">
                      {formatMoney(q.expectedMargin, q.currency)}
                    </Info>
                  )}
                  {canViewPayments && trip && trip.paymentCount > 0 && (
                    <Info label="Collected">{formatMoney(trip.collected, trip.currency)}</Info>
                  )}
                  {canViewPayments && trip && trip.tripAmount != null && trip.paymentCount > 0 && (
                    <Info label="Outstanding">
                      {formatMoney(trip.outstanding, trip.currency)}
                    </Info>
                  )}
                </dl>
              </Section>
            )}
          </div>

          <aside className="min-w-0 space-y-5">
            <section className="rounded-xl border bg-card shadow-sm">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold text-slate-950">Lead actions</h2>
                <p className="mt-0.5 text-xs text-slate-500">Update ownership and progress</p>
              </div>
              <div className="p-4">
                {allowed.canChangeStage && (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="lead-stage" className="text-sm font-medium text-slate-700">
                        Change stage
                      </label>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Current:{' '}
                        <span className="font-medium text-slate-700">
                          {labelForLookup(q.leadStage)}
                        </span>
                      </p>
                    </div>
                    <select
                      id="lead-stage"
                      aria-label="New stage"
                      className={inputClass}
                      value={stage}
                      onChange={(e) => setStage(e.target.value)}
                    >
                      <option value="">Change stage…</option>
                      {(lookups.data?.leadStages ?? []).map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {['LOST', 'CANCELLED', 'INVALID'].includes(stage) && (
                      <input
                        aria-label="Stage reason"
                        className={inputClass}
                        placeholder="Reason required"
                        value={stageReason}
                        onChange={(e) => setStageReason(e.target.value)}
                      />
                    )}
                    <Button
                      fullWidth
                      disabled={
                        !stage ||
                        (['LOST', 'CANCELLED', 'INVALID'].includes(stage) && !stageReason)
                      }
                      isLoading={action.isPending}
                      onClick={() =>
                        action.mutate(
                          {
                            path: 'stage',
                            body: {
                              stage,
                              reason: stageReason || undefined,
                              lostReason: stage === 'LOST' ? stageReason : undefined,
                            },
                          },
                          {
                            onSuccess: () => {
                              setStage('');
                              setStageReason('');
                            },
                          },
                        )
                      }
                    >
                      Update stage
                    </Button>
                  </div>
                )}
                {allowed.canAssign && (
                  <div className="mt-5 border-t pt-4">
                    <label className="text-sm font-medium text-slate-700">Reassign lead</label>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Current: {q.assignedTo?.fullName ?? 'Unassigned'}
                    </p>
                    <select
                      className={`${inputClass} mt-2`}
                      value={assignee || q.assignedToId || ''}
                      onChange={(e) => setAssignee(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {lookups.data?.assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                    </select>
                    <Button
                      className="mt-2"
                      fullWidth
                      variant="secondary"
                      onClick={() =>
                        action.mutate({
                          path: 'assignment',
                          body: { assignedToId: assignee || null, movePendingFollowUps: true },
                        })
                      }
                    >
                      <UserRoundCog className="h-4 w-4" />
                      Assign
                    </Button>
                  </div>
                )}
                {!allowed.canChangeStage && !allowed.canAssign && (
                  <p className="text-sm text-slate-500">No lead actions are available.</p>
                )}
              </div>
            </section>
            <LeadPaymentsCard queryId={q.id} onRecord={() => setPayOpen(true)} />
          </aside>
        </div>
      )}

      {/* D. Quotations */}
      {tab === 'quotations' &&
        (allowed.canViewQuotations ? (
          <Section
            title="Quotations"
            icon={FileText}
            action={
              allowed.canCreateQuotation ? (
                <Link to={`/queries/${q.id}/quotations/new`}>
                  <Button>Create quotation</Button>
                </Link>
              ) : undefined
            }
          >
            <p className="text-sm text-slate-500">
              {workspace.data.quotations.count} customer quotation
              {workspace.data.quotations.count === 1 ? '' : 's'} linked to this lead.
            </p>
            {workspace.data.quotations.items.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">Quotation</th>
                      <th className="py-2 pr-4">Version</th>
                      <th className="py-2 pr-4">Final amount</th>
                      <th className="py-2 pr-4">Last sent</th>
                      <th className="py-2 pr-4">Last viewed</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {workspace.data.quotations.items.map((quotation) => {
                      const version = quotation.versions[0];
                      return (
                        <tr key={quotation.id}>
                          <td className="py-3 pr-4">
                            <Link
                              className="font-medium text-brand-700"
                              to={`/quotations/${quotation.id}`}
                            >
                              {quotation.quotationNumber}
                            </Link>
                          </td>
                          <td className="py-3 pr-4">
                            {version ? `v${version.versionNumber}` : '—'}
                          </td>
                          <td className="py-3 pr-4">
                            {version
                              ? new Intl.NumberFormat('en-IN', {
                                  style: 'currency',
                                  currency: version.currency,
                                }).format(Number(version.finalAmount))
                              : '—'}
                          </td>
                          <td className="py-3 pr-4">
                            {quotation.lastSentAt ? dateTime(quotation.lastSentAt) : '—'}
                          </td>
                          <td className="py-3 pr-4">
                            {quotation.lastViewedAt ? dateTime(quotation.lastViewedAt) : '—'}
                          </td>
                          <td className="py-3">
                            {quotation.booking ? (
                              <Link
                                className="text-emerald-700"
                                to={`/bookings/${quotation.booking.id}`}
                              >
                                View booking
                              </Link>
                            ) : quotation.status === 'ACCEPTED' && allowed.canConvertBooking ? (
                              <Link
                                className="text-emerald-700"
                                to={`/quotations/${quotation.id}/convert-to-booking`}
                              >
                                Convert to booking
                              </Link>
                            ) : (
                              <Link className="text-slate-600" to={`/quotations/${quotation.id}`}>
                                Open
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No quotations yet for this lead.</p>
            )}
          </Section>
        ) : (
          <Section title="Quotations" icon={FileText}>
            <p className="text-sm text-slate-500">You do not have permission to view quotations.</p>
          </Section>
        ))}

      {/* F. Notes */}
      {tab === 'notes' && (
        <Section title="Notes" icon={MessageSquarePlus}>
          {allowed.canAddNote && (
            <div>
              <textarea
                aria-label="New note"
                className={inputClass}
                rows={3}
                placeholder="Add a private lead note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={noteIsContact}
                  onChange={(event) => setNoteIsContact(event.target.checked)}
                />
                This note records customer contact
              </label>
              {noteIsContact && (
                <select
                  aria-label="Contact method"
                  className={`${inputClass} mt-2`}
                  value={contactMethod}
                  onChange={(event) => setContactMethod(event.target.value as ContactMethodValue)}
                >
                  {CONTACT_METHODS.map((value) => (
                    <option key={value} value={value}>
                      {labelForLookup(value)}
                    </option>
                  ))}
                </select>
              )}
              <Button
                className="mt-2"
                size="sm"
                disabled={!note.trim()}
                isLoading={noteAction.isPending}
                onClick={() =>
                  noteAction.mutate(
                    {
                      content: note,
                      isCustomerContact: noteIsContact,
                      contactMethod: noteIsContact ? contactMethod : null,
                    },
                    {
                      onSuccess: () => {
                        setNote('');
                        setNoteIsContact(false);
                      },
                    },
                  )
                }
              >
                Add note
              </Button>
            </div>
          )}
          <div className="mt-4 space-y-3">
            {notes.data?.map((item) => (
              <article key={item.id} className="rounded-lg bg-slate-50 p-3">
                {editingNoteId === item.id ? (
                  <div className="space-y-2">
                    <textarea
                      aria-label={`Edit note ${item.id}`}
                      className={inputClass}
                      rows={3}
                      value={editingNoteText}
                      onChange={(event) => setEditingNoteText(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!editingNoteText.trim()}
                        isLoading={noteAction.isPending}
                        onClick={() =>
                          noteAction.mutate(
                            {
                              noteId: item.id,
                              content: editingNoteText,
                              isCustomerContact: item.isCustomerContact,
                              contactMethod: item.contactMethod as ContactMethodValue | null,
                            },
                            {
                              onSuccess: () => {
                                setEditingNoteId(null);
                                setEditingNoteText('');
                              },
                            },
                          )
                        }
                      >
                        Save note
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingNoteId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  {item.authorUser.fullName} · {dateTime(item.createdAt)}
                  {item.isCustomerContact &&
                    ` · ${labelForLookup(item.contactMethod ?? 'OTHER')} contact`}
                </p>
                {hasPermission('queries.update') && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button
                      className="text-brand-700"
                      onClick={() => {
                        setEditingNoteId(item.id);
                        setEditingNoteText(item.content);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-red-700"
                      onClick={() => {
                        if (window.confirm('Delete this note?'))
                          noteAction.mutate({ noteId: item.id, remove: true });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </Section>
      )}

      {/* G. Timeline */}
      {tab === 'timeline' && (
        <Section title="Timeline" icon={History}>
          {timeline.isLoading ? (
            <div className="h-32 animate-pulse rounded bg-slate-100" />
          ) : (timeline.data?.data ?? []).length > 0 ? (
            <ul className="space-y-4">
              {(timeline.data?.data ?? [])
                .filter(
                  (entry, index, all) =>
                    all.findIndex(
                      (other) => other.id === entry.id && other.type === entry.type,
                    ) === index,
                )
                .map((entry) => (
                  <li
                    key={`${entry.type}-${entry.id}`}
                    className="relative border-l-2 border-slate-200 pl-4"
                  >
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-brand-500" />
                    <p className="text-sm font-medium">{entry.title}</p>
                    {entry.description && (
                      <p className="text-sm text-slate-600">{entry.description}</p>
                    )}
                    <p className="text-xs text-slate-400">
                      {entry.actor?.fullName ?? 'System'} · {dateTime(entry.timestamp)}
                    </p>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No timeline events yet.</p>
          )}
        </Section>
      )}
      {payOpen && <RecordLeadPaymentDialog queryId={q.id} onClose={() => setPayOpen(false)} />}
    </div>
  );
}
