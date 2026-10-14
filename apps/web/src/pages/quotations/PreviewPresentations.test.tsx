import { describe, expect, it } from 'vitest';
import {
  buildAirlinePresentations,
  buildCruisePresentations,
  buildHotelPresentations,
  buildVehiclePresentations,
  matchDestinationMasterId,
} from './PreviewPresentations';

const destinations = [
  { id: 'd-vietnam', name: 'Vietnam - Ho Chi Minh', hasImage: true, images: [] },
  { id: 'd-goa', name: 'Goa', hasImage: true, images: [] },
  { id: 'd-india', name: 'India', hasImage: false, images: [] },
  { id: 'd-bali', name: 'Bali', hasImage: true, images: [] },
] as never;

describe('matchDestinationMasterId (mirrors the server three-tier rule)', () => {
  it('prefers the whole destination summary over fragments', () => {
    expect(matchDestinationMasterId(destinations, 'Vietnam - Ho Chi Minh', [])).toBe('d-vietnam');
  });

  it('checks the whole summary before countries and destinations', () => {
    // Server tier 1 order: summary, then countries, then destinations.
    expect(
      matchDestinationMasterId(destinations, 'Goa', [{ country: 'Bali', destination: 'Kuta' }]),
    ).toBe('d-goa');
    expect(
      matchDestinationMasterId(destinations, 'Maldives', [{ country: 'Bali', destination: 'Kuta' }]),
    ).toBe('d-bali');
  });

  it('matches per-part fragments in server order', () => {
    expect(matchDestinationMasterId(destinations, 'Goa escape', [])).toBe('d-goa');
  });

  it('falls back to the longest fuzzy hit', () => {
    // 'vietnam' is not an exact master name, but the Vietnam master contains it.
    expect(matchDestinationMasterId(destinations, 'Vietnam, beaches', [])).toBe('d-vietnam');
  });

  it('ignores masters without image evidence', () => {
    expect(matchDestinationMasterId(destinations, 'India', [])).toBeNull();
  });

  it('returns null when nothing matches or there is nothing to match', () => {
    expect(matchDestinationMasterId(destinations, 'Maldives', [])).toBeNull();
    expect(matchDestinationMasterId([], 'Goa', [])).toBeNull();
    expect(matchDestinationMasterId(destinations, null, null)).toBeNull();
  });
});

const hotelDetail = {
  id: 'hotel-m1',
  name: 'The Anvaya Beach Resort Bali',
  starCategory: 5,
  starRating: 4.6,
  address: 'Jalan Kartika Plaza, Kuta',
  reviewLink: 'https://maps.google.com/?cid=anvaya',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  destination: { id: 'd1', name: 'Bali', countryName: 'Indonesia' },
  city: { id: 'c1', name: 'Kuta' },
} as never;

describe('buildHotelPresentations (mirrors the server mapping)', () => {
  it('maps every presentation field keyed by quotation hotel row id', () => {
    const rows = [{ id: 'hotel-1', hotelId: 'hotel-m1', city: 'Kuta' }];
    const result = buildHotelPresentations(rows, { 'hotel-m1': hotelDetail }, { 'hotel-m1': 'https://cdn.example/anvaya.jpg' });
    expect(result).toEqual({
      'hotel-1': {
        imageUrl: 'https://cdn.example/anvaya.jpg',
        starCategory: 5,
        starRating: '4.6',
        address: 'Jalan Kartika Plaza, Kuta',
        reviewLink: 'https://maps.google.com/?cid=anvaya',
        checkInTime: '14:00',
        checkOutTime: '12:00',
        destination: 'Bali',
        country: 'Indonesia',
      },
    });
  });

  it('omits unlinked rows and rows whose master detail is unavailable', () => {
    const rows = [
      { id: 'hotel-1', hotelId: 'hotel-m1', city: 'Kuta' },
      { id: 'hotel-2', hotelId: null, city: 'Ubud' },
      { id: 'hotel-3', hotelId: 'hotel-missing', city: 'Ubud' },
    ];
    const result = buildHotelPresentations(rows, { 'hotel-m1': hotelDetail }, {});
    expect(Object.keys(result)).toEqual(['hotel-1']);
    expect(result['hotel-1']!.imageUrl).toBeNull();
  });
});

describe('buildCruisePresentations / buildVehiclePresentations', () => {
  it('maps cruise image, master name, and room-type name with row fallbacks', () => {
    const masters = {
      'cruise-m1': {
        id: 'cruise-m1',
        name: 'Sunset Dinner Cruise',
        roomTypes: [{ id: 'rt-1', name: 'Open Deck' }],
      },
    } as never;
    const rows = [
      { id: 'cruise-1', cruiseId: 'cruise-m1', cruiseRoomTypeId: 'rt-1', name: 'Row name', city: 'Nusa Dua' },
      { id: 'cruise-2', cruiseId: null, name: 'Row name', city: null },
    ];
    const result = buildCruisePresentations(rows, masters, { 'cruise-m1': 'https://cdn.example/cruise.jpg' });
    expect(result).toEqual({
      'cruise-1': { imageUrl: 'https://cdn.example/cruise.jpg', name: 'Sunset Dinner Cruise', roomTypeName: 'Open Deck' },
    });
  });

  it('maps vehicle image and master details with row fallbacks', () => {
    const masters = {
      'veh-m1': { id: 'veh-m1', name: 'Toyota Innova Crysta', vehicleType: 'SUV', capacity: 6 },
    } as never;
    const rows = [{ id: 'veh-1', vehicleId: 'veh-m1', name: 'Row name', city: 'SUV' }];
    const result = buildVehiclePresentations(rows, masters, { 'veh-m1': 'https://cdn.example/innova.jpg' });
    expect(result).toEqual({
      'veh-1': {
        imageUrl: 'https://cdn.example/innova.jpg',
        name: 'Toyota Innova Crysta',
        vehicleType: 'SUV',
        capacity: 6,
      },
    });
  });
});

describe('buildAirlinePresentations', () => {
  it('includes only referenced airlines with name and logo URL', () => {
    const masters = {
      'air-india': { id: 'air-india', name: 'Air India' },
      'unused': { id: 'unused', name: 'Unused Air' },
    } as never;
    const result = buildAirlinePresentations(
      ['air-india', 'ghost-airline'],
      masters,
      { 'air-india': 'https://cdn.example/ai.png' },
    );
    expect(result).toEqual({
      'air-india': { name: 'Air India', logoUrl: 'https://cdn.example/ai.png' },
    });
  });
});
