import type {
  SearchApiHotelProperty,
  SearchApiHotelPropertyDetails,
  SearchApiPrice,
  SearchApiPropertyOffer,
  SearchApiRoomOffer,
} from '@interscale/shared';

// ---------------------------------------------------------------------------
// Normalized presentation model – agent-first, no raw technical fields in UI
// ---------------------------------------------------------------------------

export interface HotelOfferOption {
  id: string;
  property: SearchApiHotelProperty;
  source?: string;
  logo?: string;
  isOfficial?: boolean;
  roomName?: string | null;
  isRoomLevel: boolean;
  description?: string | null;
  guests?: number | null;
  beds?: Array<{ count?: number; type?: string }> | null;
  amenities?: string[] | null;
  mealPlan?: string | null;
  breakfastIncluded?: boolean;
  pricePerNight?: SearchApiPrice | null;
  totalPrice?: SearchApiPrice | null;
  cancellation?: boolean | null;
  cancellationUntil?: { date?: string; time?: string } | null;
  remarks?: string[] | null;
  bookingLink?: string | null;
  /** Raw offer preserved for bookmark snapshot and developer tools */
  originalOffer: SearchApiPropertyOffer;
  /** Raw room preserved when isRoomLevel, else null */
  originalRoom?: SearchApiRoomOffer | null;
}

export interface HotelOfferGroup {
  key: string | null;
  roomName?: string | null;
  guests?: number | null;
  beds?: Array<{ count?: number; type?: string }> | null;
  isProviderOnly: boolean;
  options: HotelOfferOption[];
}

const TOTAL_PRICE_AT = (p?: SearchApiPrice | null) =>
  p?.extracted_price ?? p?.extracted_price_before_taxes ?? null;

function detectMealPlan(
  remarks?: string[] | null,
  amenities?: string[] | null,
  description?: string | null,
  breakfastFlag?: boolean,
): { mealPlan?: string | null; breakfastIncluded?: boolean } {
  const hay = [...(remarks ?? []), ...(amenities ?? []), ...(description ? [description] : [])]
    .join(' ')
    .toLowerCase();
  // Explicit provider flag (e.g. rooms[].has_breakfast) wins even when the
  // description does not mention breakfast.
  if (breakfastFlag === true) {
    if (/half board/i.test(hay)) return { mealPlan: 'Half Board', breakfastIncluded: true };
    if (/full board/i.test(hay)) return { mealPlan: 'Full Board', breakfastIncluded: true };
    if (/all inclusive/i.test(hay)) return { mealPlan: 'All Inclusive', breakfastIncluded: true };
    return { mealPlan: 'Breakfast included', breakfastIncluded: true };
  }
  if (!hay.trim()) return {};
  // breakfast is a meal plan – common variants
  if (/(breakfast included|free breakfast|complimentary breakfast|breakfast\b)/.test(hay)) {
    // try to extract meal plan name
    if (/half board/i.test(hay)) return { mealPlan: 'Half Board', breakfastIncluded: true };
    if (/full board/i.test(hay)) return { mealPlan: 'Full Board', breakfastIncluded: true };
    if (/all inclusive/i.test(hay)) return { mealPlan: 'All Inclusive', breakfastIncluded: true };
    return { mealPlan: 'Breakfast included', breakfastIncluded: true };
  }
  if (/half board/i.test(hay)) return { mealPlan: 'Half Board' };
  if (/full board/i.test(hay)) return { mealPlan: 'Full Board' };
  if (/all inclusive/i.test(hay)) return { mealPlan: 'All Inclusive' };
  if (/meal plan|board basis/i.test(hay)) return { mealPlan: hay.match(/[\w\s]+board/i)?.[0] ?? null };
  return {};
}

/** Room objects are untyped at runtime – read defensively without `any`. */
type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Actual room name on the wire. Canonical is `name`, but live provider
 * payloads also use `room_name` / `title` for the same concept. Never falls
 * back to the hotel name – a missing name means provider-only, not a room.
 */
export function extractRoomName(room: unknown): string | null {
  const rec = asRecord(room);
  if (!rec) return null;
  return (
    nonEmptyString(rec.name) ??
    nonEmptyString(rec.room_name) ??
    nonEmptyString(rec.title) ??
    nonEmptyString(rec.room_type) ??
    null
  );
}

function extractBreakfastFlag(room: unknown, offer: unknown): boolean | undefined {
  for (const rec of [asRecord(room), asRecord(offer)]) {
    if (!rec) continue;
    for (const key of ['has_breakfast', 'hasBreakfast', 'breakfast_included', 'breakfastIncluded']) {
      const v = rec[key];
      if (v === true) return true;
      if (v === false) return false;
    }
  }
  return undefined;
}

/**
 * Rooms nested inside an offer. Canonical is `offer.rooms[]`, but also
 * accepts a single object (`rooms: {...}` / `room: {...}`) and common
 * aliases so a valid room is never dropped by a shape check.
 */
export function extractRoomsFromOffer(offer: unknown): SearchApiRoomOffer[] {
  const rec = asRecord(offer);
  if (!rec) return [];
  const candidates: unknown[] = [
    ...asArray(rec.rooms),
    ...asArray(rec.room),
    ...asArray(rec.room_options),
    ...asArray(rec.roomOptions),
    ...asArray(rec.roomTypes),
    ...asArray(rec.room_types),
  ];
  // Single-object form: { rooms: { name: ... } } or { room: { name: ... } }
  for (const key of ['rooms', 'room']) {
    const single = asRecord(rec[key]);
    if (single) candidates.push(single);
  }
  return candidates.filter((c): c is SearchApiRoomOffer => asRecord(c) !== null);
}

/** One offer entry on the wire – mirrors SearchApiPropertyOffer plus aliases. */
function extractOfferSource(offer: unknown): string | undefined {
  const rec = asRecord(offer);
  if (!rec) return undefined;
  return (
    nonEmptyString(rec.source) ?? nonEmptyString(rec.provider) ?? nonEmptyString(rec.name) ?? undefined
  );
}

/**
 * Collect every supplier offer from the real property payload, regardless of
 * which top-level key the provider used. Canonical keys are
 * `featured_offers` + `all_offers`; `offers` and `booking_sources` (alternate
 * detail shape) are also honoured. Returns canonical offer objects – never
 * synthesises rooms.
 */
export function extractPropertyOffers(details: unknown): SearchApiPropertyOffer[] {
  const rec = asRecord(details);
  if (!rec) return [];
  const out: SearchApiPropertyOffer[] = [];
  for (const key of ['featured_offers', 'all_offers', 'offers', 'allOffers', 'featuredOffers']) {
    for (const entry of asArray(rec[key])) {
      if (asRecord(entry)) out.push(entry as SearchApiPropertyOffer);
    }
  }
  // Alternate detail shape: booking_sources[] with rate_per_night/total_rate.
  for (const entry of asArray(rec.booking_sources)) {
    const src = asRecord(entry);
    if (!src) continue;
    const ratePerNight = asRecord(src.rate_per_night) ?? asRecord(src.ratePerNight);
    const totalRate = asRecord(src.total_rate) ?? asRecord(src.totalRate);
    const toPrice = (p: UnknownRecord | null): SearchApiPrice | undefined => {
      if (!p) return undefined;
      const amount = typeof p.amount === 'number' ? p.amount : undefined;
      const display = typeof p.display === 'string' ? p.display : undefined;
      if (amount === undefined && display === undefined) return undefined;
      const price: SearchApiPrice = {};
      if (display) (price as UnknownRecord).price = display;
      if (amount !== undefined) (price as UnknownRecord).extracted_price = amount;
      return price;
    };
    const numGuests =
      typeof src.num_guests === 'number'
        ? src.num_guests
        : typeof src.numGuests === 'number'
          ? (src.numGuests as number)
          : undefined;
    const mapped: SearchApiPropertyOffer = {};
    const mappedSource =
      nonEmptyString(src.name) ?? nonEmptyString(src.source) ?? nonEmptyString(src.provider);
    if (mappedSource) mapped.source = mappedSource;
    const icon = nonEmptyString(src.icon) ?? nonEmptyString(src.logo);
    if (icon) mapped.logo = icon;
    const click = nonEmptyString(src.click) ?? nonEmptyString(src.tracking_link) ?? nonEmptyString(src.link);
    if (click) mapped.tracking_link = click;
    if (numGuests !== undefined) mapped.num_guests = numGuests;
    const perNight = toPrice(ratePerNight);
    if (perNight) mapped.price_per_night = perNight;
    const total = toPrice(totalRate);
    if (total) mapped.total_price = total;
    if (typeof src.sponsored === 'boolean' && src.sponsored) {
      mapped.remarks = ['Sponsored'];
    }
    out.push(mapped);
  }
  return out;
}

/**
 * Top-level rooms on the property itself (no parent offer). Each entry must
 * carry its own room-level name – otherwise it is ignored, never invented.
 */
function extractTopLevelRooms(details: unknown): SearchApiRoomOffer[] {
  const rec = asRecord(details);
  if (!rec) return [];
  const out: SearchApiRoomOffer[] = [];
  for (const key of ['rooms', 'room_list', 'roomList']) {
    for (const entry of asArray(rec[key])) {
      if (asRecord(entry) && extractRoomName(entry)) out.push(entry as SearchApiRoomOffer);
    }
  }
  return out;
}

/**
 * Resolve the details object from a raw property API response. Canonical is
 * `{ property: {...} }`; when the backend already returned the property
 * itself (has offer keys), that object is used directly so rooms are never
 * lost to a wrapper check.
 */
export function resolvePropertyDetails(response: unknown): SearchApiHotelPropertyDetails | undefined {
  const root = asRecord(response);
  if (!root) return undefined;
  const nested = asRecord(root.property);
  if (nested) return nested as unknown as SearchApiHotelPropertyDetails;
  const hasOfferShape =
    Array.isArray(root.featured_offers) ||
    Array.isArray(root.all_offers) ||
    Array.isArray(root.offers) ||
    Array.isArray(root.booking_sources) ||
    Array.isArray(root.rooms);
  if (hasOfferShape) return root as unknown as SearchApiHotelPropertyDetails;
  return undefined;
}

function normalizedRoomName(name?: string | null): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

function bedsSignature(beds?: Array<{ count?: number; type?: string }> | null): string {
  if (!Array.isArray(beds) || !beds.length) return '';
  return [...beds]
    .map((b) => `${b.count ?? 1}-${(b.type ?? '').trim().toLowerCase()}`)
    .sort()
    .join('|');
}

export function normalizeHotelOfferOption(
  property: SearchApiHotelProperty,
  offer: SearchApiPropertyOffer,
  room: SearchApiRoomOffer | null | undefined,
  indices: { offerIdx: number; roomIdx?: number },
): HotelOfferOption {
  const roomName = room ? extractRoomName(room) : null;
  const isRoomLevel = !!room && roomName !== null;
  const guests = room?.num_guests ?? offer.num_guests ?? null;
  // Provider shapes vary: keep beds only when it is an array, otherwise null.
  // A malformed value must never reach bookmark snapshots or key builders.
  const beds = Array.isArray(room?.beds) ? room.beds : null;
  const amenities = room?.amenities ?? null;
  const description = room?.description ?? null;
  const breakfastFlag = extractBreakfastFlag(room, offer);
  const meal = detectMealPlan(offer.remarks, amenities, description, breakfastFlag);
  const pricePerNight = room?.price_per_night ?? offer.price_per_night ?? null;
  const totalPrice = room?.total_price ?? offer.total_price ?? null;
  const cancellation = room?.has_free_cancellation ?? offer.has_free_cancellation ?? null;
  const cancellationUntil = room?.free_cancellation_until ?? offer.free_cancellation_until ?? null;
  const bookingLink = room?.link ?? offer.tracking_link ?? offer.link ?? null;
  const totalKey = TOTAL_PRICE_AT(totalPrice) ?? '';
  const idParts = [
    offer.source ?? 'unknown',
    normalizedRoomName(roomName) || '__provider__',
    String(guests ?? ''),
    String(totalKey),
    String(indices.offerIdx),
    String(indices.roomIdx ?? 'x'),
  ];
  const base: HotelOfferOption = {
    id: idParts.join('::'),
    property,
    isRoomLevel,
    originalOffer: offer,
    originalRoom: room ?? null,
  } as HotelOfferOption;
  // Assign optional fields without explicit undefined to satisfy exactOptionalPropertyTypes
  if (offer.source) (base as unknown as Record<string, unknown>).source = offer.source;
  if (offer.logo) (base as unknown as Record<string, unknown>).logo = offer.logo;
  if (offer.is_official !== undefined) (base as unknown as Record<string, unknown>).isOfficial = offer.is_official;
  if (roomName) (base as unknown as Record<string, unknown>).roomName = roomName;
  else (base as unknown as Record<string, unknown>).roomName = roomName;
  if (description) (base as unknown as Record<string, unknown>).description = description;
  if (guests !== null && guests !== undefined) (base as unknown as Record<string, unknown>).guests = guests;
  if (beds) (base as unknown as Record<string, unknown>).beds = beds;
  if (amenities) (base as unknown as Record<string, unknown>).amenities = amenities;
  if (meal.mealPlan) (base as unknown as Record<string, unknown>).mealPlan = meal.mealPlan;
  else if (meal.mealPlan === null) (base as unknown as Record<string, unknown>).mealPlan = null;
  if (meal.breakfastIncluded !== undefined) (base as unknown as Record<string, unknown>).breakfastIncluded = meal.breakfastIncluded;
  if (pricePerNight) (base as unknown as Record<string, unknown>).pricePerNight = pricePerNight;
  if (totalPrice) (base as unknown as Record<string, unknown>).totalPrice = totalPrice;
  if (cancellation !== null && cancellation !== undefined) (base as unknown as Record<string, unknown>).cancellation = cancellation;
  if (cancellationUntil) (base as unknown as Record<string, unknown>).cancellationUntil = cancellationUntil;
  if (offer.remarks) (base as unknown as Record<string, unknown>).remarks = offer.remarks;
  if (bookingLink) (base as unknown as Record<string, unknown>).bookingLink = bookingLink;
  return base;
}

/** Create normalized options from property details – replaces flattenPropertyOffers */
export function createHotelOfferOptions(
  property: SearchApiHotelProperty,
  details: SearchApiHotelPropertyDetails | UnknownRecord | null | undefined,
): HotelOfferOption[] {
  if (!details || typeof details !== 'object') return [];
  // Collect from the real runtime shape: featured/all first (canonical order),
  // then offers / booking_sources fallbacks. Never assumes a single key.
  const offers = extractPropertyOffers(details);
  if (
    (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV &&
    typeof console !== 'undefined'
  ) {
    try {
      const rec = details as UnknownRecord;
      console.debug('[hotel-offer-model] property offers shape', {
        featured: Array.isArray(rec.featured_offers) ? (rec.featured_offers as unknown[]).length : 0,
        all: Array.isArray(rec.all_offers) ? (rec.all_offers as unknown[]).length : 0,
        offers: Array.isArray(rec.offers) ? (rec.offers as unknown[]).length : 0,
        booking_sources: Array.isArray(rec.booking_sources)
          ? (rec.booking_sources as unknown[]).length
          : 0,
        topRooms: Array.isArray(rec.rooms) ? (rec.rooms as unknown[]).length : 0,
        collected: offers.length,
      });
    } catch {
      // logging must never break mapping
    }
  }
  // Dedupe logic preserved from original flattenPropertyOffers
  const coveredByRooms = new Set<string>();
  for (const offer of offers) {
    if (extractRoomsFromOffer(offer).length) {
      const src = extractOfferSource(offer) ?? offer.source ?? '';
      coveredByRooms.add(`${src}\u0000${TOTAL_PRICE_AT(offer.total_price) ?? ''}`);
    }
  }
  const seen = new Set<string>();
  const rows: HotelOfferOption[] = [];
  offers.forEach((offer, offerIdx) => {
    const rooms = extractRoomsFromOffer(offer);
    const src = extractOfferSource(offer) ?? offer.source ?? '';
    // Keep canonical source on the normalized offer when an alias was used.
    const canonicalOffer: SearchApiPropertyOffer = offer.source
      ? offer
      : src
        ? { ...offer, source: src }
        : offer;
    if (rooms.length) {
      rooms.forEach((room, roomIdx) => {
        const total = room.total_price ?? offer.total_price;
        const key = `${src}\u0000${extractRoomName(room) ?? ''}\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(normalizeHotelOfferOption(property, canonicalOffer, room, { offerIdx, roomIdx }));
      });
    } else {
      const total = offer.total_price;
      const coveredKey = `${src}\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
      if (coveredByRooms.has(coveredKey)) return;
      const key = `${src}\u0000\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(normalizeHotelOfferOption(property, canonicalOffer, null, { offerIdx }));
    }
  });
  // Top-level rooms[] with no parent offer (alternate provider shape): each
  // named room becomes its own room-level option under an unknown provider.
  // Unnamed entries are ignored – never invent a room name.
  const topRooms = extractTopLevelRooms(details);
  if (topRooms.length && rows.length === 0) {
    topRooms.forEach((room, roomIdx) => {
      const total = room.total_price;
      const key = `\u0000${extractRoomName(room) ?? ''}\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const syntheticOffer: SearchApiPropertyOffer = {};
      if (room.num_guests !== undefined) syntheticOffer.num_guests = room.num_guests;
      if (room.price_per_night) syntheticOffer.price_per_night = room.price_per_night;
      if (room.total_price) syntheticOffer.total_price = room.total_price;
      if (room.has_free_cancellation !== undefined)
        syntheticOffer.has_free_cancellation = room.has_free_cancellation;
      if (room.free_cancellation_until)
        syntheticOffer.free_cancellation_until = room.free_cancellation_until;
      if (room.link) syntheticOffer.link = room.link;
      rows.push(
        normalizeHotelOfferOption(property, syntheticOffer, room, {
          offerIdx: offers.length + roomIdx,
          roomIdx,
        }),
      );
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Grouping by room when room data exists – safe normalized identity
// ---------------------------------------------------------------------------

export function roomGroupKey(opt: HotelOfferOption): string | null {
  if (!opt.isRoomLevel || !opt.roomName) return null;
  const norm = normalizedRoomName(opt.roomName);
  const bedsSig = bedsSignature(opt.beds);
  // Material attributes: norm name + guests + beds + meal/breakfast
  // Cancellation intentionally NOT part of key – different cancellation remains same group but shown per-supplier
  return [norm, String(opt.guests ?? ''), bedsSig, opt.mealPlan ?? '', opt.breakfastIncluded ? 'bf' : 'nobf'].join('::');
}

export function groupHotelOfferOptions(options: HotelOfferOption[]): HotelOfferGroup[] {
  const byKey = new Map<string, HotelOfferOption[]>();
  const providerOnly: HotelOfferOption[] = [];
  for (const opt of options) {
    const key = roomGroupKey(opt);
    if (key === null) {
      providerOnly.push(opt);
    } else {
      const arr = byKey.get(key);
      if (arr) arr.push(opt);
      else byKey.set(key, [opt]);
    }
  }
  const groups: HotelOfferGroup[] = [];
  for (const [key, opts] of byKey.entries()) {
    // Use first option's room metadata for group header
    const first = opts[0]!;
    // Sort within group by total ascending (cheapest first)
    opts.sort((a, b) => {
      const pa = a.totalPrice?.extracted_price ?? a.totalPrice?.extracted_price_before_taxes ?? Infinity;
      const pb = b.totalPrice?.extracted_price ?? b.totalPrice?.extracted_price_before_taxes ?? Infinity;
      return pa - pb;
    });
    groups.push({
      key,
      roomName: first.roomName ?? null,
      guests: first.guests ?? null,
      beds: first.beds ?? null,
      isProviderOnly: false,
      options: opts,
    } as HotelOfferGroup);
  }
  // Provider-only each as separate group (no merging – avoid pretending same product)
  for (const opt of providerOnly) {
    groups.push({
      key: null,
      roomName: null,
      guests: opt.guests ?? null,
      beds: opt.beds ?? null,
      isProviderOnly: true,
      options: [opt],
    } as HotelOfferGroup);
  }
  // Keep provider insertion order – no global sort (toolbar sort controls order if needed)
  // Preserve room groups first, then provider-only in original appearance order
  return groups;
}

// ---------------------------------------------------------------------------
// Toolbar helpers – sorting & filtering (client-side, no extra API calls)
// ---------------------------------------------------------------------------

export type HotelOfferSort = 'total' | 'perNight';
export interface HotelOfferFilters {
  freeCancellationOnly?: boolean;
  breakfastOnly?: boolean;
  supplier?: string; // 'all' or source name
  guests?: number | 'all';
}

export function filterHotelOfferOptions(
  options: HotelOfferOption[],
  filters: HotelOfferFilters,
): HotelOfferOption[] {
  return options.filter((o) => {
    if (filters.freeCancellationOnly && o.cancellation !== true) return false;
    if (filters.breakfastOnly && !o.breakfastIncluded) return false;
    if (filters.supplier && filters.supplier !== 'all' && o.source !== filters.supplier) return false;
    if (filters.guests !== undefined && filters.guests !== 'all' && o.guests !== filters.guests) return false;
    return true;
  });
}

export function sortHotelOfferOptions(
  options: HotelOfferOption[],
  sortBy: HotelOfferSort,
): HotelOfferOption[] {
  const copy = [...options];
  if (sortBy === 'perNight') {
    copy.sort((a, b) => {
      const pa = a.pricePerNight?.extracted_price ?? a.pricePerNight?.extracted_price_before_taxes ?? Infinity;
      const pb = b.pricePerNight?.extracted_price ?? b.pricePerNight?.extracted_price_before_taxes ?? Infinity;
      return pa - pb;
    });
  } else {
    copy.sort((a, b) => {
      const pa = a.totalPrice?.extracted_price ?? a.totalPrice?.extracted_price_before_taxes ?? Infinity;
      const pb = b.totalPrice?.extracted_price ?? b.totalPrice?.extracted_price_before_taxes ?? Infinity;
      return pa - pb;
    });
  }
  return copy;
}

export function getOfferSuppliers(options: HotelOfferOption[]): string[] {
  return [...new Set(options.map((o) => o.source).filter(Boolean) as string[])].sort();
}

export function getOfferGuestCounts(options: HotelOfferOption[]): number[] {
  return [...new Set(options.map((o) => o.guests).filter((v): v is number => typeof v === 'number'))].sort((a, b) => a - b);
}

// Helper for price extraction for badge calculation
export function cheapestInGroup(group: HotelOfferGroup): HotelOfferOption | null {
  if (!group.options.length) return null;
  let cheapest = group.options[0]!;
  let min = cheapest.totalPrice?.extracted_price ?? cheapest.totalPrice?.extracted_price_before_taxes ?? Infinity;
  for (const opt of group.options) {
    const p = opt.totalPrice?.extracted_price ?? opt.totalPrice?.extracted_price_before_taxes ?? Infinity;
    if (p < min) {
      min = p;
      cheapest = opt;
    }
  }
  return cheapest;
}

export function countUniqueRooms(options: HotelOfferOption[]): number {
  const set = new Set<string>();
  for (const opt of options) {
    if (!opt.isRoomLevel || !opt.roomName) continue;
    set.add(normalizedRoomName(opt.roomName));
  }
  return set.size;
}
