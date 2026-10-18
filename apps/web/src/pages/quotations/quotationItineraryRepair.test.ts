import { describe, expect, it } from 'vitest';
import { deriveDestinationSummary, repairLegacyItinerary } from './quotationItineraryRepair';

const blankRow = (overrides: Record<string, unknown> = {}) => ({
  title: '',
  destination: '',
  overnightLocation: null,
  description: '',
  ...overrides,
});

describe('repairLegacyItinerary', () => {
  it('fills blank required fields from the lead destination when the city is blank', () => {
    const rows = repairLegacyItinerary([blankRow()], [
      { country: 'Singapore Heaven Delight', destination: '' },
    ]);
    expect(rows[0]).toMatchObject({
      title: 'Singapore Heaven Delight',
      destination: 'Singapore Heaven Delight',
      overnightLocation: 'Singapore Heaven Delight',
    });
  });

  it('prefers the lead city when present and falls back to the destination otherwise', () => {
    const [fromCity, fromCountry] = repairLegacyItinerary(
      [blankRow(), blankRow()],
      [
        { country: 'Azerbaijan', destination: 'Baku' },
        { country: 'Azerbaijan', destination: '' },
      ],
    );
    expect(fromCity).toMatchObject({ title: 'Baku', destination: 'Baku' });
    expect(fromCountry).toMatchObject({ title: 'Azerbaijan', destination: 'Azerbaijan' });
  });

  it('preserves rows that already hold values', () => {
    const [row] = repairLegacyItinerary(
      [blankRow({ title: 'Custom Day', destination: 'Baku', overnightLocation: 'Baku' })],
      [{ country: 'Singapore Heaven Delight', destination: '' }],
    );
    expect(row).toMatchObject({
      title: 'Custom Day',
      destination: 'Baku',
      overnightLocation: 'Baku',
    });
  });

  it('leaves rows untouched when the lead has no destination either', () => {
    const [row] = repairLegacyItinerary([blankRow()], [{ country: '', destination: '' }]);
    expect(row).toMatchObject({ title: '', destination: '' });
  });

  it('returns an empty array for an empty itinerary', () => {
    expect(repairLegacyItinerary([], [{ country: 'Azerbaijan' }])).toEqual([]);
  });
});

describe('deriveDestinationSummary', () => {
  it('prefers a non-empty saved quotation summary', () => {
    expect(
      deriveDestinationSummary('  Goa  ', [{ country: 'Azerbaijan', destination: '' }]),
    ).toBe('Goa');
  });

  it('derives from the lead Master Destination when the city is blank', () => {
    expect(deriveDestinationSummary('', [{ country: 'Azerbaijan', destination: '' }])).toBe(
      'Azerbaijan',
    );
  });

  it('joins every stay, preferring each city when present', () => {
    expect(
      deriveDestinationSummary(undefined, [
        { country: 'Azerbaijan', destination: 'Baku' },
        { country: 'Georgia', destination: '' },
      ]),
    ).toBe('Baku • Georgia');
  });

  it('never invents a placeholder when there is nothing to derive', () => {
    expect(deriveDestinationSummary('', [{ country: '', destination: '' }])).toBe('');
    expect(deriveDestinationSummary(null)).toBe('');
  });
});

