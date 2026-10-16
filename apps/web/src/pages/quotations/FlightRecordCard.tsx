import { useState } from 'react';
import { useFieldArray, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { AlertTriangle, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { cabinLuggageLabel, type LiveSearchBookmark, type QuotationVersionInput } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { TimePicker } from '@/components/ui/TimePicker';
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
// Compact inputs/controls that sit on the blue/green journey headers.
const routeEditInput =
  'w-28 select-text rounded-md border border-white/40 bg-white/15 px-2 py-1 text-sm font-medium text-white placeholder:text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:w-36';
const routeEditButton =
  'rounded p-1 text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

export interface FlightRecordCardProps {
  flightIndex: number;
  form: UseFormReturn<QuotationVersionInput>;
  airlineList: Airline[];
  onLoadBookmarks: (flightIndex: number, bookmarks: LiveSearchBookmark[]) => void;
  onRemoveFlight: (flightIndex: number) => void;
  /** Reports expand/collapse so the live preview can follow the edited flight. */
  onExpandChange?: ((flightIndex: number, expanded: boolean) => void) | undefined;
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
  onExpandChange,
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
  // Inline route editor state per journey leg ({ from, to } draft) — null
  // when not editing. The header route is an independent journey value
  // (`routeFrom`/`routeTo`, falling back to `fromCity`/`toCity` while those
  // are absent on legacy data): committing writes those two fields alone.
  // Segments and fromCity/toCity are never touched by a header edit, and
  // segment edits never rewrite an initialized header route.
  const [editingRoute, setEditingRoute] = useState<{
    leg: 'outbound' | 'returnJourney';
    from: string;
    to: string;
  } | null>(null);
  // Each flight card collapses independently. Expanded initially; collapsing
  // only unmounts the body (react-hook-form retains the values).
  const [expanded, setExpanded] = useState(true);
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
    const isFirstSegment = index === 0;
    const isLastSegment = index === arr.fields.length - 1;
    const fromRegistration = form.register(fp(`${segBase}.from`));
    const toRegistration = form.register(fp(`${segBase}.to`));
    // Removing the last segment promotes the new last segment's To to the
    // journey destination metadata (toCity); removing any other segment
    // cannot change either endpoint (index 0 has no remove control, so the
    // origin is untouched). The independent header route is never rewritten
    // by segment removal.
    const removeSegment = (removeIndex: number) => {
      const count = arr.fields.length;
      arr.remove(removeIndex);
      if (removeIndex === count - 1 && count > 1) {
        const promotedTo = form.getValues(
          fp(`${base}.${leg}.segments.${count - 2}.to`),
        ) as string | null;
        form.setValue(fp(`${base}.${leg}.toCity`), ((promotedTo ?? '') as string) as never, {
          shouldDirty: true,
        });
      }
    };
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
                removeSegment(index);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  removeSegment(index);
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
        {/* From and To each occupy their own full-width row. */}
        <label className={labelCls}>
          From <span className="text-red-500">*</span>
          <input
            className={`${field} mt-1`}
            {...fromRegistration}
            onChange={(event) => {
              void fromRegistration.onChange(event);
              // The first segment's From tracks the journey origin metadata
              // (fromCity). The displayed header route is independent: once
              // initialized it is never rewritten by segment edits.
              if (isFirstSegment) {
                form.setValue(
                  fp(`${base}.${leg}.fromCity`),
                  event.target.value as never,
                  { shouldDirty: true },
                );
              }
            }}
          />
        </label>
        <label className={labelCls}>
          To <span className="text-red-500">*</span>
          <input
            className={`${field} mt-1`}
            {...toRegistration}
            onChange={(event) => {
              void toRegistration.onChange(event);
              // The last segment's To tracks the journey destination
              // metadata (toCity). The displayed header route is independent
              // and never rewritten by segment edits.
              if (isLastSegment) {
                form.setValue(
                  fp(`${base}.${leg}.toCity`),
                  event.target.value as never,
                  { shouldDirty: true },
                );
              }
            }}
          />
        </label>
        {/* Departure Date + Time on one row; Arrival Date + Time on the next. */}
        <div className="grid gap-3 md:grid-cols-2">
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
            <span className="mt-1 block">
              <TimePicker
                ariaLabel="Departure Time"
                className={field}
                value={(form.watch(fp(`${segBase}.departureTime`)) as string | null) ?? null}
                onChange={(next) =>
                  form.setValue(fp(`${segBase}.departureTime`), next as never, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </span>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
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
            <span className="mt-1 block">
              <TimePicker
                ariaLabel="Arrival Time"
                className={field}
                value={(form.watch(fp(`${segBase}.arrivalTime`)) as string | null) ?? null}
                onChange={(next) =>
                  form.setValue(fp(`${segBase}.arrivalTime`), next as never, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </span>
          </label>
        </div>
        {invalidArrival && (
          <p role="alert" className="flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" /> Arrival time must be after departure time.
          </p>
        )}
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
    // Independent header route: initialized once from the journey endpoints,
    // afterwards edited only through the pencil editor below. The fromCity /
    // toCity fallback keeps legacy (route-less) journeys readable without
    // ever overwriting a configured route.
    const from =
      ((form.watch(fp(`${journeyBase}.routeFrom`)) as string) ||
      (form.watch(fp(`${journeyBase}.fromCity`)) as string) ||
      '');
    const to =
      ((form.watch(fp(`${journeyBase}.routeTo`)) as string) ||
      (form.watch(fp(`${journeyBase}.toCity`)) as string) ||
      '');
    const isJourneyExpanded = expandedJourneys[leg] ?? true;
    const isEditingRoute = editingRoute?.leg === leg;
    const routeFieldLabel = (end: 'origin' | 'destination') =>
      `Flight ${flightIndex + 1} ${title} ${end}`;
    const openRouteEditor = () => setEditingRoute({ leg, from, to });
    const cancelRouteEdit = () => setEditingRoute(null);
    // Committing writes the independent journey route alone. Segments,
    // fromCity/toCity, and every other flight field are left untouched.
    const commitRouteEdit = () => {
      if (!editingRoute || editingRoute.leg !== leg) return;
      form.setValue(fp(`${journeyBase}.routeFrom`), editingRoute.from as never, {
        shouldDirty: true,
      });
      form.setValue(fp(`${journeyBase}.routeTo`), editingRoute.to as never, {
        shouldDirty: true,
      });
      setEditingRoute(null);
    };
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
          className={`flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-3 font-semibold text-white ${headerClass}`}
        >
          <span className="flex shrink-0 items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 text-white/80 transition-transform ${isJourneyExpanded ? 'rotate-180' : ''}`}
            />
            ✈ {title}
          </span>
          {isEditingRoute && editingRoute ? (
            <span
              className="flex min-w-0 items-center gap-1.5 text-sm"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                // Save when focus leaves both fields (tabbing between them
                // keeps the editor open).
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  commitRouteEdit();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  cancelRouteEdit();
                } else if (e.key === 'Enter') {
                  // Save instead of submitting the builder form.
                  e.preventDefault();
                  e.stopPropagation();
                  commitRouteEdit();
                } else if (e.key === ' ') {
                  // Let spaces type normally without toggling the journey.
                  e.stopPropagation();
                }
              }}
            >
              <input
                aria-label={routeFieldLabel('origin')}
                autoFocus
                placeholder="Origin"
                value={editingRoute.from}
                onChange={(e) =>
                  setEditingRoute({ leg, from: e.target.value, to: editingRoute.to })
                }
                className={routeEditInput}
              />
              <span aria-hidden="true" className="shrink-0 text-white/80">
                →
              </span>
              <input
                aria-label={routeFieldLabel('destination')}
                placeholder="Destination"
                value={editingRoute.to}
                onChange={(e) =>
                  setEditingRoute({ leg, from: editingRoute.from, to: e.target.value })
                }
                className={routeEditInput}
              />
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm opacity-90">
              <span className="truncate">
                {from && to ? `${from} → ${to}` : 'Route will appear here'}
              </span>
              <button
                type="button"
                aria-label={`Edit ${title} route`}
                onClick={(e) => {
                  e.stopPropagation();
                  openRouteEditor();
                }}
                onKeyDown={(e) => {
                  // Keep Enter/Space on the pencil from toggling the journey.
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
                className={routeEditButton}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
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
        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            onExpandChange?.(flightIndex, next);
          }}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} flight ${flightIndex + 1}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
          <span className="truncate text-sm font-bold text-slate-800">
            Flight Details {flightIndex + 1}
            {bookmarkCode ? (
              <span className="ml-2 text-xs font-medium text-slate-500">
                {`· Loaded from ${bookmarkCode}`}
              </span>
            ) : null}
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Remove flight ${flightIndex + 1}`}
          title={`Remove flight ${flightIndex + 1}`}
          onClick={() => onRemoveFlight(flightIndex)}
          className="text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {/* Collapsing hides the body with CSS (rather than unmounting) so
          every entered value — including local input state — survives. */}
      <div
        data-testid={`flight-${flightIndex + 1}-body`}
        className={expanded ? 'space-y-4' : 'hidden'}
      >
        <BookmarkLoadField
          type="FLIGHT"
          label="Bookmark ID"
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
      </div>
    </article>
  );
}
