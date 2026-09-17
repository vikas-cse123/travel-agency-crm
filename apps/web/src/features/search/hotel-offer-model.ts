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
): { mealPlan?: string | null; breakfastIncluded?: boolean } {
  const hay = [...(remarks ?? []), ...(amenities ?? []), ...(description ? [description] : [])]
    .join(' ')
    .toLowerCase();
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

function normalizedRoomName(name?: string | null): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
}

function bedsSignature(beds?: Array<{ count?: number; type?: string }> | null): string {
  if (!beds?.length) return '';
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
  const isRoomLevel = !!room && !!room.name;
  const roomName = room?.name ?? null;
  const guests = room?.num_guests ?? offer.num_guests ?? null;
  const beds = room?.beds ?? null;
  const amenities = room?.amenities ?? null;
  const description = room?.description ?? null;
  const meal = detectMealPlan(offer.remarks, amenities, description);
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
  details: SearchApiHotelPropertyDetails,
): HotelOfferOption[] {
  const offers = [...(details.featured_offers ?? []), ...(details.all_offers ?? [])];
  // Dedupe logic preserved from original flattenPropertyOffers
  const coveredByRooms = new Set<string>();
  for (const offer of offers) {
    if (offer.rooms?.length) coveredByRooms.add(`${offer.source ?? ''}\u0000${TOTAL_PRICE_AT(offer.total_price) ?? ''}`);
  }
  const seen = new Set<string>();
  const rows: HotelOfferOption[] = [];
  offers.forEach((offer, offerIdx) => {
    if (offer.rooms?.length) {
      offer.rooms.forEach((room, roomIdx) => {
        const total = room.total_price ?? offer.total_price;
        const key = `${offer.source ?? ''}\u0000${room.name ?? ''}\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push(normalizeHotelOfferOption(property, offer, room, { offerIdx, roomIdx }));
      });
    } else {
      const total = offer.total_price;
      const coveredKey = `${offer.source ?? ''}\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
      if (coveredByRooms.has(coveredKey)) return;
      const key = `${offer.source ?? ''}\u0000\u0000${TOTAL_PRICE_AT(total) ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(normalizeHotelOfferOption(property, offer, null, { offerIdx }));
    }
  });
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
