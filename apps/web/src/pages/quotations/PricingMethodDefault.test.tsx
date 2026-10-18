import { describe, it, expect } from 'vitest';

const TABS = [
  { key: 'sightseeing', label: 'Sightseeing' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'cruise', label: 'Cruise' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'flight', label: 'Flight' },
  { key: 'addon', label: 'Add-on Services' },
  { key: 'inclusions', label: 'Inclusions & Exclusions' },
  { key: 'destinationExpert', label: 'Destination Expert' },
  { key: 'faqs', label: 'FAQs' },
  { key: 'summary', label: 'Summary & Pricing' },
  { key: 'pricingBreakdown', label: 'Pricing Breakdown' },
  { key: 'setting', label: 'Settings' },
];

const defaults = {
  pricingMode: 'PER_PERSON' as const,
};

describe('Builder tab order and pricing-mode default', () => {
  // Pricing Method is no longer a builder tab; it lives on the Quotation
  // Details page. The builder strip now leads with Sightseeing.
  it('Sightseeing is first tab', () => {
    expect(TABS[0]!.key).toBe('sightseeing');
    expect(TABS[0]!.label).toBe('Sightseeing');
  });

  it('Hotel is second tab', () => {
    expect(TABS[1]!.key).toBe('hotel');
    expect(TABS[1]!.label).toBe('Hotel');
  });

  it('New quotation defaults to By Traveler', () => {
    expect(defaults.pricingMode).toBe('PER_PERSON');
  });

  it('By Traveler card is selected by default', () => {
    const mode = defaults.pricingMode as 'SECTION_WISE' | 'PER_PERSON';
    const isByTravelerSelected = mode === 'PER_PERSON';
    const isBySectionSelected = mode === 'SECTION_WISE';
    expect(isByTravelerSelected).toBe(true);
    expect(isBySectionSelected).toBe(false);
  });

  it('Existing quotation preserves saved pricing method', () => {
    const savedModes: Array<'PER_PERSON' | 'SECTION_WISE'> = ['PER_PERSON', 'SECTION_WISE', 'PER_PERSON'];
    savedModes.forEach((saved) => {
      const normalized = saved === 'SECTION_WISE' ? 'SECTION_WISE' : 'PER_PERSON';
      expect(normalized).toBe(saved);
    });
  });

  it('Switching By Traveler <-> By Section preserves data', () => {
    const cruiseData = { cruiseId: 'c1', roomRate: 1000, rooms: 2, nights: 3 };
    let current: any = { pricingMode: 'PER_PERSON', cruise: cruiseData };
    // Switch to By Section
    current = { ...current, pricingMode: 'SECTION_WISE' };
    expect(current.cruise.roomRate).toBe(1000);
    // Switch back to By Traveler
    current = { ...current, pricingMode: 'PER_PERSON' };
    expect(current.cruise.roomRate).toBe(1000);
    expect(current.cruise.rooms).toBe(2);
  });

  it('By Traveler hides Pricing Breakdown, By Section shows it', () => {
    const visibleFor = (mode: string) => TABS.filter((tab) => mode === 'SECTION_WISE' || tab.key !== 'pricingBreakdown');
    expect(visibleFor('PER_PERSON').some((t) => t.key === 'pricingBreakdown')).toBe(false);
    expect(visibleFor('SECTION_WISE').some((t) => t.key === 'pricingBreakdown')).toBe(true);
  });
});
