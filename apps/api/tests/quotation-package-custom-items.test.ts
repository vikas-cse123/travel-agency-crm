import { describe, it, expect } from 'vitest';
import {
  resolveQuotationPricing,
  validateQuotationPricing,
  type PaxCounts,
} from '@interscale/shared';
import { calculatePricing } from '../src/modules/quotations/pricing.service.js';

const PAX: PaxCounts = {
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
};

// ---------------------------------------------------------------------------
// Shared resolver — Additional Price Items (By Traveler only)
// ---------------------------------------------------------------------------

describe('resolveQuotationPricing — Additional Price Items', () => {
  it('adds flat items on top of the traveler subtotal (never per traveler)', () => {
    const pricing = resolveQuotationPricing({
      version: {
        pricingMode: 'PER_PERSON',
        perAdultPrice: 100,
        packageCustomItems: [
          { label: 'Flight tickets', amount: 5000 },
          { label: 'Visa fees', amount: 3000 },
        ],
      },
      quotation: { adults: 2, currency: 'INR' },
    });
    expect(pricing.travelerPricing.subtotal).toBe(200);
    expect(pricing.customItems.subtotal).toBe(8000);
    // 200 + 8,000 — items are flat, not ×2.
    expect(pricing.packageTotal).toBe(8200);
    expect(pricing.subtotal).toBe(8200);
    expect(pricing.grandTotal).toBe(8200);
    expect(pricing.customItems.rows).toEqual([
      { id: 'custom-0', label: 'Flight tickets', amount: 5000 },
      { id: 'custom-1', label: 'Visa fees', amount: 3000 },
    ]);
  });

  it('supports an items-only quotation with no traveler rates', () => {
    const pricing = resolveQuotationPricing({
      version: {
        pricingMode: 'PER_PERSON',
        perAdultPrice: 0,
        packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
      },
      quotation: { adults: 2, currency: 'INR' },
    });
    expect(pricing.travelerPricing.rows).toHaveLength(0);
    expect(pricing.packageTotal).toBe(5000);
    expect(pricing.grandTotal).toBe(5000);
  });

  it('applies the discount → tax pipeline exactly once on the combined subtotal', () => {
    const pricing = resolveQuotationPricing({
      version: {
        pricingMode: 'PER_PERSON',
        perAdultPrice: 100,
        packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
        discountAmount: 100,
        taxRate: 5,
      },
      quotation: { adults: 2, currency: 'INR' },
    });
    // 200 + 5,000 = 5,200 → −100 = 5,100 → +5% = 255 → 5,355.
    expect(pricing.subtotal).toBe(5200);
    expect(pricing.taxAmount).toBe(255);
    expect(pricing.grandTotal).toBe(5355);
  });

  it('drops blank-label, zero and negative items so the total can never be corrupted', () => {
    const pricing = resolveQuotationPricing({
      version: {
        pricingMode: 'PER_PERSON',
        perAdultPrice: 100,
        packageCustomItems: [
          { label: '', amount: 100 },
          { label: '   ', amount: 100 },
          { label: 'Zero', amount: 0 },
          { label: 'Negative', amount: -5 },
          { label: 'Extra fee', amount: 250 },
        ],
      },
      quotation: { adults: 1, currency: 'INR' },
    });
    expect(pricing.customItems.rows).toEqual([{ id: 'custom-0', label: 'Extra fee', amount: 250 }]);
    expect(pricing.packageTotal).toBe(350);
  });

  it('ignores items entirely for SECTION_WISE pricing', () => {
    const pricing = resolveQuotationPricing({
      version: {
        pricingMode: 'SECTION_WISE',
        hotelDetails: { include: true, amount: 20000 },
        packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
      },
      quotation: { adults: 2, currency: 'INR' },
    });
    expect(pricing.customItems.subtotal).toBe(0);
    expect(pricing.sectionTotal).toBe(20000);
    expect(pricing.grandTotal).toBe(20000);
  });
});

// ---------------------------------------------------------------------------
// Validator — PER_PERSON is complete with items only
// ---------------------------------------------------------------------------

describe('validateQuotationPricing — Additional Price Items', () => {
  it('treats an items-only By Traveler quotation as complete', () => {
    const issues = validateQuotationPricing({
      version: {
        pricingMode: 'PER_PERSON',
        perAdultPrice: 0,
        packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
      },
      quotation: { adults: 2, currency: 'INR' },
    });
    expect(issues).toHaveLength(0);
  });

  it('still reports incomplete when there are no prices and no items', () => {
    const issues = validateQuotationPricing({
      version: { pricingMode: 'PER_PERSON', perAdultPrice: 0 },
      quotation: { adults: 2, currency: 'INR' },
    });
    expect(issues[0]?.message).toMatch(/Traveler pricing is incomplete/);
  });
});

// ---------------------------------------------------------------------------
// Backend engine — Additional Price Items
// ---------------------------------------------------------------------------

describe('calculatePricing — Additional Price Items', () => {
  it('includes flat items in the traveler package subtotal and final amount', () => {
    const result = calculatePricing({
      pricingMode: 'PER_PERSON',
      perAdultPrice: 100,
      pax: PAX,
      packageCustomItems: [
        { label: 'Flight tickets', amount: 5000 },
        { label: 'Visa fees', amount: 3000 },
      ],
    });
    expect(Number(result.subtotalSellingPrice)).toBe(8200);
    expect(Number(result.finalAmount)).toBe(8200);
  });

  it('includes items when there are no per-traveler rates', () => {
    const result = calculatePricing({
      pricingMode: 'PER_PERSON',
      perAdultPrice: 0,
      pax: PAX,
      packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
    });
    expect(Number(result.subtotalSellingPrice)).toBe(5000);
    expect(Number(result.finalAmount)).toBe(5000);
  });

  it('ignores items for SECTION_WISE pricing', () => {
    const result = calculatePricing({
      pricingMode: 'SECTION_WISE',
      pax: PAX,
      visaAmount: 20000,
      packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
    });
    expect(Number(result.subtotalSellingPrice)).toBe(20000);
    expect(Number(result.finalAmount)).toBe(20000);
  });
});
