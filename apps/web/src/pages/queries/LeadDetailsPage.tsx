import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ClipboardList,
  FileText,
  History,
  MapPin,
  MessageSquarePlus,
  Route as RouteIcon,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  CONTACT_METHODS,
  labelForLookup,
  type ContactMethodValue,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useLeadWorkspace,
  useNoteAction,
  useNotes,
  useTimeline,
  type Lead,
} from '@/features/queries/queries.api';
import { formatTravelMonthYear, leadTravelDatesLabel } from '@/features/quotations/travel-dates';

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

/** Passenger count with optional per-child ages: "2 (ages 4, 6)", "1 (age 8)", "1 (9 months)". */
const countWithAges = (
  count: number,
  ages: Array<number | null> | null,
  unit: 'age' | 'month',
): string | null => {
  if (count <= 0) return null;
  const cleaned = (ages ?? []).filter((age): age is number => age != null && Number.isFinite(age));
  if (cleaned.length === 0) return `${count}`;
  if (unit === 'month') {
    const label = cleaned.length === 1 && cleaned[0] === 1 ? 'month' : 'months';
    return `${count} (${cleaned.join(', ')} ${label})`;
  }
  return cleaned.length === 1
    ? `${count} (age ${cleaned[0]})`
    : `${count} (ages ${cleaned.join(', ')})`;
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
 * they travel, the current stage, quotations, notes and history.
 *
 * UI-only composition over the existing workspace, notes, timeline and
 * quotation APIs. Stage changes, reassignment, payments and deletion are
 * managed outside this page — their backends are untouched. Booking,
 * Follow-ups, reminders and Priority are intentionally not rendered here.
 */
export function LeadDetailsPage() {
  const { queryId = '' } = useParams();
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
  const noteAction = useNoteAction(queryId);

  const [note, setNote] = useState('');
  const [noteIsContact, setNoteIsContact] = useState(false);
  const [contactMethod, setContactMethod] = useState<ContactMethodValue>('PHONE');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');

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
  const orderedItinerary = [...q.itinerary].sort((a, b) => a.sequence - b.sequence);
  const travellerNames = namedTravellers(q);
  const serviceLabels = q.services.map((s) => labelForLookup(s.serviceType));
  const childrenWithBedLabel = countWithAges(q.childrenWithBed, q.childrenWithBedAges, 'age');
  const childrenWithoutBedLabel = countWithAges(
    q.childrenWithoutBed,
    q.childrenWithoutBedAges,
    'age',
  );
  const infantsLabel = countWithAges(q.infants, q.infantAges, 'month');

  return (
    <div className="space-y-5">
      {/* A. Back to the Leads list */}
      <div>
        <Link
          to="/queries"
          aria-label="Back to Leads"
          title="Back to Leads"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Leads
        </Link>
      </div>

      {/* B. Lead identity */}
      <div>
        <h1 className="break-words text-2xl font-semibold text-slate-950">
          {q.customerName}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{q.queryNumber}</span>
          <span aria-hidden="true">•</span>
          <span>Created {dateTime(q.createdAt)}</span>
        </div>
      </div>

      {/* C. Section navigation */}
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

      {/* C. Lead Information — full-width contact, travel and trip view */}
      {tab === 'lead-information' && (
        <div className="min-w-0 space-y-5">
          <Section title="Contact Information" icon={UserRound}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {q.phone && <Info label="Phone">{q.phone}</Info>}
              {q.alternatePhone && <Info label="Alternate phone">{q.alternatePhone}</Info>}
              {q.email && <Info label="Email">{q.email}</Info>}
              <Info label="Lead source">{labelForLookup(q.leadSource)}</Info>
              <Info label="Lead type">{labelForLookup(q.leadType)}</Info>
              <Info label="Stage">{labelForLookup(q.leadStage)}</Info>
              <Info label="Assignee">{q.assignedTo?.fullName ?? 'Unassigned'}</Info>
              <Info label="Created by">{q.createdBy.fullName}</Info>
            </dl>
          </Section>

          <Section title="Travel Details" icon={MapPin}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {travelDateLabel !== '' && <Info label="Travel date">{travelDateLabel}</Info>}
              {q.departureCountry && (
                <Info label="Departure country">{q.departureCountry}</Info>
              )}
              {q.departureCity && <Info label="Departure city">{q.departureCity}</Info>}
              <Info label="Adults">{`${q.adults}`}</Info>
              {childrenWithBedLabel && (
                <Info label="Children with bed">{childrenWithBedLabel}</Info>
              )}
              {childrenWithoutBedLabel && (
                <Info label="Children without bed">{childrenWithoutBedLabel}</Info>
              )}
              {infantsLabel && <Info label="Infants">{infantsLabel}</Info>}
              {q.extraBeds > 0 && <Info label="Extra beds">{`${q.extraBeds}`}</Info>}
            </dl>
          </Section>
          {travellerNames.length > 0 && (
            <Section title="Traveller Names" icon={Users}>
              <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                {travellerNames.map((name) => (
                  <li key={name} className="min-w-0 break-words">
                    {name}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {serviceLabels.length > 0 && (
            <Section title="Services Required" icon={ClipboardList}>
              <ul className="flex flex-wrap gap-2">
                {serviceLabels.map((label) => (
                  <li
                    key={label}
                    className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {orderedItinerary.length > 0 && (
            <Section title="Itinerary" icon={RouteIcon}>
              <ol className="space-y-2">
                {orderedItinerary.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 p-3 text-sm"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">
                      {row.sequence}
                    </span>
                    <strong>
                      {row.destination}, {row.country}
                    </strong>
                    <span>
                      {row.nights} night{row.nights === 1 ? '' : 's'}
                    </span>
                    {row.arrivalDate && (
                      <span className="text-slate-500">
                        {new Date(row.arrivalDate).toLocaleDateString()}
                      </span>
                    )}
                    {row.notes && <span className="w-full text-slate-500">{row.notes}</span>}
                  </li>
                ))}
              </ol>
            </Section>
          )}

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
    </div>
  );
}
