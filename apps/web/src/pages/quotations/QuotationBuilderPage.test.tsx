import { describe, expect, it } from 'vitest';
import {
  buildAddonPrefillRows,
  hasPolicyHtml,
  leadRequestedTabs,
  mapMasterToAddonRow,
  masterGallerySnapshot,
  matchDefaultAddOnsForDestination,
  mergeMasterGalleryPreviews,
  policyValue,
  serviceTypeToTabKey,
  shouldAutoPrefillAddons,
  type PrefillAddOnMaster,
} from '@/pages/quotations/QuotationBuilderPage';

describe('QuotationBuilder — Master gallery snapshots', () => {
  it('creates ordered opaque refs synchronously without persisting preview URLs', () => {
    const snapshot = masterGallerySnapshot(
      [{ id: 'image-a' }, { id: 'image-b' }, { id: 'image-c' }] as Parameters<
        typeof masterGallerySnapshot
      >[0],
      'Harbour Hotel',
    );

    expect(snapshot).toEqual([
      { masterImageId: 'image-a', alt: 'Harbour Hotel image 1' },
      { masterImageId: 'image-b', alt: 'Harbour Hotel image 2' },
      { masterImageId: 'image-c', alt: 'Harbour Hotel image 3' },
    ]);
  });

  it('merges delayed preview URLs into the current order without restoring removals', () => {
    const imported = masterGallerySnapshot(
      [{ id: 'image-a' }, { id: 'image-b' }, { id: 'image-c' }] as Parameters<
        typeof masterGallerySnapshot
      >[0],
      'Harbour Hotel',
    );
    const current = [imported[2]!, imported[0]!];
    const previewed = imported.map((image) => ({
      ...image,
      url: `https://preview.test/${image.masterImageId}.jpg`,
    }));

    expect(mergeMasterGalleryPreviews(current, previewed)).toEqual([
      { ...imported[2], url: 'https://preview.test/image-c.jpg' },
      { ...imported[0], url: 'https://preview.test/image-a.jpg' },
    ]);
  });
});

describe('QuotationBuilder — lead service → quotation tab mapping', () => {
  it('maps every Lead service type to its quotation tab', () => {
    expect(serviceTypeToTabKey('FLIGHT')).toBe('flight');
    expect(serviceTypeToTabKey('HOTEL')).toBe('hotel');
    expect(serviceTypeToTabKey('SIGHTSEEING')).toBe('sightseeing');
    expect(serviceTypeToTabKey('CRUISE')).toBe('cruise');
    expect(serviceTypeToTabKey('VEHICLE_TRANSFER')).toBe('vehicle');
    // Every Add-on service type maps to the Add-on Services tab.
    for (const addon of [
      'TRAVEL_INSURANCE',
      'RAIL',
      'PASSPORT_ASSISTANCE',
      'MEAL',
      'GUIDE',
      'OTHER_ADD_ON',
      'GENERAL_ENQUIRY',
    ]) {
      expect(serviceTypeToTabKey(addon)).toBe('addon');
    }
  });

  it('returns null for non-service or unknown types', () => {
    expect(serviceTypeToTabKey('VISA')).toBeNull();
    expect(serviceTypeToTabKey('UNKNOWN')).toBeNull();
  });

  it('CASE 1 — all six services selected on the Lead → all six tabs requested', () => {
    const requested = leadRequestedTabs({
      services: [
        { serviceType: 'FLIGHT' },
        { serviceType: 'HOTEL' },
        { serviceType: 'SIGHTSEEING' },
        { serviceType: 'CRUISE' },
        { serviceType: 'VEHICLE_TRANSFER' },
        { serviceType: 'OTHER_ADD_ON' },
      ],
    });
    for (const tab of ['flight', 'hotel', 'sightseeing', 'cruise', 'vehicle', 'addon']) {
      expect(requested.has(tab)).toBe(true);
    }
  });

  it('CASE 2 — only Hotel + Flight selected → only those tabs requested', () => {
    const requested = leadRequestedTabs({
      services: [{ serviceType: 'HOTEL' }, { serviceType: 'FLIGHT' }],
    });
    expect(requested.has('flight')).toBe(true);
    expect(requested.has('hotel')).toBe(true);
    for (const tab of ['sightseeing', 'cruise', 'vehicle', 'addon']) {
      expect(requested.has(tab)).toBe(false);
    }
  });

  it('CASE 6 — Add-on selected on the Lead → addon tab requested (no missing asterisk)', () => {
    const requested = leadRequestedTabs({ services: [{ serviceType: 'MEAL' }] });
    expect(requested.has('addon')).toBe(true);
  });

  it('CASE 7 — Cruise selected on the Lead → cruise tab requested', () => {
    const requested = leadRequestedTabs({ services: [{ serviceType: 'CRUISE' }] });
    expect(requested.has('cruise')).toBe(true);
  });

  it('returns an empty set when the Lead has no services', () => {
    expect(leadRequestedTabs(undefined).size).toBe(0);
    expect(leadRequestedTabs({ services: [] }).size).toBe(0);
  });
});

describe('QuotationBuilder — default add-on prefill helpers', () => {
  const visa: PrefillAddOnMaster = {
    id: 'addon-visa',
    name: 'Visa Service',
    status: 'ACTIVE',
    description: '<p>Visa help</p>',
    price: 3000,
    pricingBasis: 'Per Person',
    images: [{ id: 'img-1', fileName: 'v.png', mimeType: 'image/png', fileSize: 10, isPrimary: true }],
    destinations: [
      { id: 'dest-sg', name: 'Singapore', isDefault: true },
      { id: 'dest-my', name: 'Malaysia', isDefault: false },
    ],
  };
  const sim: PrefillAddOnMaster = {
    id: 'addon-sim',
    name: 'Airport SIM',
    status: 'ACTIVE',
    description: null,
    price: null,
    images: [],
    destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
  };
  const archived: PrefillAddOnMaster = {
    id: 'addon-old',
    name: 'Old Tour',
    status: 'ARCHIVED',
    description: null,
    images: [],
    destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
  };

  it('matches only active defaults for the destination, sorted by name', () => {
    expect(matchDefaultAddOnsForDestination('dest-sg', [sim, visa, archived]).map((m) => m.id)).toEqual([
      'addon-sim',
      'addon-visa',
    ]);
    // Same service non-default elsewhere is excluded there.
    expect(matchDefaultAddOnsForDestination('dest-my', [visa])).toEqual([]);
    expect(matchDefaultAddOnsForDestination('', [visa])).toEqual([]);
  });

  it('gates auto-populate on zero saved linked rows', () => {
    expect(shouldAutoPrefillAddons(0)).toBe(true);
    expect(shouldAutoPrefillAddons(2)).toBe(false);
  });

  it('maps a master to a full snapshot row (images, basis, PDF choice)', () => {
    const row = mapMasterToAddonRow(visa, 3) as unknown as Record<string, unknown>;
    expect(row).toMatchObject({
      serviceType: 'OTHER_ADD_ON',
      addOnServiceId: 'addon-visa',
      name: 'Visa Service',
      sellingPrice: 3000,
      pricingBasisLabel: 'Per Person',
      sequence: 3,
      imageSnapshotPresent: true,
      pdfImageUrl: 'img-1',
    });
    expect(row.images).toEqual([{ masterImageId: 'img-1', alt: 'Visa Service image 1' }]);
  });


  it('maps every pricing option into the snapshot, charging the first priced one', () => {
    const multi: PrefillAddOnMaster = {
      ...visa,
      price: 3000,
      pricingBasis: 'Per Person',
      pricing: [
        { id: 'o-1', label: 'Adult', price: 6000, currency: 'INR' },
        { id: 'o-2', label: 'Child', price: 4000, currency: 'INR' },
        { id: 'o-3', label: 'Per Group', price: 20000, currency: 'USD' },
      ],
    };
    const row = mapMasterToAddonRow(multi, 1) as unknown as Record<string, unknown>;
    // Nothing discarded: all three travel in the quotation-owned snapshot.
    expect(row.pricingSnapshot).toEqual(multi.pricing);
    expect(row).toMatchObject({ sellingPrice: 6000, pricingBasisLabel: 'Adult' });
  });

  it('keeps an unpriced first option and falls back to the legacy price', () => {
    const custom: PrefillAddOnMaster = {
      ...visa,
      pricing: [{ id: 'o-9', label: 'Custom quote', price: null, currency: 'INR' }],
    };
    const row = mapMasterToAddonRow(custom, 1) as unknown as Record<string, unknown>;
    expect(row.pricingSnapshot).toHaveLength(1);
    expect(row).toMatchObject({ sellingPrice: 3000, pricingBasisLabel: 'Custom quote' });
  });

  it('builds rows per destination without duplicates and with running sequences', () => {
    const rows = buildAddonPrefillRows(['dest-sg', 'dest-my'], [visa, sim], 5, new Set(['addon-sim']));
    expect(rows.map((row) => (row as unknown as { addOnServiceId: string }).addOnServiceId)).toEqual([
      'addon-visa',
    ]);
    expect((rows[0] as unknown as { sequence: number }).sequence).toBe(5);
  });
});

describe('QuotationBuilder — hasPolicyHtml', () => {
  it('returns false for null', () => {
    expect(hasPolicyHtml(null)).toBe(false);
  });
  it('returns false for undefined', () => {
    expect(hasPolicyHtml(undefined)).toBe(false);
  });
  it('returns false for empty string', () => {
    expect(hasPolicyHtml('')).toBe(false);
  });
  it('returns false for editor-empty HTML <p></p>', () => {
    expect(hasPolicyHtml('<p></p>')).toBe(false);
  });
  it('returns false for editor-empty HTML <p><br></p>', () => {
    expect(hasPolicyHtml('<p><br></p>')).toBe(false);
  });
  it('returns false for whitespace-only stripping', () => {
    expect(hasPolicyHtml('   ')).toBe(false);
  });
  it('returns true for meaningful content', () => {
    expect(hasPolicyHtml('<p>All meals included.</p>')).toBe(true);
  });
  it('returns true for mixed empty + text', () => {
    expect(hasPolicyHtml('<p></p><p>Real content</p>')).toBe(true);
  });
});

describe('QuotationBuilder — policyValue', () => {
  it('returns version value when meaningful', () => {
    expect(policyValue('<p>Quotation text</p>', '<p>Master text</p>')).toBe(
      '<p>Quotation text</p>',
    );
  });

  it('returns master value when version is null', () => {
    expect(policyValue(null, '<p>Master text</p>')).toBe('<p>Master text</p>');
  });

  it('returns master value when version is undefined', () => {
    expect(policyValue(undefined, '<p>Master text</p>')).toBe('<p>Master text</p>');
  });

  it('keeps cleared version (empty string) instead of restoring master', () => {
    expect(policyValue('', '<p>Master text</p>')).toBe('');
  });

  it('keeps editor-empty version instead of restoring master', () => {
    expect(policyValue('<p></p>', '<p>Master text</p>')).toBe('<p></p>');
  });

  it('returns null when both values are null', () => {
    expect(policyValue(null, null)).toBeNull();
  });

  it('keeps empty version when master is empty', () => {
    expect(policyValue('', '')).toBe('');
  });

  it('keeps empty version when master is null', () => {
    expect(policyValue('', null)).toBe('');
  });
});
