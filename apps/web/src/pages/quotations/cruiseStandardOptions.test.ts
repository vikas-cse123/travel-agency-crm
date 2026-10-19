import { describe, expect, it } from 'vitest';
import { STANDARD_CRUISE_CABINS, withStandardCabinOptions } from './cruiseStandardOptions';

describe('withStandardCabinOptions', () => {
  it('adds every standard cabin when the Cruise Master has none', () => {
    const result = withStandardCabinOptions([]);
    expect(result.map((option) => option.label)).toEqual([...STANDARD_CRUISE_CABINS]);
    expect(STANDARD_CRUISE_CABINS).toHaveLength(8);
  });

  it('keeps master cabins first and appends only the missing standard cabins', () => {
    const master = [
      { id: 'cabin-1', label: 'Balcony Cabin' },
      { id: 'cabin-2', label: 'Suite' },
    ];
    const result = withStandardCabinOptions(master);

    // Master entries survive with their real ids.
    expect(result[0]).toEqual({ id: 'cabin-1', label: 'Balcony Cabin' });
    expect(result[1]).toEqual({ id: 'cabin-2', label: 'Suite' });

    const labels = result.map((option) => option.label);
    // No duplicate for master-provided standard names.
    expect(labels.filter((label) => label === 'Balcony Cabin')).toHaveLength(1);
    expect(labels.filter((label) => label === 'Suite')).toHaveLength(1);
    // Every remaining standard option is present.
    for (const label of STANDARD_CRUISE_CABINS) {
      expect(labels).toContain(label);
    }
    // Synthetic options never collide with master ids.
    const synthetic = result.filter((option) => option.id.startsWith('standard-cruise-cabin:'));
    expect(synthetic).toHaveLength(STANDARD_CRUISE_CABINS.length - 2);
  });

  it('deduplicates against master names case-insensitively and trimmed', () => {
    const master = [{ id: 'cabin-1', label: '  ocean view CABIN ' }];
    const result = withStandardCabinOptions(master);
    expect(result.filter((option) => option.label.trim().toLowerCase() === 'ocean view cabin')).toHaveLength(1);
  });

  it('retains custom master cabins that are not standard suggestions', () => {
    const master = [{ id: 'cabin-1', label: 'Owner Suite with Verandah' }];
    const result = withStandardCabinOptions(master);
    expect(result[0]).toEqual({ id: 'cabin-1', label: 'Owner Suite with Verandah' });
  });

  it('preserves the full master set when it already covers every standard cabin', () => {
    const master = STANDARD_CRUISE_CABINS.map((label, index) => ({ id: `cabin-${index}`, label }));
    const result = withStandardCabinOptions(master);
    expect(result).toEqual(master);
  });
});
