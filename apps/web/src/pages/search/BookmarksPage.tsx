import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Flame,
  Hotel,
  MapPin,
  Plane,
  Star,
  Users,
  X,
} from 'lucide-react';
import type {
  FlightBookmarkSnapshot,
  HotelBookmarkSnapshot,
  HotelRoomSelection,
  LiveSearchBookmark,
  LiveSearchBookmarkType,
} from '@interscale/shared';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/cn';
import { useBookmarks, useDeleteBookmark } from '@/features/search/search.api';
import { resolveHotelImageCandidates } from '@/features/search/hotel-images';
import { formatFlightDate, formatFlightTime } from './flight-format';
import { resolveHotelPrice } from './hotel-price';

const minutes = (total: number | undefined) =>
  total === undefined ? '—' : `${Math.floor(total / 60)}h ${total % 60}m`;

function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Readable "17 Aug 2026 • 8:42 PM" timestamp in the app's local timezone. */
function formatSavedDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = formatSavedDate(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} • ${time}`;
}

/** Subtle metadata row showing exactly when a bookmark was saved. */
function SavedTimestamp({ createdAt, className }: { createdAt: string; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <Bookmark className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Saved {formatSavedDateTime(createdAt)}</span>
    </p>
  );
}

/** Public bookmark code with a copy button. Copying is local-only. */
function BookmarkCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. tests/older browsers); ignore.
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{code}</span>
      <button
        type="button"
        aria-label={`Copy bookmark ID ${code}`}
        title="Copy bookmark ID"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/** Image carousel driven entirely by the saved snapshot (no SearchAPI). */
function BookmarkImages({
  images,
}: {
  images: { thumbnail?: string; original?: string }[] | undefined;
}) {
  const normalized = useMemo(() => {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const image of images ?? []) {
      const candidates = resolveHotelImageCandidates(image)
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url));
      if (!candidates.length) continue;
      const primary = candidates[0]!;
      if (seen.has(primary)) continue;
      seen.add(primary);
      out.push(candidates);
    }
    return out;
  }, [images]);

  const imageSignature = useMemo(() => normalized.map((c) => c[0]).join('|'), [normalized]);

  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  const prevSignatureRef = useRef(imageSignature);
  useEffect(() => {
    if (prevSignatureRef.current !== imageSignature) {
      prevSignatureRef.current = imageSignature;
      setIndex(0);
      setFailed(new Set());
    }
  }, [imageSignature]);

  const validImages = useMemo(
    () =>
      normalized
        .map((candidates, i) => ({ candidates, i }))
        .filter(({ candidates }) => candidates.some((url) => !failed.has(url))),
    [normalized, failed],
  );

  useEffect(() => {
    if (!validImages.length) setIndex(0);
    else setIndex((cur) => Math.min(cur, validImages.length - 1));
  }, [validImages.length]);

  const shownIndex = validImages.length ? Math.min(index, validImages.length - 1) : -1;
  const shown = shownIndex >= 0 ? validImages[shownIndex] : undefined;
  const currentUrl = shown?.candidates.find((url) => !failed.has(url)) ?? null;

  const goTo = useMemo(
    () => (next: number) => {
      if (!validImages.length) return;
      const len = validImages.length;
      setIndex(((next % len) + len) % len);
    },
    [validImages.length],
  );
  const goNext = () => {
    if (!validImages.length) return;
    setIndex((prev) => (prev + 1) % validImages.length);
  };
  const goPrev = () => {
    if (!validImages.length) return;
    setIndex((prev) => (prev - 1 + validImages.length) % validImages.length);
  };

  const onError = () => {
    if (!currentUrl) return;
    setFailed((prev) => {
      if (prev.has(currentUrl)) return prev;
      const next = new Set(prev);
      next.add(currentUrl);
      return next;
    });
  };

  useEffect(() => {
    if (!validImages.length || shownIndex < 0) return;
    const preload = (url: string | undefined) => {
      if (!url || failed.has(url)) return;
      const img = new window.Image();
      img.src = url;
    };
    const nextEntry = validImages[(shownIndex + 1) % validImages.length];
    const prevEntry = validImages[(shownIndex - 1 + validImages.length) % validImages.length];
    preload(nextEntry?.candidates.find((u) => !failed.has(u)));
    preload(prevEntry?.candidates.find((u) => !failed.has(u)));
  }, [shownIndex, validImages, failed]);

  const single = validImages.length <= 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted">
      {currentUrl ? (
        <img
          key={currentUrl}
          src={currentUrl}
          alt="Property"
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={onError}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Hotel className="h-8 w-8" aria-hidden="true" />
          <span className="px-3 text-center text-xs">No images available</span>
        </div>
      )}

      {!single && currentUrl && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={goPrev}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white shadow transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={goNext}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white shadow transition-colors hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
            {shownIndex + 1} / {validImages.length}
          </span>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/45 px-2 py-1">
            {validImages.map(({ i }, dotIndex) => (
              <button
                key={i}
                type="button"
                aria-label={`Image ${dotIndex + 1}`}
                onClick={() => goTo(dotIndex)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === validImages[shownIndex]?.i ? 'w-4 bg-white' : 'w-1.5 bg-white/60',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{String(value)}</p>
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** A flight bookmark card rendered entirely from the saved snapshot. */
function FlightBookmarkCard({ bookmark }: { bookmark: LiveSearchBookmark }) {
  const [open, setOpen] = useState(false);
  const flight = bookmark.snapshot.flight;
  if (!flight) return null;
  const first = flight.segments[0];
  const last = flight.segments[flight.segments.length - 1];
  const isRoundTrip = flight.type?.toLowerCase().includes('round');
  const stops = Math.max(0, flight.segments.length - 1);
  // Legacy/incomplete snapshots (created before snapshot preservation was
  // fixed) may have no segments. Render what exists; never fabricate values.
  const incomplete = flight.segments.length === 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">{bookmark.title}</h3>
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            {flight.airlineLogo ? (
              <img
                src={flight.airlineLogo}
                alt=""
                className="h-4 w-4 rounded-sm object-contain"
                loading="lazy"
              />
            ) : (
              <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            {flight.airline !== '—' ? `${flight.airline} · ` : ''}
            {flight.flightNumbers.join(' / ')}
          </span>
          <div className="mt-1">
            <BookmarkCode code={bookmark.bookmarkCode} />
          </div>
          {first && last ? (
            <p className="mt-1 text-sm text-foreground">
              <span className="font-medium">
                {first.departure_airport.id} {formatFlightTime(first.departure_airport.time)}
              </span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="text-xs text-muted-foreground">{minutes(flight.totalDuration)}</span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span className="font-medium">
                {last.arrival_airport.id} {formatFlightTime(last.arrival_airport.time)}
              </span>
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {incomplete ? (
              <Badge variant="outline">Incomplete saved data</Badge>
            ) : (
              <Badge variant="secondary">
                {stops === 0 ? 'Non-stop' : stops === 1 ? '1 stop' : `${stops} stops`}
              </Badge>
            )}
            {!incomplete ? (
              <Badge variant="secondary">{flight.segments[0]?.travel_class ?? '—'}</Badge>
            ) : null}
            {isRoundTrip ? (
              <Badge variant="outline">Round trip</Badge>
            ) : (
              <Badge variant="outline">One way</Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-foreground">
            {!incomplete && flight.price !== undefined
              ? new Intl.NumberFormat('en-IN', {
                  style: 'currency',
                  currency: flight.currency || 'INR',
                }).format(flight.price)
              : 'Price unavailable'}
          </p>
          <p className="text-xs text-muted-foreground">Saved price</p>
          <SavedTimestamp createdAt={bookmark.createdAt} />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {open ? 'View less' : 'View details'}
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>
      {open ? <FlightBookmarkDetails flight={flight} /> : null}
    </Card>
  );
}

function FlightBookmarkDetails({ flight }: { flight: FlightBookmarkSnapshot }) {
  const renderSegments = () => (
    <div className="space-y-3">
      {flight.segments.map((segment, index) => (
        <div
          key={`${segment.flight_number}-${index}`}
          className="rounded-lg border border-border bg-card-2 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
              {segment.airline} · {segment.flight_number}
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {segment.travel_class ?? '—'}
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div>
              <p className="text-lg font-semibold text-foreground">
                {formatFlightTime(segment.departure_airport.time)}
              </p>
              <p className="text-xs text-muted-foreground">
                {segment.departure_airport.id} · {formatFlightDate(segment.departure_airport.date)}
              </p>
              <p className="text-xs text-muted-foreground/80">{segment.departure_airport.name}</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <span className="text-xs font-medium text-muted-foreground">
                {minutes(segment.duration)}
              </span>
              <span className="my-1 flex w-full items-center">
                <span className="h-px flex-1 bg-border" />
                <Plane
                  className="mx-1 h-3.5 w-3.5 rotate-90 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="h-px flex-1 bg-border" />
              </span>
              {segment.airplane && (
                <span className="text-[11px] text-muted-foreground/80">{segment.airplane}</span>
              )}
            </div>
            <div className="sm:text-right">
              <p className="text-lg font-semibold text-foreground">
                {formatFlightTime(segment.arrival_airport.time)}
              </p>
              <p className="text-xs text-muted-foreground">
                {segment.arrival_airport.id} · {formatFlightDate(segment.arrival_airport.date)}
              </p>
              <p className="text-xs text-muted-foreground/80">{segment.arrival_airport.name}</p>
            </div>
          </div>
          {segment.extensions?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {segment.extensions.map((ext) => (
                <Chip key={ext}>{ext}</Chip>
              ))}
            </div>
          ) : null}
          {flight.layovers?.[index] ? (
            <div className="mt-2 flex items-center gap-2 px-1 text-xs text-amber-700">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {minutes(flight.layovers[index].duration)} layover at {flight.layovers[index].name} (
              {flight.layovers[index].id})
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4 border-t border-border p-4">
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Plane className="h-4 w-4 text-primary" aria-hidden="true" />
          {flight.type?.toLowerCase().includes('round') ? 'Outbound' : 'Flight details'}
        </h4>
        {renderSegments()}
      </section>
      {flight.carbonEmissions ? (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Emissions</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field
              label="This flight"
              value={`${Math.round((flight.carbonEmissions.this_flight ?? 0) / 1000)} kg`}
            />
            <Field
              label="Typical route"
              value={`${Math.round((flight.carbonEmissions.typical_for_this_route ?? 0) / 1000)} kg`}
            />
            <Field
              label="Lowest route"
              value={`${Math.round((flight.carbonEmissions.lowest_route ?? 0) / 1000)} kg`}
            />
            <Field
              label="Difference"
              value={`${flight.carbonEmissions.difference_percent ?? 0}%`}
            />
          </div>
        </div>
      ) : null}
      {flight.extensions?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {flight.extensions.map((ext) => (
            <Chip key={ext}>{ext}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Format a saved numeric room price using the bookmark currency. Never invents values. */
function formatRoomPrice(value: number | null | undefined, currency: string): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('en-IN')}`;
  }
}

/** Compact bed summary, e.g. "2 beds" or "1 king bed". Returns null when unknown. */
function formatSavedBeds(
  beds: Array<{ count?: number; type?: string }> | null | undefined,
): string | null {
  if (!Array.isArray(beds) || !beds.length) return null;
  const parts = beds
    .map((bed) => {
      const count = bed.count ?? 1;
      const type = (bed.type ?? '').trim();
      if (!type) return count === 1 ? '1 bed' : `${count} beds`;
      return count === 1 ? `${count} ${type} bed` : `${count} ${type} beds`;
    })
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.join(' + ');
}

/** Stay range from the saved search params, e.g. "26 Sep – 10 Oct". Null when unsaved. */
function formatStayRange(searchParams: Record<string, unknown>): string | null {
  const checkIn = typeof searchParams.check_in_date === 'string' ? searchParams.check_in_date : null;
  const checkOut =
    typeof searchParams.check_out_date === 'string' ? searchParams.check_out_date : null;
  const fmt = (iso: string, withYear: boolean) => {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' as const } : {}),
    });
  };
  if (checkIn && checkOut) {
    const crossYear = checkIn.slice(0, 4) !== checkOut.slice(0, 4);
    return `${fmt(checkIn, crossYear)} – ${fmt(checkOut, true)}`;
  }
  if (checkIn) return `From ${fmt(checkIn, true)}`;
  if (checkOut) return `Until ${fmt(checkOut, true)}`;
  return null;
}

/** One saved room/rate selection with the bookmark that owns it. */
interface SavedRoomItem {
  room: HotelRoomSelection;
  bookmarkId: string;
  bookmarkCode: string;
}

/** Every saved room on a hotel snapshot: hierarchical `rooms[]`, else legacy `selectedRoom`. */
function collectSavedRooms(
  hotel: HotelBookmarkSnapshot,
  fallback: { bookmarkId: string; bookmarkCode: string },
): SavedRoomItem[] {
  if (hotel.rooms?.length) {
    return hotel.rooms.map((room) => ({
      room,
      bookmarkId: fallback.bookmarkId,
      bookmarkCode: fallback.bookmarkCode,
    }));
  }
  if (hotel.selectedRoom) {
    return [
      {
        room: hotel.selectedRoom,
        bookmarkId: fallback.bookmarkId,
        bookmarkCode: fallback.bookmarkCode,
      },
    ];
  }
  return [];
}

/** Compact saved-price block: prominent total, secondary per-night, saved label. */
function BookmarkPriceBlock({
  total,
  perNight,
  beforeTaxes,
  currency,
  compact,
}: {
  total: string | null;
  perNight: string | null;
  beforeTaxes: boolean;
  currency: string;
  compact?: boolean;
}) {
  void currency;
  if (!total && !perNight) {
    return (
      <div>
        <p className={compact ? 'text-sm font-semibold text-foreground' : 'text-base font-semibold text-foreground'}>
          Price unavailable
        </p>
        <p className="text-xs text-muted-foreground">Saved price</p>
      </div>
    );
  }
  return (
    <div>
      {total ? (
        <p className={compact ? 'text-sm font-semibold text-foreground' : 'text-lg font-bold text-foreground'}>
          <span>{total}</span>{' '}
          <span className="text-xs font-normal text-muted-foreground">total</span>
          {beforeTaxes ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">Before taxes</span>
          ) : null}
        </p>
      ) : null}
      {perNight ? (
        <p className="text-xs text-muted-foreground">
          <span>{perNight}</span>
          <span>/night</span>
          {beforeTaxes && !total ? ' · Before taxes' : null}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">Saved price</p>
    </div>
  );
}

/**
 * "Add to Quotation" for a saved bookmark. The quotation builder loads hotels
 * via its Hotel Bookmark ID field (DB only), so this copies the code and
 * confirms — quotation logic itself is untouched.
 */
function AddToQuotationButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable; still show the code hint below.
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="secondary" onClick={copy} title="Copy bookmark code for the quotation builder" className="h-7 px-2 text-xs">
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {copied ? 'Code copied' : 'Add to Quotation'}
      </Button>
      {copied ? (
        <span className="text-[11px] text-muted-foreground">
          Paste <span className="font-medium text-foreground">{code}</span> as Hotel Bookmark ID
        </span>
      ) : null}
    </span>
  );
}

/** True when the saved room text explicitly mentions breakfast. Never invented. */
function roomMentionsBreakfast(room: HotelRoomSelection): boolean {
  const hay = [room.roomDescription ?? '', ...(room.roomAmenities ?? [])].join(' ').toLowerCase();
  return hay.includes('breakfast');
}

/** Compact commercial card for one saved room/rate. Never invents a room name. */
function SavedRoomCard({
  item,
  currency,
  onRemove,
  removing,
}: {
  item: SavedRoomItem;
  currency: string;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const { room } = item;
  const name = (room.roomName ?? '').trim();
  const isProviderOnly = !name;
  const total = formatRoomPrice(room.totalPrice ?? room.totalPriceBeforeTaxes, currency);
  const perNight = formatRoomPrice(room.pricePerNight ?? room.pricePerNightBeforeTaxes, currency);
  const beds = formatSavedBeds(room.beds);
  const freeUntil = room.freeCancellationUntil?.date
    ? [room.freeCancellationUntil.date, room.freeCancellationUntil.time].filter(Boolean).join(', ')
    : null;

  return (
    <article className="rounded-lg border border-border bg-card-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isProviderOnly ? 'Provider Rate' : 'Room'}
          </p>
          {!isProviderOnly ? (
            <h4 className="mt-0.5 break-words text-sm font-semibold text-foreground">{name}</h4>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {room.supplier ? (
              <span className="flex items-center gap-1 font-medium text-foreground">
                {room.supplierLogo ? (
                  <img src={room.supplierLogo} alt="" className="h-4 w-4 rounded" loading="lazy" />
                ) : null}
                {isProviderOnly ? `Supplier: ${room.supplier}` : room.supplier}
                {room.isOfficial ? (
                  <Badge variant="outline" className="ml-1">
                    Official site
                  </Badge>
                ) : null}
              </span>
            ) : null}
            {room.guests ? (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden="true" />
                {room.guests} guests
              </span>
            ) : null}
            {beds ? <span>{beds}</span> : null}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {roomMentionsBreakfast(room) ? <Badge variant="secondary">Breakfast included</Badge> : null}
            {room.freeCancellation ? (
              <Badge variant="outline" className="text-emerald-700">
                {freeUntil ? `Free cancellation until ${freeUntil}` : 'Free cancellation'}
              </Badge>
            ) : room.freeCancellation === false ? (
              <Badge variant="secondary">Room only</Badge>
            ) : null}
          </div>
          {room.roomDescription ? (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{room.roomDescription}</p>
          ) : null}
        </div>
        <div className="text-right">
          {total ? (
            <p className="text-sm font-semibold text-foreground">
              <span>{total}</span>{' '}
              <span className="text-xs font-normal text-muted-foreground">total</span>
            </p>
          ) : null}
          {perNight ? (
            <p className="text-xs text-muted-foreground">
              <span>{perNight}</span>
              <span>/night</span>
            </p>
          ) : null}
          {!total && !perNight ? (
            <p className="text-xs text-muted-foreground">Price unavailable</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {room.offerLink ? (
          <a
            href={room.offerLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View offer <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <AddToQuotationButton code={item.bookmarkCode} />
          <Button
            size="sm"
            variant="ghost"
            isLoading={removing}
            onClick={() => onRemove(item.bookmarkId)}
            aria-label={`Remove bookmark ${item.bookmarkCode}`}
            title="Remove bookmark"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600"
          >
            Remove
          </Button>
        </span>
      </div>
    </article>
  );
}

/** Collapsed developer-only view of the stored snapshot. Data is preserved, never shown by default. */
function BookmarkDeveloperDetails({ bookmark }: { bookmark: LiveSearchBookmark }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Developer details
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open ? (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground">
          {JSON.stringify(bookmark.snapshot, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

/** Normalized text used only as a safe grouping fallback (case + whitespace). */
function normalizeGroupText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stable grouping key: hotelId → provider identifier → normalized name+city. */
function hotelBookmarkGroupKey(bookmark: LiveSearchBookmark): string {
  const hotel = bookmark.snapshot.hotel;
  if (!hotel) return `bookmark:${bookmark.id}`;
  if (hotel.hotelId) return `hotel:${hotel.hotelId}`;
  if (hotel.propertyToken ?? hotel.dataId) return `provider:${hotel.propertyToken ?? hotel.dataId}`;
  return `name:${normalizeGroupText(hotel.name)}:${normalizeGroupText(hotel.city)}`;
}

/** Build the ordered render items, grouping hotel bookmarks by hotel. */
function buildGroupedBookmarks(list: LiveSearchBookmark[]) {
  const groups = new Map<string, LiveSearchBookmark[]>();
  const items: Array<
    | { key: string; kind: 'flight'; bookmark: LiveSearchBookmark }
    | { key: string; kind: 'hotel'; group: LiveSearchBookmark[] }
  > = [];
  for (const bookmark of list) {
    if (bookmark.type === 'HOTEL') {
      const key = hotelBookmarkGroupKey(bookmark);
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
        items.push({ key, kind: 'hotel', group });
      }
      group.push(bookmark);
    } else {
      items.push({ key: bookmark.id, kind: 'flight', bookmark });
    }
  }
  return items;
}

/** Compact hotel identity block: name, rating, location, type, truncated description. */
function HotelIdentity({
  hotel,
  descriptionLines = 2,
}: {
  hotel: HotelBookmarkSnapshot;
  descriptionLines?: 2 | 3;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{hotel.name}</h3>
        {hotel.propertyType ? <Badge variant="secondary">{hotel.propertyType}</Badge> : null}
        {hotel.deal ? (
          <Badge variant="success">
            <Flame className="h-3 w-3" aria-hidden="true" />
            {hotel.deal}
          </Badge>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {hotel.rating ? (
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="font-medium text-foreground">{hotel.rating}</span>
            {hotel.reviews ? (
              <span className="text-muted-foreground/80">({hotel.reviews.toLocaleString()})</span>
            ) : null}
          </span>
        ) : null}
        {hotel.city ? (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {hotel.city}
            {hotel.country ? `, ${hotel.country}` : ''}
          </span>
        ) : null}
      </div>
      {hotel.description ? (
        <p className={cn('mt-1.5 text-sm text-muted-foreground', descriptionLines === 2 ? 'line-clamp-2' : 'line-clamp-3')}>
          {hotel.description}
        </p>
      ) : null}
    </div>
  );
}

/** Stay context row from the saved search params: dates + guests. Renders nothing when unsaved. */
function StayContext({
  searchParams,
  fallbackGuests,
}: {
  searchParams: Record<string, unknown>;
  fallbackGuests?: number | null;
}) {
  const range = formatStayRange(searchParams);
  const adults = typeof searchParams.adults === 'number' ? searchParams.adults : null;
  const guests = adults ?? fallbackGuests ?? null;
  if (!range && guests === null) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {range ? (
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Stay: {range}
        </span>
      ) : null}
      {guests !== null ? (
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" aria-hidden="true" />
          {guests} guest{guests === 1 ? '' : 's'}
        </span>
      ) : null}
    </p>
  );
}

/** Full hotel information in a modal: overview, saved rooms, pricing, actions. */
function HotelDetailsModal({
  bookmarks,
  onClose,
  onRemove,
  removing,
}: {
  bookmarks: LiveSearchBookmark[];
  onClose: () => void;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const first = bookmarks[0]!;
  const hotel = first.snapshot.hotel;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  if (!hotel) return null;
  const items = bookmarks.flatMap((b) =>
    collectSavedRooms(b.snapshot.hotel ?? hotel, { bookmarkId: b.id, bookmarkCode: b.bookmarkCode }),
  );
  const currency = first.currency || 'INR';
  const pricePerNight = resolveHotelPrice(hotel.pricePerNight);
  const totalPrice = resolveHotelPrice(hotel.totalPrice);
  const fallbackGuests = items[0]?.room.guests ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/50 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Saved details for ${hotel.name}`}
        className="my-auto flex max-h-[90vh] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-card shadow-xl supports-[height:100dvh]:max-h-[90dvh]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
          <HotelIdentity hotel={hotel} descriptionLines={3} />
          <button
            type="button"
            aria-label="Close saved details"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [-webkit-overflow-scrolling:touch]">
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Hotel overview
            </h4>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Field label="Type" value={hotel.propertyType} />
              <Field
                label="Location"
                value={hotel.city ? `${hotel.city}${hotel.country ? `, ${hotel.country}` : ''}` : undefined}
              />
              {hotel.address ? <Field label="Address" value={hotel.address} /> : null}
              <Field
                label="Check-in / Check-out"
                value={`${hotel.checkInTime ?? '—'} / ${hotel.checkOutTime ?? '—'}`}
              />
            </div>
            {hotel.amenities?.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hotel.amenities.map((amenity) => (
                  <Chip key={amenity}>{amenity}</Chip>
                ))}
              </div>
            ) : null}
          </section>
          {items.length ? (
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saved rooms & offers ({items.length})
              </h4>
              <div className="space-y-2">
                {items.map((item) => (
                  <SavedRoomCard
                    key={`${item.bookmarkId}-${item.room.roomName ?? 'provider'}-${item.room.supplier ?? ''}`}
                    item={item}
                    currency={currency}
                    onRemove={onRemove}
                    removing={removing}
                  />
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved pricing
            </h4>
            <BookmarkPriceBlock
              total={totalPrice.main}
              perNight={pricePerNight.main}
              beforeTaxes={totalPrice.beforeTaxes || pricePerNight.beforeTaxes}
              currency={currency}
            />
            <StayContext searchParams={first.searchParams} fallbackGuests={fallbackGuests} />
          </section>
          <section className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <AddToQuotationButton code={first.bookmarkCode} />
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </section>
          <BookmarkDeveloperDetails bookmark={first} />
        </div>
      </div>
    </div>
  );
}

/** One hotel rendered once, with every saved room as a compact commercial card. */
function HotelBookmarkGroup({
  group,
  onRemove,
  removing,
}: {
  group: LiveSearchBookmark[];
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const first = group[0]!;
  const hotel = first.snapshot.hotel;
  if (!hotel) return null;
  const items = group.flatMap((b) =>
    collectSavedRooms(b.snapshot.hotel ?? hotel, { bookmarkId: b.id, bookmarkCode: b.bookmarkCode }),
  );
  const currency = first.currency || 'INR';
  const earliest = group.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
  const pricePerNight = resolveHotelPrice(hotel.pricePerNight);
  const totalPrice = resolveHotelPrice(hotel.totalPrice);
  const fallbackGuests = items[0]?.room.guests ?? null;

  return (
    <Card>
      <div className="grid md:grid-cols-[240px_1fr]">
        <div className="relative h-44 w-full overflow-hidden bg-muted sm:h-48 md:h-full md:max-h-[340px] md:min-h-[200px]">
          <BookmarkImages images={hotel.images} />
          {items.length ? (
            <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
              Saved rooms: {items.length}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <HotelIdentity hotel={hotel} />
          <StayContext searchParams={first.searchParams} fallbackGuests={fallbackGuests} />
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
            <BookmarkPriceBlock
              total={totalPrice.main}
              perNight={pricePerNight.main}
              beforeTaxes={totalPrice.beforeTaxes || pricePerNight.beforeTaxes}
              currency={currency}
              compact
            />
            <SavedTimestamp createdAt={earliest.createdAt} />
          </div>
          {items.length ? (
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <SavedRoomCard
                  key={`${item.bookmarkId}-${item.room.roomName ?? 'provider'}-${item.room.supplier ?? ''}`}
                  item={item}
                  currency={currency}
                  onRemove={onRemove}
                  removing={removing}
                />
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDetailsOpen(true)}>
              View Details
            </Button>
            <AddToQuotationButton code={first.bookmarkCode} />
          </div>
          <BookmarkDeveloperDetails bookmark={first} />
        </div>
      </div>
      {detailsOpen ? (
        <HotelDetailsModal
          bookmarks={group}
          onClose={() => setDetailsOpen(false)}
          onRemove={onRemove}
          removing={removing}
        />
      ) : null}
    </Card>
  );
}

/** A compact hotel bookmark card rendered entirely from the saved snapshot. */
function HotelBookmarkCard({
  bookmark,
  onRemove,
  removing,
}: {
  bookmark: LiveSearchBookmark;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hotel = bookmark.snapshot.hotel;
  if (!hotel) return null;
  const items = collectSavedRooms(hotel, { bookmarkId: bookmark.id, bookmarkCode: bookmark.bookmarkCode });
  const currency = bookmark.currency || 'INR';
  const pricePerNight = resolveHotelPrice(hotel.pricePerNight);
  const totalPrice = resolveHotelPrice(hotel.totalPrice);
  const fallbackGuests = items[0]?.room.guests ?? null;

  return (
    <Card>
      <div className="grid md:grid-cols-[240px_1fr]">
        <div className="relative h-44 w-full overflow-hidden bg-muted sm:h-48 md:h-full md:max-h-[340px] md:min-h-[200px]">
          <BookmarkImages images={hotel.images} />
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <HotelIdentity hotel={hotel} />
          <div className="mt-1">
            <BookmarkCode code={bookmark.bookmarkCode} />
          </div>
          <StayContext searchParams={bookmark.searchParams} fallbackGuests={fallbackGuests} />
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
            <BookmarkPriceBlock
              total={totalPrice.main}
              perNight={pricePerNight.main}
              beforeTaxes={totalPrice.beforeTaxes || pricePerNight.beforeTaxes}
              currency={currency}
              compact
            />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {hotel.checkInTime ?? '—'} / {hotel.checkOutTime ?? '—'}
              </span>
            </div>
          </div>
          <SavedTimestamp createdAt={bookmark.createdAt} className="mt-2" />
          {items.length ? (
            <div className="mt-3 space-y-2">
              {items.map((item) => (
                <SavedRoomCard
                  key={`${item.bookmarkId}-${item.room.roomName ?? 'provider'}-${item.room.supplier ?? ''}`}
                  item={item}
                  currency={currency}
                  onRemove={onRemove}
                  removing={removing}
                />
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDetailsOpen(true)}>
              View Details
            </Button>
            <AddToQuotationButton code={bookmark.bookmarkCode} />
            <Button
              size="sm"
              variant="ghost"
              isLoading={removing}
              onClick={() => onRemove(bookmark.id)}
              className="text-muted-foreground hover:text-red-600"
            >
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              Remove bookmark
            </Button>
          </div>
          <BookmarkDeveloperDetails bookmark={bookmark} />
        </div>
      </div>
      {detailsOpen ? (
        <HotelDetailsModal
          bookmarks={[bookmark]}
          onClose={() => setDetailsOpen(false)}
          onRemove={onRemove}
          removing={removing}
        />
      ) : null}
    </Card>
  );
}

type BookmarkFilter = LiveSearchBookmarkType | 'ALL';

/** Calendar-date key (YYYY-MM-DD) for a saved bookmark's createdAt. */
function savedDateKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function BookmarksPage() {
  const [filter, setFilter] = useState<BookmarkFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedFrom, setSavedFrom] = useState('');
  const [savedTo, setSavedTo] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const bookmarks = useBookmarks(filter === 'ALL' ? undefined : filter);
  const remove = useDeleteBookmark();

  const dateFilterApplied = Boolean(appliedFrom || appliedTo);
  const searchActive = searchQuery.trim().length > 0;

  const withinDateRange = (createdAt: string) => {
    if (!dateFilterApplied) return true;
    const key = savedDateKey(createdAt);
    if (!key) return false;
    if (appliedFrom && key < appliedFrom) return false;
    if (appliedTo && key > appliedTo) return false;
    return true;
  };

  // Client-side, in-memory search over the already-loaded bookmarks only.
  // Typing never triggers any network/API request.
  const matchesSearch = (bookmark: LiveSearchBookmark) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    if (bookmark.type === 'HOTEL') {
      const hotel = bookmark.snapshot.hotel;
      return [hotel?.name, hotel?.city, hotel?.country, bookmark.bookmarkCode, bookmark.title]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q));
    }
    const flight = bookmark.snapshot.flight;
    const haystack = [
      flight?.airline,
      ...(flight?.flightNumbers ?? []),
      bookmark.title,
      bookmark.bookmarkCode,
      ...(flight?.segments ?? []).flatMap((segment) => [
        segment.departure_airport?.id,
        segment.departure_airport?.name,
        segment.arrival_airport?.id,
        segment.arrival_airport?.name,
      ]),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  };

  const list = (bookmarks.data ?? [])
    .filter((bookmark) => withinDateRange(bookmark.createdAt))
    .filter(matchesSearch);

  const applyDateRange = () => {
    if (savedFrom && savedTo && savedFrom > savedTo) {
      setRangeError('From date must be on or before the To date.');
      return;
    }
    setRangeError(null);
    setAppliedFrom(savedFrom);
    setAppliedTo(savedTo);
  };

  const clearDateRange = () => {
    setSavedFrom('');
    setSavedTo('');
    setAppliedFrom('');
    setAppliedTo('');
    setRangeError(null);
  };

  const dateInputClass =
    'w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/60';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bookmarks"
        description="Saved hotels, rooms and offers. Prices reflect the time they were bookmarked — viewing saved items does not refresh live prices."
      />

      <div
        role="tablist"
        className="flex w-fit rounded-lg border border-border bg-card p-1 shadow-sm"
      >
        {(
          [
            ['ALL', 'All'],
            ['FLIGHT', 'Flights'],
            ['HOTEL', 'Hotels'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              filter === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <input
          aria-label="Search saved bookmarks"
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={
            filter === 'HOTEL'
              ? 'Search saved hotels...'
              : filter === 'FLIGHT'
                ? 'Search saved flights...'
                : 'Search saved hotels & flights...'
          }
          className={`${dateInputClass} w-full sm:max-w-md`}
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Saved date</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm font-medium text-slate-800">
                From
                <input
                  aria-label="Saved date from"
                  type="date"
                  value={savedFrom}
                  onChange={(event) => setSavedFrom(event.target.value)}
                  className={`${dateInputClass} mt-1`}
                />
              </label>
              <label className="block text-sm font-medium text-slate-800">
                To
                <input
                  aria-label="Saved date to"
                  type="date"
                  value={savedTo}
                  onChange={(event) => setSavedTo(event.target.value)}
                  className={`${dateInputClass} mt-1`}
                />
              </label>
              <Button size="sm" variant="secondary" onClick={applyDateRange}>
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={clearDateRange}>
                Clear
              </Button>
            </div>
          </div>
          {rangeError ? (
            <p role="alert" className="text-xs text-red-600">
              {rangeError}
            </p>
          ) : null}
        </div>
      </div>

      {bookmarks.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : bookmarks.isError ? (
        <Alert tone="error">We couldn&apos;t load bookmarks. Please try again.</Alert>
      ) : list.length ? (
        <div className="space-y-3">
          {buildGroupedBookmarks(list).map((item) =>
            item.kind === 'flight' ? (
              <div key={item.key} className="relative">
                <FlightBookmarkCard bookmark={item.bookmark} />
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute right-3 top-3 z-10"
                  isLoading={remove.isPending}
                  onClick={() => remove.mutate(item.bookmark.id)}
                >
                  <Bookmark className="h-4 w-4" aria-hidden="true" />
                  Remove bookmark
                </Button>
              </div>
            ) : item.group.length === 1 ? (
              <HotelBookmarkCard
                key={item.key}
                bookmark={item.group[0]!}
                onRemove={(id) => remove.mutate(id)}
                removing={remove.isPending}
              />
            ) : (
              <HotelBookmarkGroup
                key={item.key}
                group={item.group}
                onRemove={(id) => remove.mutate(id)}
                removing={remove.isPending}
              />
            ),
          )}
        </div>
      ) : searchActive ? (
        <EmptyState
          icon={Bookmark}
          title={
            filter === 'FLIGHT'
              ? 'No saved flights found'
              : filter === 'HOTEL'
                ? 'No saved hotels found'
                : 'No saved items found'
          }
          description="Try a different search or clear the search box to see all saved items."
        />
      ) : dateFilterApplied ? (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks found for this date range."
          description="Try widening the Saved date range or clearing the filter."
        />
      ) : (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet"
          description="Save flight or hotel results from Live Search to view them here later."
        />
      )}
    </div>
  );
}
