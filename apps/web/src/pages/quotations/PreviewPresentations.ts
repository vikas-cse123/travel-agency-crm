import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import {
  airlineLogoUrl,
  cruiseImageUrl,
  destinationImageUrl,
  hotelImageUrl,
  useSightseeingPresentations,
  vehicleImageUrl,
  type Airline,
  type Cruise,
  type Destination,
  type Hotel,
  type Vehicle,
} from '@/features/masters/masters.api';

/**
 * Master-sourced presentation data for the builder's live weblink preview,
 * mirroring what the server resolves for the real public weblink
 * (`resolveHotelPresentations`, `resolveCruisePresentations`,
 * `resolveVehiclePresentations`, `resolveSightseeingPresentations`,
 * `resolveDestinationHeroImage`).
 *
 * Master LISTS (hotels/destinations/cruises/vehicles) come from queries the
 * builder already runs for its own pickers, so they are passed in as props —
 * never refetched here. Signed download URLs and full hotel details cannot be
 * synthesized client-side, so they resolve through small cache-first queries
 * (long staleTime, existing endpoints, preview-scoped keys where the builder
 * has no equivalent): no request fires for data the builder already holds,
 * and nothing here saves, publishes, or persists anything.
 */

/** How long resolved presentation URLs stay fresh (signed URLs expire). */
export const PREVIEW_PRESENTATIONS_STALE_MS = 10 * 60 * 1000;

export interface PreviewMasterLists {
  destinations: Destination[];
  cruises: Cruise[];
  vehicles: Vehicle[];
  airlines: Airline[];
}

export interface PreviewPresentations {
  heroImageUrl: string | null;
  airlinePresentations: Record<string, { name: string; logoUrl: string | null }>;
  hotelPresentations: Record<
    string,
    {
      imageUrl: string | null;
      starCategory: number | null;
      starRating: string | null;
      address: string | null;
      reviewLink: string | null;
      checkInTime: string | null;
      checkOutTime: string | null;
      destination: string;
      country: string;
    }
  >;
  cruisePresentations: Record<
    string,
    { imageUrl: string | null; name: string | null; roomTypeName: string | null }
  >;
  vehiclePresentations: Record<
    string,
    { imageUrl: string | null; name: string; vehicleType: string; capacity: number | null }
  >;
  sightseeingPresentations: Record<string, { imageUrl: string | null }>;
}

export const EMPTY_PREVIEW_PRESENTATIONS: PreviewPresentations = {
  heroImageUrl: null,
  airlinePresentations: {},
  hotelPresentations: {},
  cruisePresentations: {},
  vehiclePresentations: {},
  sightseeingPresentations: {},
};

const normalizeName = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** Split a summary/itinerary value the way the server's candidate builder does. */
function splitCandidateParts(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[•,>/→|-]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Pick the destination master whose image the real weblink would use,
 * mirroring the server's three-tier rule (`selectDestinationImageRecord`)
 * against the already-loaded destination masters: whole-string exact matches
 * first (summary, then countries, then destinations), then per-part exact
 * matches in server order, then the longest fuzzy hit per candidate. Only
 * masters with image evidence participate. Returns the master id or null.
 * Pure and exported for focused tests.
 */
export function matchDestinationMasterId(
  destinations: Destination[],
  destinationSummary: string | null | undefined,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): string | null {
  const withImage = destinations.filter(
    (row) => row.hasImage || (row.images ?? []).length > 0,
  );
  if (!withImage.length) return null;
  const fullCandidates: string[] = [];
  {
    const seen = new Set<string>();
    const add = (value: string | null | undefined) => {
      const normalized = (value ?? '').trim().toLowerCase();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        fullCandidates.push(normalized);
      }
    };
    add(destinationSummary);
    for (const row of itinerary ?? []) add(row?.country);
    for (const row of itinerary ?? []) add(row?.destination);
  }
  for (const candidate of fullCandidates) {
    if (!candidate) continue;
    const exact = withImage.find((row) => normalizeName(row.name) === candidate);
    if (exact) return exact.id;
  }
  const ordered: string[] = [];
  {
    const seen = new Set<string>();
    const addParts = (value: string | null | undefined) => {
      for (const part of splitCandidateParts(value)) {
        if (!seen.has(part)) {
          seen.add(part);
          ordered.push(part);
        }
      }
    };
    for (const row of itinerary ?? []) addParts(row?.country);
    addParts(destinationSummary);
    for (const row of itinerary ?? []) addParts(row?.destination);
  }
  for (const candidate of ordered) {
    const exact = withImage.find((row) => normalizeName(row.name) === candidate);
    if (exact) return exact.id;
  }
  for (const candidate of ordered) {
    if (candidate.length <= 2) continue;
    const hits = withImage
      .filter((row) => {
        const name = normalizeName(row.name);
        return name.includes(candidate) || candidate.includes(name);
      })
      .sort(
        (a, b) =>
          normalizeName(b.name).length - normalizeName(a.name).length ||
          normalizeName(a.name).localeCompare(normalizeName(b.name)) ||
          a.id.localeCompare(b.id),
      );
    if (hits[0]) return hits[0].id;
  }
  return null;
}

interface HotelRowLike {
  id?: string | null | undefined;
  hotelId?: string | null | undefined;
  city?: string | null | undefined;
}

interface ServiceRowLike {
  id?: string | null | undefined;
  name?: string | null | undefined;
  city?: string | null | undefined;
  cruiseId?: string | null | undefined;
  cruiseRoomTypeId?: string | null | undefined;
  vehicleId?: string | null | undefined;
}

/**
 * Build hotel presentations keyed by quotation hotel ROW id (the renderer
 * looks them up per stay), mirroring the server mapping. Only rows linked to
 * a resolved master detail produce an entry; anything else falls back to the
 * row's own snapshot data exactly like the real weblink. Pure, exported for
 * focused tests.
 */
export function buildHotelPresentations(
  rows: HotelRowLike[],
  detailsById: Record<string, Hotel | undefined>,
  imageUrlsById: Record<string, string | undefined>,
): PreviewPresentations['hotelPresentations'] {
  const presentations: PreviewPresentations['hotelPresentations'] = {};
  for (const row of rows) {
    const rowId = row.id;
    const hotelId = row.hotelId;
    if (!rowId || !hotelId) continue;
    const detail = detailsById[hotelId];
    if (!detail) continue;
    presentations[rowId] = {
      imageUrl: imageUrlsById[hotelId] ?? null,
      starCategory: detail.starCategory ?? null,
      starRating: detail.starRating != null ? String(detail.starRating) : null,
      address: detail.address ?? null,
      reviewLink: detail.reviewLink ?? null,
      checkInTime: detail.checkInTime ?? null,
      checkOutTime: detail.checkOutTime ?? null,
      destination: detail.destination?.name ?? row.city ?? '',
      country: detail.destination?.countryName ?? '',
    };
  }
  return presentations;
}

interface FlightDetailsLike {
  flights?: Array<{
    outbound?: { segments?: Array<{ airlineId?: string | null }> | null } | null;
    returnJourney?: { segments?: Array<{ airlineId?: string | null }> | null } | null;
  }> | null;
}

/** Airline ids referenced by live flight segments (server resolution order). */
function flightAirlineIds(flightDetails: unknown): string[] {
  const flights = (flightDetails as FlightDetailsLike | null | undefined)?.flights;
  if (!Array.isArray(flights)) return [];
  return uniqueIds(
    flights.flatMap((flight) => [
      ...(flight?.outbound?.segments ?? []).map((segment) => segment?.airlineId),
      ...(flight?.returnJourney?.segments ?? []).map((segment) => segment?.airlineId),
    ]),
  );
}

/**
 * Airline presentations keyed by airline master id (renderer lookup),
 * mirroring the server mapping (name + signed logo URL, logo only when the
 * master has a confirmed logo). Only referenced airlines are included. Pure,
 * exported for focused tests.
 */
export function buildAirlinePresentations(
  airlineIds: string[],
  mastersById: Record<string, Airline | undefined>,
  logoUrlsById: Record<string, string | undefined>,
): PreviewPresentations['airlinePresentations'] {
  const presentations: PreviewPresentations['airlinePresentations'] = {};
  for (const id of airlineIds) {
    const master = mastersById[id];
    if (!master) continue;
    presentations[id] = { name: master.name, logoUrl: logoUrlsById[id] ?? null };
  }
  return presentations;
}

/** Cruise presentations keyed by service ROW id (renderer lookup). Pure. */
export function buildCruisePresentations(
  rows: ServiceRowLike[],
  mastersById: Record<string, Cruise | undefined>,
  imageUrlsById: Record<string, string | undefined>,
): PreviewPresentations['cruisePresentations'] {
  const presentations: PreviewPresentations['cruisePresentations'] = {};
  for (const row of rows) {
    const rowId = row.id;
    const cruiseId = row.cruiseId;
    if (!rowId || !cruiseId) continue;
    const master = mastersById[cruiseId];
    const roomTypeName =
      master?.roomTypes?.find((room) => room.id === row.cruiseRoomTypeId)?.name ?? null;
    presentations[rowId] = {
      imageUrl: imageUrlsById[cruiseId] ?? null,
      name: master?.name ?? row.name ?? null,
      roomTypeName,
    };
  }
  return presentations;
}

/** Vehicle presentations keyed by service ROW id (renderer lookup). Pure. */
export function buildVehiclePresentations(
  rows: ServiceRowLike[],
  mastersById: Record<string, Vehicle | undefined>,
  imageUrlsById: Record<string, string | undefined>,
): PreviewPresentations['vehiclePresentations'] {
  const presentations: PreviewPresentations['vehiclePresentations'] = {};
  for (const row of rows) {
    const rowId = row.id;
    const vehicleId = row.vehicleId;
    if (!rowId || !vehicleId) continue;
    const master = mastersById[vehicleId];
    presentations[rowId] = {
      imageUrl: imageUrlsById[vehicleId] ?? null,
      name: master?.name ?? row.name ?? 'Vehicle',
      vehicleType: master?.vehicleType ?? row.city ?? '',
      capacity: master?.capacity ?? null,
    };
  }
  return presentations;
}

interface SightseeingDayLike {
  activities?: Array<{ sightseeingId?: string | null | undefined }> | null;
}

const uniqueIds = (ids: Array<string | null | undefined>) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * Resolve every master-sourced presentation the live preview needs, sharing
 * the builder's React Query cache wherever the builder already loads the
 * same data (hotel details, hotel preview images, sightseeing batch). Signed
 * download URLs and uncached details resolve on demand with a long staleTime
 * so opening the preview costs at most one small GET per linked master that
 * actually has image data. Read-only: no saves, no publishes, no persistence.
 */
export function usePreviewPresentations(
  form: {
    hotels?: HotelRowLike[] | null | undefined;
    services?: ServiceRowLike[] | null | undefined;
    sightseeingDetails?: { days?: SightseeingDayLike[] | null | undefined } | null | undefined;
    flightDetails?: unknown;
  } | null | undefined,
  masters: PreviewMasterLists | null | undefined,
  destinationSummary: string | null | undefined,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): PreviewPresentations {
  // NOTE on memoization: React Hook Form mutates nested field objects in
  // place, so nested arrays (hotels, services, days) can keep stable
  // identities while their content changes. Derivations below therefore read
  // current content on every render instead of memoizing on nested identity
  // (which would freeze on stale content — the exact bug this module fixes).
  // React Query dedupes by query key, so rebuilt query option objects never
  // cause duplicate fetches.
  const hotelRows = form?.hotels ?? [];
  const services = form?.services ?? [];
  const hotelIds = uniqueIds(hotelRows.map((row) => row.hotelId));
  const cruiseRows = services.filter((row) => row.cruiseId);
  const vehicleRows = services.filter((row) => row.vehicleId);
  const sightseeingIds = uniqueIds(
    (form?.sightseeingDetails?.days ?? []).flatMap((day) =>
      (day?.activities ?? []).map((activity) => activity?.sightseeingId),
    ),
  );

  const hotelDetails = useQueries({
    queries: hotelIds.map((hotelId) => ({
      // Same key as the builder's useHotel: shared cache, no duplicate fetch.
      queryKey: ['masters', 'hotels', hotelId],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        apiClient.get<Hotel>(`/masters/hotels/${hotelId}`, signal),
      staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
    })),
  });
  const detailsById: Record<string, Hotel | undefined> = {};
  hotelIds.forEach((hotelId, index) => {
    const data = hotelDetails[index]?.data;
    if (data) detailsById[hotelId] = data;
  });

  const hotelImages = useQueries({
    queries: hotelIds.map((hotelId) => ({
      // Same key as the builder's per-row HotelPreview image query, so an
      // already-previewed hotel reuses its URL with no new request. Fires on
      // mount alongside the detail query (rather than waiting for it) so the
      // image resolves in the first round; hotels without images answer 404,
      // which never retries per the app query defaults and stays cached.
      queryKey: ['masters', 'hotels', hotelId, 'quotation-preview'],
      queryFn: () => hotelImageUrl(hotelId),
      staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
    })),
  });
  const hotelImageUrlsById: Record<string, string | undefined> = {};
  hotelIds.forEach((hotelId, index) => {
    const url = hotelImages[index]?.data?.url;
    if (url) hotelImageUrlsById[hotelId] = url;
  });

  const cruiseMastersById = useMemo(() => {
    const byId: Record<string, Cruise | undefined> = {};
    for (const master of masters?.cruises ?? []) byId[master.id] = master;
    return byId;
  }, [masters?.cruises]);
  const vehicleMastersById = useMemo(() => {
    const byId: Record<string, Vehicle | undefined> = {};
    for (const master of masters?.vehicles ?? []) byId[master.id] = master;
    return byId;
  }, [masters?.vehicles]);

  const cruiseIds = uniqueIds(cruiseRows.map((row) => row.cruiseId));
  const vehicleIds = uniqueIds(vehicleRows.map((row) => row.vehicleId));
  const cruiseImages = useQueries({
    queries: cruiseIds.map((cruiseId) => ({
      queryKey: ['masters', 'cruises', cruiseId, 'preview-image'],
      queryFn: () => cruiseImageUrl(cruiseId),
      enabled: cruiseMastersById[cruiseId]?.hasImage === true,
      staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
    })),
  });
  const vehicleImages = useQueries({
    queries: vehicleIds.map((vehicleId) => ({
      queryKey: ['masters', 'vehicles', vehicleId, 'preview-image'],
      queryFn: () => vehicleImageUrl(vehicleId),
      staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
      enabled: vehicleMastersById[vehicleId]?.hasImage === true,
    })),
  });
  const cruiseImageUrlsById: Record<string, string | undefined> = {};
  cruiseIds.forEach((cruiseId, index) => {
    const url = cruiseImages[index]?.data?.url;
    if (url) cruiseImageUrlsById[cruiseId] = url;
  });
  const vehicleImageUrlsById: Record<string, string | undefined> = {};
  vehicleIds.forEach((vehicleId, index) => {
    const url = vehicleImages[index]?.data?.url;
    if (url) vehicleImageUrlsById[vehicleId] = url;
  });

  // Same batch hook (and cache key) the builder's sightseeing editor uses.
  const sightseeingBatch = useSightseeingPresentations(sightseeingIds);

  const airlineIds = flightAirlineIds(form?.flightDetails);
  const airlineMastersById = useMemo(() => {
    const byId: Record<string, Airline | undefined> = {};
    for (const master of masters?.airlines ?? []) byId[master.id] = master;
    return byId;
  }, [masters?.airlines]);
  const airlineLogos = useQueries({
    queries: airlineIds.map((airlineId) => ({
      queryKey: ['masters', 'airlines', airlineId, 'preview-logo'],
      queryFn: () => airlineLogoUrl(airlineId),
      enabled: airlineMastersById[airlineId]?.logoConfirmedAt != null,
      staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
    })),
  });
  const airlineLogoUrlsById: Record<string, string | undefined> = {};
  airlineIds.forEach((airlineId, index) => {
    const url = airlineLogos[index]?.data?.url;
    if (url) airlineLogoUrlsById[airlineId] = url;
  });

  const heroMasterId = useMemo(
    () => matchDestinationMasterId(masters?.destinations ?? [], destinationSummary, itinerary),
    [masters?.destinations, destinationSummary, itinerary],
  );
  const heroImage = useQuery({
    queryKey: heroMasterId
      ? ['masters', 'destinations', heroMasterId, 'preview-hero']
      : ['masters', 'destinations', 'preview-hero', 'none'],
    queryFn: () => destinationImageUrl(heroMasterId!),
    enabled: Boolean(heroMasterId),
    staleTime: PREVIEW_PRESENTATIONS_STALE_MS,
  });

  // Built fresh on every render (no memo on form-derived values): nested form
  // objects can keep stable identities while their content mutates, so any
  // memo keyed on them could freeze on stale content. This is pure derivation
  // over small arrays; React Query dedupes the underlying fetches by key.
  const sightseeingPresentations: PreviewPresentations['sightseeingPresentations'] = {};
  for (const [id, entry] of Object.entries(sightseeingBatch.data ?? {})) {
    sightseeingPresentations[id] = { imageUrl: entry?.imageUrl ?? null };
  }
  return {
    heroImageUrl: heroImage.data?.url ?? null,
    airlinePresentations: buildAirlinePresentations(airlineIds, airlineMastersById, airlineLogoUrlsById),
    hotelPresentations: buildHotelPresentations(hotelRows, detailsById, hotelImageUrlsById),
    cruisePresentations: buildCruisePresentations(cruiseRows, cruiseMastersById, cruiseImageUrlsById),
    vehiclePresentations: buildVehiclePresentations(vehicleRows, vehicleMastersById, vehicleImageUrlsById),
    sightseeingPresentations,
  };
}
