import { Link } from 'react-router-dom';
import { CalendarClock, Plane, type LucideIcon } from 'lucide-react';
import { labelForLookup } from '@interscale/shared';
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

function WidgetTable({ rows, showStage }: { rows: UpcomingTravelRow[]; showStage: boolean }) {
  if (!rows.length)
    return <p className="p-4 text-sm text-slate-500">No upcoming travel.</p>;
  return (
    <div className="max-h-64 overflow-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="sticky top-0 bg-card text-xs uppercase text-slate-500">
          <tr>
            <th className="w-10 px-4 py-2">No.</th>
            <th className="px-4 py-2">Date</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Destination</th>
            {showStage && <th className="px-4 py-2">Stage</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">
                {index + 1}
              </td>
              <td className="whitespace-nowrap px-4 py-2">{formatTravelDate(row.travelDate)}</td>
              <td className="px-4 py-2 font-medium">
                <Link
                  to={`/queries/${row.id}`}
                  className="text-brand-700 hover:underline"
                  title={`Open lead ${row.customerName}`}
                >
                  {row.customerName}
                </Link>
              </td>
              <td className="px-4 py-2 text-slate-700">{row.destination}</td>
              {showStage && (
                <td className="whitespace-nowrap px-4 py-2">
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    {labelForLookup(row.leadStage)}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One Upcoming Travel card showing every future travel record — no
 * date-range filter and no View More link. `confirmed` covers leads whose
 * current stage is BOOKING_CONFIRMED; `others` covers all other stages.
 */
export function UpcomingTravelCard({ kind }: { kind: 'confirmed' | 'others' }) {
  const query = useDashboardUpcomingTravel();
  const section = query.data?.[kind];

  const isConfirmed = kind === 'confirmed';
  const Icon: LucideIcon = isConfirmed ? Plane : CalendarClock;

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
      </header>
      {query.isLoading ? (
        <div className="h-40 animate-pulse bg-card" />
      ) : query.isError ? (
        <div role="alert" className="p-4 text-center text-sm text-red-700">
          Upcoming travel could not be loaded.
        </div>
      ) : (
        <>
          <WidgetTable rows={section?.items ?? []} showStage={!isConfirmed} />
          <div className="flex items-center justify-between border-t px-4 py-2">
            <span className="text-xs text-slate-500">
              {section?.totalCount ?? 0} upcoming{' '}
              {(section?.totalCount ?? 0) === 1 ? 'trip' : 'trips'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
