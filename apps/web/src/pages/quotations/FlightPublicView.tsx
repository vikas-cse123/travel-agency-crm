import { ExternalLink, Plane } from 'lucide-react';
import { cabinLuggageLabel, flightRecordPrefix, normalizeFlightDetails } from '@interscale/shared';
import { formatTime12Hour } from '@/utils/dateTime';
import { wrapOrphanListItems } from '@/utils/richTextPaste';
import type { FlightJourney } from '@/features/quotations/quotations.api';

/**
 * Shared customer-facing flight rendering, used by both the public quotation
 * weblink and the Quotation Builder's live weblink preview. A single
 * implementation keeps the preview faithful: layout, typography, colors,
 * labels, ordering, and omission rules are identical in both places.
 */

/** Staff-authored rich text, defanged before it reaches the customer's browser. */
export const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');

export function RichHtml({ html }: { html: string }) {
  return (
    <div
      className="weblink-rich-text rich-text-content min-w-0 max-w-full text-sm leading-relaxed text-[#000000] [overflow-wrap:anywhere] [&_a]:text-blue-600 [&_a]:underline [&_code]:whitespace-pre-wrap [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(wrapOrphanListItems(html)) }}
    />
  );
}

export const dateShort = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(
        new Date(value),
      )
    : null;

export function SectionTitle({ children }: { children: string }) {
  return (
    <h2
      id={`section-${children
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}`}
      data-section-title={children}
      className="mb-4 scroll-mt-24 border-l-4 pl-3 text-2xl font-bold text-[#000000]"
      style={{ borderColor: '#16a34a' }}
    >
      {children}
    </h2>
  );
}

export interface FlightLeg {
  key: string;
  title: string;
  journey: FlightJourney;
  color: string;
}

interface FlightDetailsLike {
  include?: boolean | null;
  entryMode?: string | null;
  sectionTitle?: string | null | undefined;
  flights?: unknown;
  outbound?: unknown;
  returnJourney?: unknown;
  journeyType?: unknown;
  bookmarkCode?: unknown;
}

/**
 * Ordered outbound/return journey legs for the customer-facing flight
 * section, following the public weblink rules: every flight record in order,
 * each with its own journeys; multi-flight quotations prefix titles with
 * `Flight N · `. IMAGE-mode and excluded sections yield no legs.
 */
export function buildFlightLegs(flightDetails: unknown): FlightLeg[] {
  const fd = (flightDetails ?? {}) as FlightDetailsLike;
  if (!fd || !fd.include || fd.entryMode === 'IMAGE') return [];
  const flightRecords = (
    (normalizeFlightDetails(fd) as { flights?: unknown } | null)?.flights ?? []
  ) as Array<{
    bookmarkCode?: string | null;
    journeyType?: string;
    outbound?: unknown;
    returnJourney?: unknown;
  }>;
  if (!Array.isArray(flightRecords)) return [];
  return flightRecords.flatMap((flight, flightIndex) => {
    const record = (flight ?? {}) as NonNullable<(typeof flightRecords)[number]>;
    const prefix = flightRecordPrefix(flightIndex, flightRecords.length);
    return ([
      (record.journeyType === 'ROUND_TRIP' || record.journeyType === 'ONEWAY_OUTBOUND') && {
        key: `flight-${flightIndex}-outbound`,
        title: `${prefix}Outbound Journey`,
        journey: (record.outbound ?? { segments: [] }) as FlightJourney,
        color: '#2563eb',
      },
      (record.journeyType === 'ROUND_TRIP' || record.journeyType === 'ONEWAY_RETURN') && {
        key: `flight-${flightIndex}-return`,
        title: `${prefix}Return Journey`,
        journey: (record.returnJourney ?? { segments: [] }) as FlightJourney,
        color: '#16a34a',
      },
    ].filter(Boolean) as FlightLeg[]);
  });
}

/**
 * Display route for one journey: the independently edited header route when
 * present, otherwise the journey endpoints (legacy quotations). Exported for
 * focused tests; the builder header, live preview, and weblink all read
 * through this single rule.
 */
export function journeyRoute(journey: {
  routeFrom?: string | null;
  routeTo?: string | null;
  fromCity?: string | null;
  toCity?: string | null;
}): string {
  return [journey.routeFrom ?? journey.fromCity, journey.routeTo ?? journey.toCity]
    .filter(Boolean)
    .join(' → ');
}

/** True when a segment carries anything the weblink would display. */
export function flightSegmentHasData(segment: {
  airlineName?: string | null;
  from?: string | null;
  to?: string | null;
  departureTime?: string | null;
  flightNumber?: string | null;
}): boolean {
  return Boolean(
    segment.airlineName || segment.from || segment.to || segment.departureTime || segment.flightNumber,
  );
}

/** A single flight journey (outbound or return) rendered as timeline cards. */
export function FlightJourneyView({
  title,
  journey,
  color,
  airlinePresentations,
}: {
  title: string;
  journey: FlightJourney;
  color: string;
  airlinePresentations?: Record<string, { name: string; logoUrl: string | null }> | undefined;
}) {
  const segments = (journey.segments ?? []).filter(
    (s) => s.airlineName || s.from || s.to || s.departureTime || s.flightNumber,
  );
  if (!segments.length) return null;
  const route = journeyRoute(journey);
  return (
    <section className="overflow-hidden rounded-xl border shadow-sm">
      <div
        className="flex flex-wrap items-center gap-2 px-5 py-3 font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        <Plane className="h-5 w-5" /> {title}
        {route && <span className="text-sm font-normal opacity-90">{route}</span>}
      </div>
      <div className="space-y-4 p-4">
        {segments.map((s, i) => {
          const airline = s.airlineId ? airlinePresentations?.[s.airlineId] : undefined;
          const airlineName = s.airlineName || airline?.name || 'Airline';
          return (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    Segment {i + 1}
                  </span>
                  {airline?.logoUrl ? (
                    <img
                      src={airline.logoUrl}
                      alt={`${airlineName} logo`}
                      className="h-8 w-12 rounded bg-white object-contain"
                    />
                  ) : (
                    <Plane className="h-4 w-4" style={{ color }} />
                  )}
                  <strong className="text-[#000000]">{airlineName}</strong>
                  {s.flightNumber && <span className="text-[#000000]">{s.flightNumber}</span>}
                </div>
                {s.travelClass && (
                  <span className="text-sm font-medium text-[#000000]">{s.travelClass} Class</span>
                )}
              </div>
              {i > 0 && s.connectionVia && (
                <p className="mt-2 text-xs text-[#000000]">Connection via {s.connectionVia}</p>
              )}
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="min-w-0 text-left">
                  <div className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl" style={{ color }}>
                    {formatTime12Hour(s.departureTime, '--:--')}
                  </div>
                  <div className="break-words font-medium text-[#000000]">{s.from || '—'}</div>
                  <div className="text-xs text-[#000000]">{dateShort(s.departureDate) ?? ''}</div>
                </div>
                <div className="flex flex-col items-center px-1">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="h-px w-4 sm:w-24" style={{ backgroundColor: color }} />
                    <Plane className="h-4 w-4 shrink-0" style={{ color }} />
                    <span className="h-px w-4 sm:w-24" style={{ backgroundColor: color }} />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  </div>
                  {s.duration && <div className="mt-1 text-center text-xs text-[#000000]">🕐 {s.duration}</div>}
                </div>
                <div className="min-w-0 text-right">
                  <div className="whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl" style={{ color }}>
                    {formatTime12Hour(s.arrivalTime, '--:--')}
                  </div>
                  <div className="break-words font-medium text-[#000000]">{s.to || '—'}</div>
                  <div className="text-xs text-[#000000]">{dateShort(s.arrivalDate) ?? ''}</div>
                </div>
              </div>
              {(s.cabinLuggage || s.checkInLuggage) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-[#000000]">
                  <span className="font-semibold">🧳 Baggage:</span>
                  {s.cabinLuggage && (
                    <span className="rounded border px-2 py-0.5">
                      Cabin: {cabinLuggageLabel(s.cabinLuggage)}
                    </span>
                  )}
                  {s.checkInLuggage && (
                    <span className="rounded border px-2 py-0.5">Check-in: {s.checkInLuggage}</span>
                  )}
                </div>
              )}
              {s.notes && s.notes.replace(/<[^>]*>/g, '').trim() && (
                <div className="flight-notes mt-3 border-t pt-3">
                  <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#000000]">
                    ℹ️ Notes:
                  </p>
                  <RichHtml html={s.notes} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FlightImageViewer({
  images,
  firstOnly = false,
}: {
  images: Array<{ description?: string | null; url: string }>;
  /** PDF mode: render only the first image. */
  firstOnly?: boolean;
}) {
  const shown = firstOnly ? images.slice(0, 1) : images;
  if (!shown.length) return null;

  return (
    <div className="mx-auto grid max-w-4xl items-start gap-5">
      {shown.map((image, index) => {
        const description = image.description?.trim() || '';
        const accessibleTitle = description || 'flight document';
        return (
          <figure
            key={`${image.url}-${index}`}
            className="group w-full self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg ring-1 ring-slate-900/5"
          >
            <a
              href={image.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`View ${accessibleTitle}`}
              className="block w-full bg-slate-50"
            >
              <img
                src={image.url}
                alt={description}
                loading="lazy"
                className="block h-auto w-full"
              />
            </a>
            <figcaption
              className={`flex min-h-16 items-center gap-3 border-t border-slate-200 bg-white px-3.5 py-3 ${description ? 'justify-between' : 'justify-end'}`}
            >
              {description && (
                <p className="min-w-0 text-sm leading-relaxed text-[#000000]">{description}</p>
              )}
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Preview ${accessibleTitle}`}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-[#000000] transition hover:border-slate-300 hover:bg-slate-100 hover:text-[#000000]"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Preview
              </a>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
