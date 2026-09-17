import { describe, expect, it } from 'vitest';
import {
  countUniqueRooms,
  createHotelOfferOptions,
  extractPropertyOffers,
  extractRoomName,
  extractRoomsFromOffer,
  filterHotelOfferOptions,
  groupHotelOfferOptions,
  resolvePropertyDetails,
  sortHotelOfferOptions,
} from './hotel-offer-model';

const property = {
  name: 'Hyatt Regency Lucknow',
  property_token: 'tok-hyatt',
} as never;

/**
 * REAL Hyatt-like runtime shape that previously produced the missing-room bug:
 * - room offers live under `offers` (not featured/all)
 * - rooms[] nested inside each offer with room-level fields
 * - provider-only offers coexist and must NOT become rooms
 *
 * Before the fix createHotelOfferOptions() only read featured_offers/all_offers
 * and returned 0 options for this payload → drawer showed "No rooms or offers".
 */
const hyattOffersShape = {
  property_token: 'tok-hyatt',
  name: 'Hyatt Regency Lucknow',
  offers: [
    {
      source: 'Booking.com',
      logo: 'https://logo/booking.png',
      num_guests: 2,
      remarks: ['Breakfast'],
      price_per_night: { price: '₹3,166', extracted_price: 3166 },
      total_price: { price: '₹19,000', extracted_price: 19000 },
      has_free_cancellation: true,
      free_cancellation_until: { date: 'Sep 25', time: '11:59 PM' },
      tracking_link: 'https://book.example/booking',
      rooms: [
        {
          name: 'Large Double Room',
          description: 'Breakfast included',
          num_guests: 2,
          beds: [{ count: 2 }],
          amenities: ['Balcony'],
          price_per_night: { price: '₹3,166', extracted_price: 3166 },
          total_price: { price: '₹19,000', extracted_price: 19000 },
          has_free_cancellation: true,
          link: 'https://book.example/large-double',
        },
        {
          name: 'Standard King Room',
          description: 'Free cancellation',
          num_guests: 2,
          beds: [{ count: 1, type: 'king' }],
          price_per_night: { price: '₹3,500', extracted_price: 3500 },
          total_price: { price: '₹21,000', extracted_price: 21000 },
          has_free_cancellation: true,
          link: 'https://book.example/king',
        },
      ],
    },
    {
      source: 'Agoda',
      num_guests: 2,
      price_per_night: { price: '₹3,000', extracted_price: 3000 },
      total_price: { price: '₹18,000', extracted_price: 18000 },
      has_free_cancellation: false,
      tracking_link: 'https://book.example/agoda',
    },
  ],
};

describe('hotel-offer-model regression – real offers[] shape', () => {
  it('finds room offers under offers[] (not only featured/all)', () => {
    const offers = extractPropertyOffers(hyattOffersShape);
    expect(offers.length).toBe(2);
  });

  it('creates room-level options from offers[].rooms[] without faking data', () => {
    const options = createHotelOfferOptions(property, hyattOffersShape as never);
    // 2 rooms + 1 provider-only = 3 rate options, 2 unique rooms
    expect(options.length).toBe(3);
    expect(countUniqueRooms(options)).toBe(2);

    const large = options.find((o) => o.roomName === 'Large Double Room');
    expect(large).toBeDefined();
    expect(large?.isRoomLevel).toBe(true);
    expect(large?.source).toBe('Booking.com');
    expect(large?.guests).toBe(2);
    expect(large?.beds).toEqual([{ count: 2 }]);
    expect(large?.breakfastIncluded).toBe(true);
    expect(large?.cancellation).toBe(true);
    expect(large?.totalPrice?.extracted_price).toBe(19000);
    expect(large?.pricePerNight?.extracted_price).toBe(3166);
    expect(large?.bookingLink).toBe('https://book.example/large-double');
    expect(large?.description).toBe('Breakfast included');
  });

  it('shows provider-only offers as Provider Rate without inventing a room', () => {
    const options = createHotelOfferOptions(property, hyattOffersShape as never);
    const agoda = options.find((o) => o.source === 'Agoda');
    expect(agoda).toBeDefined();
    expect(agoda?.isRoomLevel).toBe(false);
    expect(agoda?.roomName).toBeNull();
  });

  it('groups each unique room separately with suppliers inside', () => {
    const options = createHotelOfferOptions(property, hyattOffersShape as never);
    const groups = groupHotelOfferOptions(options);
    // 2 room groups + 1 provider-only = 3 groups
    expect(groups.length).toBe(3);
    const roomGroups = groups.filter((g) => !g.isProviderOnly);
    expect(roomGroups.length).toBe(2);
    expect(roomGroups.map((g) => g.roomName).sort()).toEqual([
      'Large Double Room',
      'Standard King Room',
    ]);
  });

  it('counts, filtering, sorting and grouping preserve rooms', () => {
    const options = createHotelOfferOptions(property, hyattOffersShape as never);
    // counts from actual normalized data
    expect(countUniqueRooms(options)).toBe(2);

    // filtering with empty filters keeps everything
    expect(filterHotelOfferOptions(options, {}).length).toBe(3);
    // breakfast filter keeps only breakfast rooms (Large Double has breakfast)
    const breakfastOnly = filterHotelOfferOptions(options, { breakfastOnly: true });
    expect(breakfastOnly.length).toBeGreaterThan(0);
    expect(breakfastOnly.every((o) => o.breakfastIncluded)).toBe(true);

    // sorting keeps all rooms
    expect(sortHotelOfferOptions(options, 'total').length).toBe(3);
    expect(sortHotelOfferOptions(options, 'perNight').length).toBe(3);
    expect(groupHotelOfferOptions(sortHotelOfferOptions(options, 'total')).length).toBe(3);
  });

  it('resolves wrapped and unwrapped property responses', () => {
    expect(resolvePropertyDetails({ property: hyattOffersShape })?.name).toBe(
      'Hyatt Regency Lucknow',
    );
    // backend already returned the property itself
    expect(resolvePropertyDetails(hyattOffersShape)?.name).toBe('Hyatt Regency Lucknow');
    expect(resolvePropertyDetails(undefined)).toBeUndefined();
    expect(resolvePropertyDetails({})).toBeUndefined();
  });

  it('handles single-object rooms, room_name alias, booking_sources and has_breakfast', () => {
    // single object instead of array
    const single = {
      featured_offers: [{ source: 'Booking.com', rooms: { name: 'Large Double Room' } }],
    };
    const singleOpts = createHotelOfferOptions(property, single as never);
    expect(singleOpts.length).toBe(1);
    expect(singleOpts[0]?.isRoomLevel).toBe(true);

    // room_name alias
    expect(extractRoomName({ room_name: 'Large Double Room' })).toBe('Large Double Room');
    const aliasOpts = createHotelOfferOptions(property, {
      featured_offers: [{ source: 'Booking.com', rooms: [{ room_name: 'Large Double Room' }] }],
    } as never);
    expect(countUniqueRooms(aliasOpts)).toBe(1);

    // single room entry via room key
    expect(extractRoomsFromOffer({ room: { name: 'Solo' } }).length).toBe(1);

    // booking_sources alternate shape
    const bsOpts = createHotelOfferOptions(property, {
      booking_sources: [
        {
          name: 'Booking.com',
          rate_per_night: { display: '₹3,166', amount: 3166 },
          total_rate: { display: '₹19,000', amount: 19000 },
          num_guests: 2,
        },
      ],
    } as never);
    expect(bsOpts.length).toBe(1);
    expect(bsOpts[0]?.source).toBe('Booking.com');

    // has_breakfast flag without description text
    const bfOpts = createHotelOfferOptions(property, {
      featured_offers: [
        { source: 'Booking.com', rooms: [{ name: 'Large Double Room', has_breakfast: true }] },
      ],
    } as never);
    expect(bfOpts[0]?.breakfastIncluded).toBe(true);
  });

  it('coerces non-array beds to null instead of passing provider shapes through', () => {
    const opts = createHotelOfferOptions(property, {
      featured_offers: [
        { source: 'Agoda', rooms: [{ name: 'Bunk Bed', num_guests: 2, beds: '1 bunk bed' }] },
      ],
    } as never);
    expect(opts.length).toBe(1);
    expect(opts[0]?.isRoomLevel).toBe(true);
    expect(opts[0]?.roomName).toBe('Bunk Bed');
    // absent (never a malformed provider value); snapshot layer maps this to null
    expect(opts[0]?.beds ?? null).toBeNull();
    // grouping / counting still work with the coerced option
    expect(countUniqueRooms(opts)).toBe(1);
    expect(groupHotelOfferOptions(opts).length).toBe(1);
  });

  it('never invents rooms for unnamed or empty payloads', () => {
    expect(createHotelOfferOptions(property, null).length).toBe(0);
    expect(createHotelOfferOptions(property, undefined).length).toBe(0);
    expect(createHotelOfferOptions(property, {} as never).length).toBe(0);
    // unnamed top-level rooms are ignored
    expect(
      createHotelOfferOptions(property, { rooms: [{ description: 'no name' }] } as never).length,
    ).toBe(0);
  });
});
