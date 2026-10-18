import { describe, expect, it } from 'vitest';
import {
  selectSightseeingCityForDestination,
  selectSightseeingPrefillMasters,
} from './QuotationBuilderPage';
import type { Sightseeing } from '@/features/masters/masters.api';

type Master = Sightseeing;

function master(
  id: string,
  title: string,
  destination: string,
  city: string,
  sequence = 1,
  overrides: Partial<Master> = {},
): Master {
  return {
    id,
    title,
    sequence,
    estimatedHours: null,
    suggestedStartTime: null,
    description: null,
    remarks: null,
    status: 'ACTIVE',
    hasImage: false,
    images: [],
    imageFileName: null,
    imageMimeType: null,
    imageConfirmedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    destination: { id: `dest-${destination}`, name: destination, countryName: destination },
    city: { id: `city-${city}`, name: city },
    createdBy: { id: 'user-1', fullName: 'Owner' },
    isGlobal: false,
    isOwnedByCurrentTenant: true,
    canEdit: true,
    canHide: false,
    canRestore: false,
    source: 'TENANT',
    ...overrides,
  } as Master;
}

const ids = (rows: Master[]) => rows.map((row) => row.id);

describe('selectSightseeingPrefillMasters', () => {
  it('CASE A — destination-level match keeps working (Singapore)', () => {
    const rows = [
      master('sg-night-safari', 'Night safari', 'Singapore', 'Singapore', 1, {
        suggestedStartTime: '18:00',
      }),
      master('sg-city-tour', 'Singapore City Tour', 'Singapore', 'Singapore', 2),
      master('sg-archived', 'Old Sentosa Show', 'Singapore', 'Singapore', 3, {
        status: 'ARCHIVED',
      }),
    ];
    const result = selectSightseeingPrefillMasters(rows, 'singapore', ['singapore']);
    // Both ACTIVE Singapore masters in sequence order; archived row excluded.
    expect(ids(result)).toEqual(['sg-night-safari', 'sg-city-tour']);
  });

  it('CASE B — city fallback rescues Hanoi masters under destination Vietnam', () => {
    const rows = [
      master('hn-1', 'Day 1 - Arrival in Hanoi | Hanoi City Tour', 'Vietnam', 'Hanoi', 1),
      master('hn-2', 'Day 2 - Halong Bay Day Cruise', 'Vietnam', 'Hanoi', 2),
      master('hn-5', 'Day 5 - Ba Na Hills & Golden Bridge', 'Vietnam', 'Hanoi', 5),
      master('dn-1', 'Day 3 - Da Nang Leisure Day', 'Vietnam', 'Da Nang', 3),
    ];
    // Destination token "hanoi" matches no destination name ("vietnam"), so the
    // destination filter yields zero rows and the Hanoi city fallback engages.
    const result = selectSightseeingPrefillMasters(rows, 'hanoi', ['Hanoi']);
    expect(ids(result)).toEqual(['hn-1', 'hn-2', 'hn-5']);
  });

  it('CASE C — no city match keeps the empty result (never attaches unrelated sightseeing)', () => {
    const rows = [
      master('hn-1', 'Day 1 - Arrival in Hanoi | Hanoi City Tour', 'Vietnam', 'Hanoi', 1),
      master('sg-1', 'Night safari', 'Singapore', 'Singapore', 1),
    ];
    expect(selectSightseeingPrefillMasters(rows, 'atlantis', ['atlantis'])).toEqual([]);
    // No itinerary cities at all also stays empty.
    expect(selectSightseeingPrefillMasters(rows, 'atlantis', [])).toEqual([]);
  });

  it('CASE D — destination match takes precedence; city fallback is not applied', () => {
    const rows = [
      master('hn-1', 'Day 1 - Arrival in Hanoi | Hanoi City Tour', 'Vietnam', 'Hanoi', 1),
      master('dn-1', 'Day 3 - Da Nang Leisure Day', 'Vietnam', 'Da Nang', 3),
    ];
    // Token "vietnam" matches the destination, so the full destination list is
    // returned — including the Da Nang row, which a city-only fallback scoped
    // to ["hanoi"] would have excluded.
    const result = selectSightseeingPrefillMasters(rows, 'vietnam', ['hanoi']);
    expect(ids(result)).toEqual(['hn-1', 'dn-1']);
  });

  it('CASE E — multiple cities stay separated (no cross-assignment source)', () => {
    const rows = [
      master('hn-1', 'Hanoi City Tour', 'Vietnam', 'Hanoi', 1),
      master('hn-2', 'Halong Bay Day Cruise', 'Vietnam', 'Hanoi', 2),
      master('dn-1', 'Da Nang Leisure Day', 'Vietnam', 'Da Nang', 3),
      master('sg-1', 'Night safari', 'Singapore', 'Singapore', 1),
      master('hn-old', 'Old Hanoi Show', 'Vietnam', 'Hanoi', 4, { status: 'INACTIVE' }),
    ];
    // Whitespace/case variants still match exactly after normalization.
    const result = selectSightseeingPrefillMasters(rows, 'nowhere', ['  HANOI ', 'da nang']);
    expect(ids(result)).toEqual(['hn-1', 'hn-2', 'dn-1']);
  });

  it('preserves ordering (sequence, then createdAt, then id) and the empty-token behavior', () => {
    const rows = [
      master('b', 'Second', 'Singapore', 'Singapore', 2),
      master('a', 'First', 'Singapore', 'Singapore', 1, {
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      master('c', 'Also first', 'Singapore', 'Singapore', 1, {
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(ids(selectSightseeingPrefillMasters(rows, 'singapore', ['singapore']))).toEqual([
      'c',
      'a',
      'b',
    ]);
    // No destination token (new/blank summary) keeps the previous behavior:
    // every ACTIVE master is a candidate.
    expect(ids(selectSightseeingPrefillMasters(rows, undefined, []))).toEqual(['c', 'a', 'b']);
  });

  it('restricts the candidate set to the supplied cities (no cross-city leak)', () => {
    const rows = [
      master('sg-1', 'Singapore City Tour', 'Singapore HD', 'Singapore', 1),
      master('sn-1', 'Sentosa Beach', 'Singapore HD', 'Sentosa', 2),
      master('sn-2', 'Universal Studios', 'Singapore HD', 'Sentosa', 3),
    ];
    // Destination token matches, but the hard scope keeps only Sentosa masters.
    const result = selectSightseeingPrefillMasters(rows, 'singapore hd', ['Sentosa'], ['Sentosa']);
    expect(ids(result)).toEqual(['sn-1', 'sn-2']);
  });
});

describe('selectSightseeingCityForDestination', () => {
  it('selects the only linked city', () => {
    expect(
      selectSightseeingCityForDestination([{ id: 'city-sg', name: 'Singapore', sequence: 1 }], []),
    ).toEqual({ cityId: 'city-sg', cityName: 'Singapore' });
  });

  it('selects the city with the most ACTIVE attractions', () => {
    const rows = [
      master('sg-1', 'Singapore City Tour', 'Singapore HD', 'Singapore'),
      master('sn-1', 'Sentosa Beach', 'Singapore HD', 'Sentosa'),
      master('sn-2', 'Universal Studios', 'Singapore HD', 'Sentosa'),
      master('sn-3', 'Cable Car', 'Singapore HD', 'Sentosa'),
    ];
    expect(
      selectSightseeingCityForDestination(
        [
          { id: 'city-sg', name: 'Singapore', sequence: 1 },
          { id: 'city-sn', name: 'Sentosa', sequence: 2 },
        ],
        rows,
      ),
    ).toEqual({ cityId: 'city-sn', cityName: 'Sentosa' });
  });

  it('breaks ties by city link sequence, then alphabetical name', () => {
    const rows = [
      master('sg-1', 'Singapore City Tour', 'Singapore HD', 'Singapore'),
      master('sn-1', 'Sentosa Beach', 'Singapore HD', 'Sentosa'),
    ];
    // Equal counts → the lower master sequence wins.
    expect(
      selectSightseeingCityForDestination(
        [
          { id: 'city-b', name: 'Bravo', sequence: 2 },
          { id: 'city-a', name: 'Alpha', sequence: 1 },
        ],
        rows,
      ),
    ).toEqual({ cityId: 'city-a', cityName: 'Alpha' });
    // Same sequence → alphabetical.
    expect(
      selectSightseeingCityForDestination(
        [
          { id: 'city-b', name: 'Bravo', sequence: 1 },
          { id: 'city-a', name: 'Alpha', sequence: 1 },
        ],
        rows,
      ),
    ).toEqual({ cityId: 'city-a', cityName: 'Alpha' });
  });

  it('never counts archived masters', () => {
    const rows = [
      master('sg-1', 'Old Show', 'Singapore HD', 'Singapore', 1, { status: 'ARCHIVED' }),
      master('sn-1', 'Beach', 'Singapore HD', 'Sentosa'),
    ];
    expect(
      selectSightseeingCityForDestination(
        [
          { id: 'city-sg', name: 'Singapore', sequence: 1 },
          { id: 'city-sn', name: 'Sentosa', sequence: 2 },
        ],
        rows,
      ),
    ).toEqual({ cityId: 'city-sn', cityName: 'Sentosa' });
  });

  it('returns nulls when the destination links no cities', () => {
    expect(selectSightseeingCityForDestination([], [master('x', 'X', 'D', 'C')])).toEqual({
      cityId: null,
      cityName: null,
    });
  });
});
