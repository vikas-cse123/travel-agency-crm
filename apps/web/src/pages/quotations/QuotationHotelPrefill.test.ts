import { describe, expect, it } from 'vitest';
import {
  expandDefaultHotelRows,
  matchDefaultHotels,
  shouldAutoPrefillHotels,
  type HotelInputRow,
} from './QuotationBuilderPage';

type Master = Parameters<typeof matchDefaultHotels>[1][number];

function master(
  id: string,
  name: string,
  city: string,
  destination: string,
  isDefaultForCity = true,
  status = 'ACTIVE',
): Master {
  return {
    id,
    name,
    status,
    isDefaultForCity,
    starCategory: 5,
    city: { name: city },
    destination: { name: destination },
    images: [],
  };
}

function leadRow(city: string, overrides: Record<string, unknown> = {}): HotelInputRow {
  return {
    city,
    hotelId: null,
    hotelName: '',
    checkInDate: new Date('2026-10-01'),
    checkOutDate: new Date('2026-10-04'),
    nights: 3,
    rooms: 2,
    ...overrides,
  } as unknown as HotelInputRow;
}

const singaporeDefaults = [
  master('h-a', 'Hotel A', 'Singapore', 'Singapore'),
  master('h-b', 'Hotel B', 'Singapore', 'Singapore'),
  master('h-c', 'Hotel C', 'Singapore', 'Singapore'),
  master('h-d', 'Hotel D', 'Singapore', 'Singapore'),
];

describe('matchDefaultHotels', () => {
  it('returns [] when the destination has no defaults', () => {
    expect(matchDefaultHotels('Singapore', [master('h-x', 'Hotel X', 'Singapore', 'Singapore', false)])).toEqual([]);
    expect(matchDefaultHotels('', singaporeDefaults)).toEqual([]);
  });

  it('returns every default of the destination sorted by name', () => {
    const matched = matchDefaultHotels('Singapore', [...singaporeDefaults].reverse());
    expect(matched.map((h) => h.name)).toEqual(['Hotel A', 'Hotel B', 'Hotel C', 'Hotel D']);
  });

  it('never mixes in defaults from other destinations (exact match only)', () => {
    const masters: Master[] = [
      ...singaporeDefaults,
      master('h-dxb', 'Dubai Grand', 'Dubai', 'Dubai'),
      master('h-gapore', 'Singapore View Resort', 'Sentosa', 'Sentosa'),
    ];
    const matched = matchDefaultHotels('Singapore', masters);
    expect(matched.map((h) => h.id).sort()).toEqual(['h-a', 'h-b', 'h-c', 'h-d']);
  });

  it('prefers city-tier matches but still includes destination-tier matches once', () => {
    const masters: Master[] = [
      master('h-city', 'City Hotel', 'Udaipur', 'Rajasthan'),
      master('h-dest', 'Desert Camp', 'Jaisalmer', 'Rajasthan'),
    ];
    // Row city equals a hotel city: city-tier match comes first.
    expect(matchDefaultHotels('Udaipur', masters).map((h) => h.id)).toEqual(['h-city']);
    // Row city equals the destination name: destination-tier matches.
    expect(matchDefaultHotels('Rajasthan', masters).map((h) => h.id)).toEqual(['h-city', 'h-dest']);
  });

  it('excludes inactive and non-default hotels', () => {
    const masters: Master[] = [
      master('h-off', 'Closed Hotel', 'Singapore', 'Singapore', true, 'INACTIVE'),
      master('h-plain', 'Plain Hotel', 'Singapore', 'Singapore', false),
    ];
    expect(matchDefaultHotels('Singapore', masters)).toEqual([]);
  });
});

describe('shouldAutoPrefillHotels', () => {
  it('prefills only brand-new quotations, never saved ones', () => {
    expect(shouldAutoPrefillHotels(0)).toBe(true);
    expect(shouldAutoPrefillHotels(1)).toBe(false);
    expect(shouldAutoPrefillHotels(5)).toBe(false);
  });
});

describe('expandDefaultHotelRows', () => {
  it('8. prefills ALL defaults of the selected destination in a new quotation', () => {
    const rows = expandDefaultHotelRows([leadRow('Singapore')], singaporeDefaults);
    expect(rows.map((r) => r.hotelName)).toEqual(['Hotel A', 'Hotel B', 'Hotel C', 'Hotel D']);
    expect(rows.map((r) => r.hotelId)).toEqual(['h-a', 'h-b', 'h-c', 'h-d']);
    // Stay context inherited from the lead row.
    for (const row of rows) {
      expect(row.nights).toBe(3);
      expect(row.rooms).toBe(2);
      expect(row.city).toBe('Singapore');
    }
    // No copies of the same hotel.
    expect(new Set(rows.map((r) => r.hotelId)).size).toBe(4);
  });

  it('keeps the legacy single-row behavior when a destination has no defaults', () => {
    const rows = expandDefaultHotelRows(
      [leadRow('Nowhere')],
      [master('h-x', 'Hotel X', 'Singapore', 'Singapore', false)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hotelId).toBeNull();
    expect(rows[0]?.city).toBe('Nowhere');
  });

  it('9. multiple destinations prefill their own hotels without mixing', () => {
    const masters: Master[] = [
      ...singaporeDefaults.slice(0, 3),
      master('h-e', 'Hotel D', 'Dubai', 'Dubai'),
      master('h-f', 'Hotel E', 'Dubai', 'Dubai'),
      master('h-g', 'Hotel F', 'Kashmir', 'Kashmir'),
      master('h-h', 'Hotel G', 'Kashmir', 'Kashmir'),
      master('h-i', 'Hotel H', 'Kashmir', 'Kashmir'),
    ];
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore'), leadRow('Dubai'), leadRow('Kashmir')],
      masters,
    );
    const byHotel = new Map(rows.map((r) => [r.hotelName, r.city]));
    expect(rows).toHaveLength(3 + 2 + 3);
    expect(byHotel.get('Hotel A')).toBe('Singapore');
    expect(byHotel.get('Hotel D')).toBe('Dubai');
    expect(byHotel.get('Hotel F')).toBe('Kashmir');
    // Every prefilled row belongs to a default of its own destination.
    for (const row of rows) {
      const hotel = masters.find((m) => m.id === row.hotelId)!;
      expect(hotel).toBeDefined();
      expect([hotel.city.name, hotel.destination.name]).toContain(row.city);
    }
  });

  it('10. a default hotel already present is not inserted again', () => {
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore', { hotelId: 'h-b', hotelName: 'Hotel B' })],
      singaporeDefaults,
    );
    // h-b already present: the other three are added, h-b is not duplicated.
    expect(rows.map((r) => r.hotelId).sort()).toEqual(['h-a', 'h-c', 'h-d']);
  });

  it('keeps the stay when its destination is already fully covered', () => {
    const rows = expandDefaultHotelRows(
      [
        leadRow('Singapore', { hotelId: 'h-a', hotelName: 'Hotel A' }),
        leadRow('Singapore', { hotelId: 'h-b', hotelName: 'Hotel B' }),
        leadRow('Singapore', { hotelId: 'h-c', hotelName: 'Hotel C' }),
        leadRow('Singapore', { hotelId: 'h-d', hotelName: 'Hotel D' }),
        leadRow('Singapore'),
      ],
      singaporeDefaults,
    );
    // Four existing stays untouched; the extra stay maps once (legacy fallback).
    expect(rows).toHaveLength(5);
    expect(rows[4]?.hotelId).toBe('h-a');
  });

  it('11. prefill output is decoupled from masters (removing a row cannot unmark a master)', () => {
    const rows = expandDefaultHotelRows([leadRow('Singapore')], singaporeDefaults);
    rows.splice(0, 1);
    expect(singaporeDefaults).toHaveLength(4);
    expect(singaporeDefaults.every((m) => m.isDefaultForCity)).toBe(true);
  });

  it('returns [] for no rows and drops city-less rows like before', () => {
    expect(expandDefaultHotelRows([], singaporeDefaults)).toEqual([]);
    expect(expandDefaultHotelRows([leadRow('')], singaporeDefaults)).toEqual([]);
  });

  it('expands exactly 10 defaults for a full destination', () => {
    const masters: Master[] = Array.from({ length: 10 }, (_, i) =>
      master(`h-${i + 1}`, `Hotel ${i + 1}`, 'Singapore', 'Singapore'),
    );
    const rows = expandDefaultHotelRows([leadRow('Singapore')], masters);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.hotelId)).size).toBe(10);
  });
});
