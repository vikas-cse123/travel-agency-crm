import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Plane, type LucideIcon } from 'lucide-react';
import {
  useDashboardUpcomingTravel,
  type UpcomingTravelRow,
} from '@/features/dashboard/dashboard.api';

/** Calendar date in en-IN medium style, matching the CRM's date display. */
function formatTravelDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function toDayParam(iso: string): string {
  return iso.slice(0, 10);
}

function WidgetTable({ rows }: { rows: UpcomingTravelRow[] }) {
  if (!rows.length)
    return <p className="p-4 text-sm text-slate-500">No upcoming travel in this period.</p>;
  return (
    <div className="max-h-64 overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">City</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap px-4 py-2">{formatTravelDate(row.travelDate)}</td>
              <td className="px-4 py-2 font-medium text-slate-900">{row.customerName}</td>
              <td className="px-4 py-2 text-slate-700">{row.city}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One Upcoming Travel card. Owns its date-range selection (Next 7 / 30 / 90
 * days, defaulting to 30, plus a custom calendar range) and fetches only its
 * half of the `upcoming-travel` response.
 */
export function UpcomingTravelCard({ kind }: { kind: 'confirmed' | 'others' }) {
  const [days, setDays] = useState<'7' | '30' | '90' | 'CUSTOM'>('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const customIncomplete = days === 'CUSTOM' && !(from && to);
  const query = useDashboardUpcomingTravel(
    days === 'CUSTOM' && from && to ? { from, to } : days === 'CUSTOM' ? { days: '30' } : { days },
  );
  const section = query.data?.[kind];
  const range = query.data?.range;

  const isConfirmed = kind === 'confirmed';
  const Icon: LucideIcon = isConfirmed ? Plane : CalendarClock;
  const viewMoreTo =
    range &&
    (isConfirmed
      ? `/queries?leadStage=BOOKING_CONFIRMED&dateType=TRAVEL_DATE&dateFrom=${toDayParam(range.from)}&dateTo=${toDayParam(range.to)}`
      : `/queries?dateType=TRAVEL_DATE&dateFrom=${toDayParam(range.from)}&dateTo=${toDayParam(range.to)}`);

  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-card">
      <header
        className={`flex items-center justify-between gap-2 px-4 py-2.5 text-white ${
          isConfirmed ? 'bg-rose-600' : 'bg-blue-600'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {isConfirmed ? 'Upcoming Travel' : 'Other Upcoming Travel'}
            </h2>
            <p className="truncate text-xs text-white/85">
              {isConfirmed
                ? 'Leads with stage = Booking Confirmed'
                : 'Leads with upcoming travel dates (all other stages)'}
            </p>
          </span>
        </span>
        <select
          aria-label={isConfirmed ? 'Confirmed travel date range' : 'Other travel date range'}
          className="shrink-0 rounded-md border border-white/40 bg-white/15 px-2 py-1.5 text-xs text-white"
          value={days}
          onChange={(event) => setDays(event.target.value as typeof days)}
        >
          <option value="7">Next 7 Days</option>
          <option value="30">Next 30 Days</option>
          <option value="90">Next 90 Days</option>
          <option value="CUSTOM">Custom Range</option>
        </select>
      </header>
      {days === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <input
            aria-label="Custom range from date"
            type="date"
            className="rounded-md border border-slate-300 bg-card px-2 py-1.5 text-sm"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            aria-label="Custom range to date"
            type="date"
            className="rounded-md border border-slate-300 bg-card px-2 py-1.5 text-sm"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      )}
      {customIncomplete ? (
        <p className="p-4 text-sm text-slate-500">Select both dates to preview a custom range.</p>
      ) : query.isLoading ? (
        <div className="h-40 animate-pulse bg-card" />
      ) : query.isError ? (
        <div role="alert" className="p-4 text-center text-sm text-red-700">
          Upcoming travel could not be loaded.
        </div>
      ) : (
        <>
          <WidgetTable rows={section?.items ?? []} />
          <div className="flex items-center justify-between border-t px-4 py-2">
            <span className="text-xs text-slate-500">
              {section?.totalCount ?? 0} upcoming{' '}
              {(section?.totalCount ?? 0) === 1 ? 'trip' : 'trips'}
            </span>
            {viewMoreTo && (
              <Link
                to={viewMoreTo}
                className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              >
                View more <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}
