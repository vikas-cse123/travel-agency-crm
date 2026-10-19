import { describe, expect, it } from 'vitest';
import { selectSightseeingPrefillMasters } from './QuotationBuilderPage';
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
  it('scopes to the lead destination by stable id and includes every city', () => {
    const rows = [
      master('hn-1', 'Hanoi City Tour', 'Vietnam Trio', 'Hanoi', 1),
      master('dn-1', 'Ba Na Hills', 'Vietnam Trio', 'Da Nang', 3),
      master('pq-1', 'Phu Quoc Beach', 'Vietnam Trio', 'Phu Quoc', 2),
      master('hn-x', 'Archived Hanoi Show', 'Vietnam Trio', 'Hanoi', 9, { status: 'ARCHIVED' }),
      master('my-1', 'KL Towers', 'Malaysia Delight', 'Kuala Lumpur', 1),
    ];
    const result = selectSightseeingPrefillMasters(rows, 'vietnam trio', ['dest-Vietnam Trio']);
    // Multi-city attractions are all eligible and ordered by sequence; the other
    // destination and the archived row are excluded. City never filters.
    expect(ids(result)).toEqual(['hn-1', 'pq-1', 'dn-1']);
  });

  it('orders strictly by sequence, then createdAt, then id', () => {
    const rows = [
      master('b', 'Second', 'Vietnam Trio', 'Da Nang', 2),
      master('a', 'First', 'Vietnam Trio', 'Hanoi', 1, {
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      master('c', 'Also first', 'Vietnam Trio', 'Phu Quoc', 1, {
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(
      ids(selectSightseeingPrefillMasters(rows, 'vietnam trio', ['dest-Vietnam Trio'])),
    ).toEqual(['c', 'a', 'b']);
  });

  it('stable id scope wins over a name token that would otherwise match', () => {
    const rows = [
      master('vn-1', 'Hanoi City Tour', 'Vietnam Trio', 'Hanoi', 1),
      master('vn-extra', 'Hue Imperial City', 'Vietnam Extra', 'Hue', 1),
    ];
    // The token "vietnam" matches both destination names, but the stable id
    // keeps only the lead's destination.
    expect(
      ids(selectSightseeingPrefillMasters(rows, 'vietnam', ['dest-Vietnam Trio'])),
    ).toEqual(['vn-1']);
  });

  it('falls back to the destination name token before the ids resolve', () => {
    const rows = [
      master('sg-1', 'City Tour', 'Singapore', 'Singapore', 1),
      master('sg-2', 'Night Safari', 'Singapore', 'Singapore', 2),
      master('my-1', 'KL Towers', 'Malaysia Delight', 'Kuala Lumpur', 1),
    ];
    expect(ids(selectSightseeingPrefillMasters(rows, 'singapore'))).toEqual(['sg-1', 'sg-2']);
  });

  it('keeps every ACTIVE master when neither token nor ids are known', () => {
    const rows = [
      master('b', 'Second', 'Singapore', 'Singapore', 2),
      master('c', 'First', 'Singapore', 'Singapore', 1),
      master('a', 'Old Show', 'Singapore', 'Singapore', 1, { status: 'INACTIVE' }),
    ];
    expect(ids(selectSightseeingPrefillMasters(rows, undefined, []))).toEqual(['c', 'b']);
  });

  it('returns an empty list when the destination matches nothing', () => {
    const rows = [master('sg-1', 'City Tour', 'Singapore', 'Singapore', 1)];
    expect(selectSightseeingPrefillMasters(rows, 'atlantis')).toEqual([]);
    expect(selectSightseeingPrefillMasters(rows, 'atlantis', ['dest-atlantis'])).toEqual([]);
  });
});
