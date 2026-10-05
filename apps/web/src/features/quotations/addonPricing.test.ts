import { describe, expect, it } from 'vitest';
import {
  formatAddonOptionPrice,
  formatAddonPricingOption,
  normalizeAddonPricingSnapshot,
} from './addonPricing';

describe('addonPricing snapshot helpers', () => {
  it('keeps saved entries in order with their stable ids', () => {
    const entries = normalizeAddonPricingSnapshot({
      id: 'master-1',
      pricing: [
        { id: 'o-1', label: 'Adult', price: 6000, currency: 'INR' },
        { id: 'o-2', label: 'Child', price: 4000, currency: 'INR' },
      ],
      price: 999,
      pricingBasis: 'Ignored',
    });
    expect(entries).toEqual([
      { id: 'o-1', label: 'Adult', price: 6000, currency: 'INR' },
      { id: 'o-2', label: 'Child', price: 4000, currency: 'INR' },
    ]);
  });

  it('turns a legacy single price/basis into exactly one entry', () => {
    expect(
      normalizeAddonPricingSnapshot({
        id: 'master-1',
        price: 3800,
        currency: 'INR',
        pricingBasis: 'Per Person',
      }),
    ).toEqual([{ id: 'legacy-master-1', label: 'Per Person', price: 3800, currency: 'INR' }]);
  });

  it('returns no entries when neither repeatable nor legacy pricing exists', () => {
    expect(normalizeAddonPricingSnapshot({ id: 'master-1' })).toEqual([]);
    expect(normalizeAddonPricingSnapshot({ id: 'master-1', pricing: [] })).toEqual([]);
  });

  it('repairs malformed rows instead of dropping the whole list', () => {
    const entries = normalizeAddonPricingSnapshot({
      id: 'master-1',
      pricing: [
        { label: 'No id row', price: 100, currency: 'INR' },
        null,
        { id: 'o-3', label: '  Spaced  ', price: '2500', currency: 'usd' },
      ] as never,
    });
    // Non-object rows are skipped; every real row survives, with a stable id
    // assigned where one was missing.
    expect(entries).toHaveLength(2);
    expect(typeof entries[0]!.id).toBe('string');
    expect(entries[0]).toMatchObject({ label: 'No id row', price: 100 });
    expect(entries[1]).toMatchObject({ id: 'o-3', label: '  Spaced  ', currency: 'usd' });
  });

  it('formats one option compactly with per-entry currency', () => {
    expect(formatAddonPricingOption({ label: 'Adult', price: 6000, currency: 'INR' })).toBe(
      'Adult ₹6,000',
    );
    expect(formatAddonPricingOption({ label: 'Group', price: 20000, currency: 'USD' })).toBe(
      'Group $20,000',
    );
    expect(formatAddonPricingOption({ label: '', price: null, currency: 'INR' })).toBe('Standard');
    expect(formatAddonOptionPrice({ label: 'Adult', price: 6000, currency: 'INR' })).toBe(
      '₹6,000',
    );
    expect(formatAddonOptionPrice({ label: 'Adult', price: null, currency: 'INR' })).toBeNull();
  });
});
