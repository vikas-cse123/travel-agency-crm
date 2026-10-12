import { useState } from 'react';
import { useFieldArray, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { AlertTriangle, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cabinLuggageLabel, type LiveSearchBookmark, type QuotationVersionInput } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { BookmarkLoadField } from '@/features/quotations/BookmarkImport';
import type { Airline } from '@/features/masters/masters.api';
import {
  CLASS_OPTIONS,
  CABIN_LUGGAGE_OPTIONS,
  CHECKIN_LUGGAGE_OPTIONS,
  FLIGHT_JOURNEY_TYPE_LABELS,
  computeDuration,
  emptySegment,
  flightTimesAreChronological,
} from './QuotationBuilderPage';

// Presentation classes mirror the builder's flight editor so every flight
// card looks identical to the former single-flight section.
const field =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm h-[38px] shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring transition-colors';
const fieldMuted =
  'w-full rounded-lg bg-muted/60 border border-border/50 px-3 py-2 text-sm font-medium text-foreground h-[38px]';
const calculatedLabel = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const subsectionHeading = 'text-xs font-semibold uppercase tracking-widest text-brand-700';
const labelCls = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

export interface FlightRecordCardProps {
  flightIndex: number;
  form: UseFormReturn<QuotationVersionInput>;
  airlineList: Airline[];
  onLoadBookmarks: (flightIndex: number, bookmarks: LiveSearchBookmark[]) => void;
  onRemoveFlight: (flightIndex: number) => void;
}

/**
 * One independent flight inside the quotation Flight section: its own
 * Bookmark ID loader, journey type, and outbound/return segment editors.
 * All state lives under `flightDetails.flights[flightIndex]`, so loading,
 * editing, or removing this flight never touches another record.
 */
export function FlightRecordCard({
  flightIndex,
  form,
  airlineList,
  onLoadBookmarks,
  onRemoveFlight,
}: FlightRecordCardProps) {
  const base = `flightDetails.flights.${flightIndex}`;
  const fp = (path: string) => path as FieldPath<QuotationVersionInput>;
  const outboundSegments = useFieldArray({
    control: form.control,
    name: `${base}.outbound.segments` as 'flightDetails.flights.0.outbound.segments',
  });
  const returnSegments = useFieldArray({
    control: form.control,
    name: `${base}.returnJourney.segments` as 'flightDetails.flights.0.returnJourney.segments',
  });
  const [expandedJourneys, setExpandedJourneys] = useState<Record<string, boolean>>({
    outbound: true,
    returnJourney: true,
  });
  const [expandedSegments, setExpandedSegments] = useState<Record<string, boolean>>({});
  const journeyType = (form.watch(fp(`${base}.journeyType`)) as string) ?? 'ROUND_TRIP';
  const bookmarkCode = (form.watch(fp(`${base}.bookmarkCode`)) as string | null) ?? null;
  const showOutbound = journeyType === 'ROUND_TRIP' || journeyType === 'ONEWAY_OUTBOUND';
  const showReturn = journeyType === 'ROUND_TRIP' || journeyType === 'ONEWAY_RETURN';

  const segmentCard = (
    leg: 'outbound' | 'returnJourney',
    arr: typeof outboundSegments | typeof returnSegments,
    index: number,
    id: string,
  ) => {
    const segBase = `${base}.${leg}.segments.${index}`;
    const via =
      index > 0
        ? (form.watch(fp(`${segBase}.from`)) as string) ||
          (form.watch(fp(`${base}.${leg}.segments.${index - 1}.to`)) as string) ||
          ''
        : '';
    const departureDate = form.watch(fp(`${segBase}.departureDate`)) as string | null;
    const departureTime = form.watch(fp(`${segBase}.departureTime`)) as string | null;
    const arrivalDate = form.watch(fp(`${segBase}.arrivalDate`)) as string | null;
    const arrivalTime = form.watch(fp(`${segBase}.arrivalTime`)) as string | null;
    const computedDuration = computeDuration(departureDate, departureTime, arrivalDate, arrivalTime);
    const invalidArrival = !flightTimesAreChronological(
      departureDate,
      departureTime,
      arrivalDate,
      arrivalTime,
    );
    const segmentKey = `${leg}-${index}`;
    const isSegmentExpanded = expandedSegments[segmentKey] ?? true;
    return (
      <article key={id} className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <button
          type="button"
          onClick={() =>
            setExpandedSegments((prev) => ({ ...prev, [segmentKey]: !isSegmentExpanded }))
          }
          className="flex w-full items-center justify-between bg-muted/30 px-4 py-3 text-left hover:bg-muted/50"
        >
          <span className="flex items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${isSegmentExpanded ? 'rotate-180' : ''}`}
            />
            <strong className={`${subsectionHeading} normal-case tracking-normal`}>Segment {index + 1}</strong>
          </span>
          {index > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                arr.remove(index);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  arr.remove(index);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" /> Remove
            </span>
          )}
        </button>
        {isSegmentExpanded && (
          <div className="space-y-3 p-4">
            {index > 0 && (
          <p className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white">
            🔗 Connection{via ? `: Connected via ${via}` : ''}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-3">
          <label className={labelCls}>
            Airline <span className="text-red-500">*</span>
            <select
              aria-label="Airline"
              className={`${field} mt-1`}
              value={(form.watch(fp(`${segBase}.airlineId`)) as string) ?? ''}
              onChange={(event) => {
                const picked = airlineList.find((row) => row.id === event.target.value);
                form.setValue(fp(`${segBase}.airlineId`), (event.target.value || null) as never, {
                  shouldDirty: true,
                });
                form.setValue(fp(`${segBase}.airlineName`), (picked?.name ?? null) as never, {
                  shouldDirty: true,
                });
              }}
            >
              <option value="">Select Airline</option>
              {airlineList.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Flight Number
            <input
              placeholder="e.g. AI101"
              className={`${field} mt-1`}
              {...form.register(fp(`${segBase}.flightNumber`))}
            />
          </label>
          <label className={labelCls}>
            Class
            <select className={`${field} mt-1`} {...form.register(fp(`${segBase}.travelClass`))}>
              {CLASS_OPTIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelCls}>
            From <span className="text-red-500">*</span>
            <input className={`${field} mt-1`} {...form.register(fp(`${segBase}.from`))} />
          </label>
          <label className={labelCls}>
            To <span className="text-red-500">*</span>
            <input className={`${field} mt-1`} {...form.register(fp(`${segBase}.to`))} />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className={labelCls}>
            Departure Date
            <input
              type="date"
              className={`${field} mt-1`}
              {...form.register(fp(`${segBase}.departureDate`))}
            />
          </label>
          <label className={labelCls}>
            Departure Time
            <input
              type="time"
              lang="en-US"
              className={`${field} mt-1`}
              {...form.register(fp(`${segBase}.departureTime`))}
            />
          </label>
          <label className={labelCls}>
            Arrival Date
            <input
              type="date"
              className={`${field} mt-1`}
              {...form.register(fp(`${segBase}.arrivalDate`))}
            />
          </label>
          <label className={labelCls}>
            Arrival Time
            <input
              type="time"
              lang="en-US"
              className={`${field} mt-1`}
              {...form.register(fp(`${segBase}.arrivalTime`))}
            />
          </label>
          {invalidArrival && (
            <p
              role="alert"
              className="flex items-center gap-1 text-xs font-medium text-amber-600 md:col-span-4"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Arrival time must be after departure time.
            </p>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className={labelCls}>
            <span className={calculatedLabel}>Duration</span>
            <input
              readOnly
              placeholder="Auto-calculated"
              value={computedDuration}
              className={`${fieldMuted} mt-1`}
            />
            <span className="text-[11px] text-muted-foreground">calculated from dates</span>
          </label>
          <label className={labelCls}>
            Cabin Luggage
            <select className={`${field} mt-1`} {...form.register(fp(`${segBase}.cabinLuggage`))}>
              {CABIN_LUGGAGE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {cabinLuggageLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Check-in Luggage
            <select className={`${field} mt-1`} {...form.register(fp(`${segBase}.checkInLuggage`))}>
              {CHECKIN_LUGGAGE_OPTIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <span className={labelCls}>Additional Notes</span>
          <div className="mt-1">
            <RichTextEditor
              ariaLabel={`Segment ${index + 1} notes`}
              value={(form.watch(fp(`${segBase}.notes`)) as string) ?? ''}
              onChange={(html) =>
                form.setValue(fp(`${segBase}.notes`), html as never, { shouldDirty: true })
              }
            />
          </div>
        </div>
          </div>
        )}
      </article>
    );
  };

  const journeyBlock = (
    leg: 'outbound' | 'returnJourney',
    arr: typeof outboundSegments | typeof returnSegments,
    headerClass: string,
    title: string,
  ) => {
    const journeyBase = `${base}.${leg}`;
    const from = (form.watch(fp(`${journeyBase}.fromCity`)) as string) || '';
    const to = (form.watch(fp(`${journeyBase}.toCity`)) as string) || '';
    const isJourneyExpanded = expandedJourneys[leg] ?? true;
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            setExpandedJourneys((prev) => ({ ...prev, [leg]: !isJourneyExpanded }))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpandedJourneys((prev) => ({ ...prev, [leg]: !isJourneyExpanded }));
            }
          }}
          className={`flex cursor-pointer select-none items-center justify-between px-5 py-3 font-semibold text-white ${headerClass}`}
        >
          <span className="flex items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 text-white/80 transition-transform ${isJourneyExpanded ? 'rotate-180' : ''}`}
            />
            ✈ {title}
          </span>
          <span className="text-sm opacity-90">
            {from && to ? `${from} → ${to}` : 'Route will appear here'}
          </span>
        </div>
        {isJourneyExpanded && (
          <div className="p-5">
            <div className="space-y-4">
              {arr.fields.map((segment, index) => segmentCard(leg, arr, index, segment.id))}
            </div>
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => arr.append(emptySegment())}>
                <Plus className="h-4 w-4" /> Add Connection
              </Button>
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <article
      aria-label={`Flight ${flightIndex + 1}`}
      className="space-y-4 rounded-xl border border-border bg-muted/20 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800">
          Flight {flightIndex + 1}
          <span className="ml-2 text-xs font-medium text-slate-500">
            {bookmarkCode ? `· Loaded from ${bookmarkCode}` : '· Manual entry'}
          </span>
        </h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Remove flight ${flightIndex + 1}`}
          onClick={() => onRemoveFlight(flightIndex)}
          className="text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" /> Remove flight
        </Button>
      </div>
      <BookmarkLoadField
        type="FLIGHT"
        placeholder="FLT-000456"
        ariaLabel={`Flight ${flightIndex + 1} bookmark ID`}
        onLoaded={(bookmarks) => onLoadBookmarks(flightIndex, bookmarks)}
      />
      <label className="block max-w-md text-sm font-semibold text-slate-800">
        Journey Type <span className="text-red-500">*</span>
        <select
          aria-label={`Journey type for flight ${flightIndex + 1}`}
          className={`${field} mt-1`}
          {...form.register(fp(`${base}.journeyType`))}
        >
          {Object.entries(FLIGHT_JOURNEY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">
          Select flight direction to show relevant sections.
        </span>
      </label>
      {showOutbound && journeyBlock('outbound', outboundSegments, 'bg-brand-600', 'Outbound Journey')}
      {showReturn && journeyBlock('returnJourney', returnSegments, 'bg-emerald-600', 'Return Journey')}
    </article>
  );
}
