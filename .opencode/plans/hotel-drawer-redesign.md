# Plan: Hotel Live Search → View Rooms & Offers – Travel-Agent-First Redesign

## Context
Current `HotelRoomsDrawer` treats every `flattenPropertyOffers()` output as a "Room" (`HotelRoomRow`) and renders `RoomOfferCard` with `ApiDataTree` + raw `API Response` per card. This feels like an API inspector. Goal: agent-first rate comparison workspace, keep backend contract (`GET /search/hotels/property` → `google_hotels_property`, caching, credit, auth, bookmark `HTL-*`) untouched. UI-only refactor.

**Files in scope:** `apps/web/src/pages/search/TravelSearchPage.tsx` (`HotelRoomsDrawer`, `flattenPropertyOffers`, `RoomOfferCard`, `HotelPropertyCard`, `useHotelProperty`), `apps/web/src/features/search/search.api.ts`, `apps/web/src/features/search/hotel-images.ts`, `packages/shared/src/search.ts` (types `SearchApiHotelPropertyDetails`, `SearchApiPropertyOffer`, `SearchApiRoomOffer`, `SearchApiPrice`), `apps/web/src/features/quotations/BookmarkImport.tsx` (quotation flow). No backend `apps/api/src/modules/search/*` changes unless needed for normalization (avoid).

---

## 1. Normalized Presentation Model (per §7)

**New file/module:** `apps/web/src/features/search/hotel-offer-model.ts` (or co-located in `TravelSearchPage.tsx` if prefer single-file)

```ts
export interface HotelOfferOption {
  id: string                    // stable: `${source}::${roomName}::${price}::${index}`
  property: SearchApiHotelProperty // original card property (for header, token, data_id)
  source?: string               // offer.source – Booking.com, Agoda
  logo?: string
  isOfficial?: boolean
  roomName?: string | null      // room.name when present
  isRoomLevel: boolean          // true if rooms[] existed and this row came from a room; false = provider offer only
  description?: string | null   // room.description
  guests?: number | null
  beds?: Array<{count?:number,type?:string}> | null
  amenities?: string[] | null   // room.amenities only when provider returns it for that room
  mealPlan?: string | null      // derived from remarks / amenity strings
  breakfastIncluded?: boolean   // parsed from remarks/amenities + offer.remarks
  pricePerNight?: SearchApiPrice | null
  totalPrice?: SearchApiPrice | null
  cancellation?: boolean | null // has_free_cancellation
  cancellationUntil?: {date?:string,time?:string} | null
  remarks?: string[] | null
  bookingLink?: string | null   // room.link ?? offer.tracking_link ?? offer.link
  originalOffer: SearchApiPropertyOffer
  originalRoom?: SearchApiRoomOffer | null
}

function detectMealPlan(remarks?:string[], amenities?:string[], description?:string): {mealPlan?:string,breakfastIncluded?:boolean}
function normalizePrice(p?:SearchApiPrice): {main?:string, beforeTaxes?:string} // hide extracted_price fields from UI, keep in state

export function normalizeHotelOfferOption(
  property: SearchApiHotelProperty,
  offer: SearchApiPropertyOffer,
  room?: SearchApiRoomOffer | null,
  index?: {offerIdx:number, roomIdx?:number}
): HotelOfferOption
```

**Handle 15. Do not lose data:** keep `originalOffer`/`originalRoom` + raw `pricePerNight`/`totalPrice` objects in state for bookmark/debug.

**Shared helpers already exist:** `formatBeds`, `priceDisplay` but replace `pval` showing `extracted_price` – use presentation `price?.price ?? price?.price_before_taxes` only; keep `extracted_*` in object but not UI (per §6).

### Mapping Rules (§8 preserve)

* `isRoomLevel = !!room && !!room.name` (offer with `rooms:[]` → multiple options with room; offer without `rooms` → one option `isRoomLevel=false`, `roomName=null`)
* `guests = room.num_guests ?? offer.num_guests`
* `pricePerNight = room.price_per_night ?? offer.price_per_night`
* `totalPrice = room.total_price ?? offer.total_price`
* `cancellation = room.has_free_cancellation ?? offer.has_free_cancellation`
* `bookingLink = room.link ?? offer.tracking_link ?? offer.link`
* `beds/amenities/description` only from `room` when present (offer-level amenities stay hotel-level, not per-rate)
* `mealPlan/breakfastIncluded` parsed from `remarks` + `room.amenities` + `offer.remarks` strings containing `breakfast|half board|meal` (case-insensitive) – tolerates missing fields.
* `id` stable for React keys and cheapest calculation: `normalizeRoomName(roomName) + guests + mealPlan + breakfastSign + cancellationSign + source`

**Caller:** New `flattenPropertyOffers` replacement `createOfferOptions(propertyDetails) → HotelOfferOption[]` using `featured_offers + all_offers` same order, same dedupe logic but producing `HotelOfferOption` instead of `HotelRoomRow`. Keep deduplication key `source + normalizedRoomName + totalPrice.price` to avoid duplicate supplier rows (existing logic with `coveredByRooms`).

---

## 2. Grouping (§3)

**Do NOT group different products.**

```ts
function roomGroupKey(opt: HotelOfferOption): string | null {
  if (!opt.isRoomLevel || !opt.roomName) return null; // provider-only → no group
  const normName = opt.roomName.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9 ]/g,'');
  // safe identity: normName + guests + beds signature + meal/breakfast (material differences)
  const bedsSig = (opt.beds ?? []).map(b=>`${b.count}-${b.type}`).sort().join('|');
  return [normName, opt.guests ?? '', bedsSig, opt.mealPlan ?? '', opt.breakfastIncluded ? 'bf' : 'nobf'].join('::');
}
function groupOfferOptions(options: HotelOfferOption[]): Array<{key:string|null, roomName?:string, guests?:number, beds?:..., options:HotelOfferOption[]}>
```

* Group only when `key !== null` and group size >1 with **equivalent** offers (same `guests`, same `bedsSig`, same `mealPlan/breakfast`). If cancellation differs, keep same group but surface per-supplier badge (material but not splitting group – design shows per-supplier Benefits). If `guests` differs → different keys → separate groups.
* Provider-only options (`isRoomLevel=false`) → **no group**, render as `Provider Rate` card.

**Render:**

```
Room Group → header Large Double Room · 2 guests · 1 double bed [n offers] → table/stack
  Supplier | Total | Benefits (Breakfast, Free cancellation) | Select
  Rows sorted by total asc (or per-night)
Provider Rate → single cards (same component but isRoomLevel=false → hide beds/room amenity)
```

**Responsive:** Flex column on < `lg`, grid `supplier 1fr price auto benefits auto action` on `lg`. No horizontal table overflow.

---

## 3. Drawer Structure (§2,12,13)

```
HotelRoomsDrawer (fixed inset-0 z-50 flex center bg-black/50)
  role=dialog max-w-3xl -> max-w-4xl for comparison (more width)
  HEADER (border-b p-4 flex justify between)
    h2 property.name + Stars
    sub: address • rating • check_in/out • searched dates (formatDateRange) • adults guests (params.adults) • Escape + X
  HOTEL-LEVEL SECONDARY (collapsible “Hotel details” SectionCard, default collapsed)
    HotelGallery, NearbyPlacesSection, ReviewsSection, amenities chips, essential_info – existing components moved here, not per-rate
  RATE & ROOM COMPARISON (main)
    Toolbar compact: total options count | Sort [Lowest Total | Lowest Per Night] | Filters: Free Cancellation (toggle), Breakfast (toggle), Supplier <select>, Guests <select> | Results count
    Groups → Provider Rates
  DEVELOPER TOOLS (bottom, gated)
    <details> Developer tools → View Raw API Response → <pre>{JSON.stringify(query.data, null, 2)}</pre> – single instance, not per card
```

*A. Header*: Keep existing `Stars`, `MapPin`, `Star rating`, `Clock check_in`, `Moon check_out`, `Users guests`, `formatDateRange` but add `Change Search` link that calls `onClose` and scroll to search form (optional, not required now).

*B. Change Search action*: If requested later, emit event or simply close drawer – user can adjust TravelSearchPage form without extra call.

### Toolbar State

* `sortBy: 'total' | 'perNight'` → `useMemo sorted = [...options].sort((a,b)=>extracted_price compare)` using `extracted_price ?? extracted_price_before_taxes` numeric, `null` last.
* Filters: `freeCancellationOnly: boolean`, `breakfastOnly: boolean`, `supplier: string|'all'`, `guests: number|'all'` – applied after grouping? Better filter raw options then regroup.
* Count badge `n options` before/after filters.

### Highlights (§10)

Only within **equivalent group** (`same roomGroupKey`):
* `cheapestTotal` = min `totalPrice.extracted_price`
* `isOfficial` already on option
* `breakfastIncluded` / `freeCancellation` per option
* Badges: `Lowest rate` (emerald), `Official site` (badge still), `Breakfast included`, `Free cancellation`
* **Do not** compare across groups with different `guests/mealPlan/name`.

Compute per group: `minTotal = Math.min(...group.options.map(o=>o.totalPrice?.extracted_price).filter(Boolean))` – badge on option where `price == min` and `group.options.length>1`.

Optional savings: `savings vs max in group` text small.

---

## 4. Card Redesign (§4,11) – Single Component `RateOptionCard`

**Props:** `{groupKey, groupRoomName, options:HotelOfferOption[]}` vs `{option:HotelOfferOption}` – unify into `OfferGroupCard` that renders group header + stacked supplier rows.

**Structure for isRoomLevel group (3 suppliers):**

```
┌──────────────────────────────────────────────┐
│ Large Double Room                       3 offers │  <-- group header, guest/bed summary, count
│ 2 guests · 1 double bed                      │
├──────────────────────────────────────────────┤
│ Supplier    Total      Benefits            Action │
│ Booking.com ₹19,184 ✅ Breakfast ✅ Free cancel [Select] Booking link ↗
│ Bluepillow  ₹18,117      ✅ Free cancel    [Select]
│ Agoda       ₹21,315      ✅ Free cancel    [Select]
│ (lowest badge on Bluepillow)                │
│ More details ▾ (expand: room description, beds, amenities, remarks) │
└──────────────────────────────────────────────┘
```

**Stacked responsive:** On `base` → each supplier row is own mini-card with `supplier logo + Breakfast/FreeCancel chips` → `₹total / ₹perNight` right-aligned → `[Add to Quotation]` full width.

**Provider-only card (§3 bottom):**

```
Provider Rate
Supplier: The Nest Lucknow · Official site?
₹16,194 total · ₹2,699 / night
2 guests · Free cancellation until Sep 30
More details ▾
[Add to Quotation]  Booking link ↗
```

**Details expandable:** `<button More details>` toggles `ApiDataTree` **only for non-primary fields** – show `amenities (room-level only when present), remarks, beds detailed, cancellationUntil, link` but hide `extracted_price` duplicate, `property_token`, `tracking_link` raw (keep in `bookingLink`). No `API Response` per card.

**Action:** `Add to Quotation` → `addToQuotation(option)` → `create.mutate {type:HOTEL, searchParams, snapshot:{hotel:{...property fields 6 images max, city, country, stars, rating, address, coordinates, pricePerNight/Total, checkIn/Out, link} selectedRoom:{roomName, supplier, logo, isOfficial, offerLink=bookingLink, guests, pricePerNight/total + beforeTaxes, freeCancellation, beds, roomAmenities}} raw:{response, property, detail, offer:originalOffer, room:originalRoom}}` – **preserve exact existing mutation payload** – only source is `normalizeHotelOfferOption` fields mapping to same keys. Keep `propertyToken/dataId` for bookmark dedup.

---

## 5. Cleanup (§5,6,14)

* **Remove per-card:** `ApiDataTree` for `offerWithoutRooms`/`room`, `PrimitiveValue2` debug, `details API Response` `<pre>` inside `RoomOfferCard`.
* **Single developer section:** Bottom of drawer, `import.meta.env.DEV` or `user.role===ADMIN` gate: `<details><summary>Developer tools</summary><button>View Raw API Response</button><pre>{JSON.stringify(query.data ?? property, null, 2)}</pre></details>` – keep full `query.data` + `property` + flattened options count for debugging.
* **Hide technical fields from agent UI:** `extracted_price*` shown only via `priceDisplay` `price/main` (`price.price` or `price_before_taxes`) – not `extracted_price_before_taxes` label. `property_token`, `data_id`, `tracking_link` raw not shown except as `Booking link` button.
* **Keep in state:** `originalOffer/originalRoom` + full `SearchApiPrice` objects for downstream bookmark – not deleted, just not rendered.

---

## 6. Type Safety & Preservation

* New `hotel-offer-model.ts` exports `HotelOfferOption`, `normalizeHotelOfferOption`, `roomGroupKey`, `groupOfferOptions`, `sortOptions`, `filterOptions`.
* Replace `HotelRoomRow` with `HotelOfferOption` but keep `HotelRoomRow` alias for backward compat or remove after refactor – update `flattenPropertyOffers` signature.
* `HotelPropertyCard` stays unchanged – still shows `BookmarkButton` for whole property (provider-level bookmark). `HotelRoomsDrawer` keeps `useHotelProperty` same `queryKey` → `GET /search/hotels/property` – **1 credit per uncached** unchanged, `stale 10m`, `gc 30m`, no `refetchOnMount`.
* Bookmark mutation snapshot structure **must remain byte-identical shape** – verify against `bookmarks.service.ts hotelFingerprint` and `BookmarkImport hotelBookmarkToDetails` – property `property_token` + `data_id` required.

---

## 7. Implementation Steps

**A. Inspection (done):** `TravelSearchPage.tsx:3362 HotelRoomsDrawer`, `2517 flattenPropertyOffers`, `2692 RoomOfferCard`, `search.api.ts:275 useHotelProperty`, `packages/shared/src/search.ts:485-553` types, `features/quotations/BookmarkImport.tsx:328 hotelBookmarkToDetails`.

**B. New file `hotel-offer-model.ts`** + unit tests for:
* Case 1: `Agoda` 3 rooms → 3 options `isRoomLevel true`
* Case 2: `The Nest Lucknow` offer without rooms → 1 option `isRoomLevel false`
* Case 3: Same room `Large Double` from 3 suppliers → grouped `key` same, `options.length 3`, cheapest badge on min
* Case 4: Different `has_free_cancellation` → same group but per-supplier badge differs
* Case 5: Breakfast in `remarks` only some → `breakfastIncluded` true only those
* Case 6: Missing `beds`, `guests`, `cancellation` → tolerates `null`

**C. Refactor `HotelRoomsDrawer`:**
* Replace `rows:HotelRoomRow[]` with `options:HotelOfferOption[] = createOfferOptions(detail)`
* Add toolbar state `sortBy`, `filters`, `supplierOptions` derived from `options`
* Compute `filtered = filterOptions(options)` → `groups = groupOfferOptions(filtered)` → `sortedGroups`
* Render `HotelHeader` + `Hotel Secondary Collapsible` + `Toolbar` + `groups.map → OfferGroupCard | ProviderRateCard` + `DeveloperTools` single
* Keep `useHotelProperty` call, loading/error/empty states, `addToQuotation` logic mapped to `HotelOfferOption`

**D. New components:** `OfferGroupCard.tsx`, `ProviderRateCard.tsx`, `RateOptionRow.tsx`, `HotelOfferBadges.tsx`, `DeveloperTools.tsx` (or inline in drawer file to stay focused)

**E. Styles:** Use existing `Card`, `Badge`, `Chip`, `Button` – compact B2B: `text-sm` roomName `font-semibold`, `text-xs` supplier/guest/beds `text-muted-foreground`, `Badge variant success/outline` for `Lowest/Official/Breakfast/FreeCancel`, `price text-base font-semibold`, no huge nested cards, `responsive grid lg:grid-cols-2` for groups, stacked `flex-col sm:flex-row` for supplier rows.

**F. Preserve bookmark:** `addToQuotation(row)` → `addToQuotation(option)` mapping fields 1:1, keep `hotel.images slice 0..6`, `coordinates`, `selectedRoom` shape. Test `BookmarksPage.tsx:537 HotelRoomBookmarkRow` still reads snapshot.

**G. Verification:**
* `npm run build` `tsc -b` + `vite build` – no `any` leaking from `SearchApiPrice`
* `npm test` existing `LiveData.test.tsx`, `TravelSearchPage.test.tsx` – update snapshots for new drawer text (no `API Response` per card)
* Manual cases:
  1. Agoda multi-room → 3 rooms listed
  2. Nest Lucknow provider-only → Provider Rate
  3. Booking.com + Agoda + Bluepillow same room → grouped, lowest badge
  4. Cancellation diff → badge per supplier
  5. Breakfast only some → tick only those
  6. Missing data → no crash, `—` fallback
  7. Add to Quotation → `HTL-xxxxxx` saved, `BookmarksPage` shows grouped, `QuotationBuilder Hotel Bookmark ID` loads via `hotelBookmarkToDetails`
  8. Close/reopen drawer → `getSearchApiRequestCounts() google_hotels_property` still `1`, no refetch (Network tab 0)

---

## 8. Risks & Non-Goals

* **Do NOT** modify `apps/api/src/modules/search/search.service.ts` `hotelPropertyParams` or `executeProviderSearch` – credit/caching stays.
* **Do NOT** change `searchKeys.hotelProperty` shape – would invalidate cache and burn credits.
* **Do NOT** add new provider calls for sorting/filtering – pure client-side.
* **Do NOT** invent room attributes – `mealPlan` only from explicit `remarks/amenities` strings.
* **Do NOT** redesign unrelated `Flight` or `HotelPropertyCard` list – isolated to drawer.

---

## 9. File Impact

* **Create:** `apps/web/src/features/search/hotel-offer-model.ts` (+ test `hotel-offer-model.test.ts`)
* **Edit:** `apps/web/src/pages/search/TravelSearchPage.tsx` – replace `flattenPropertyOffers`, `HotelRoomsDrawer`, `RoomOfferCard`, `ApiDataTree` per-card, `GenericTree` per-card, keep `HotelPropertyCard` as is.
* **No edit:** `packages/shared/src/search.ts` (types already sufficient), `apps/api/*`, `apps/web/src/features/search/search.api.ts`

**Estimated diff:** `+400 -250 lines` in `TravelSearchPage.tsx` + new `150 lines` model file. Build time unchanged.

---

## 10. Rollback

Feature flag not needed per spec (temporary marketing = stack, but hotel UX is permanent). If needed, keep `flattenPropertyOffers` legacy behind `import.meta.env.VITE_HOTEL_DRAWER_V2` toggle for A/B.

