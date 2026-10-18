import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Hotel preview card removal — the per-stay right-side preview panel
// (image/name/stars/city + its empty state) is gone from the
// Quotation Builder; the hotel form uses the full stay width.
// Structural assertions (repo convention for builder layout: the
// stay editor lives inside the page component): behavioral coverage
// for selection, dates, rooms, gallery, pricing, save/load, and the
// Live Weblink Preview comes from the existing suites run below.
// ---------------------------------------------------------------------------

const BUILDER_SRC = readFileSync(
  `${process.cwd()}/src/pages/quotations/QuotationBuilderPage.tsx`,
  'utf8',
);

describe('per-stay hotel preview card is removed', () => {
  it('defines no HotelPreview component', () => {
    expect(BUILDER_SRC).not.toContain('function HotelPreview(');
  });

  it('renders no preview instance in any hotel stay', () => {
    expect(BUILDER_SRC).not.toContain('<HotelPreview');
  });

  it('renders neither the empty panel nor the selected-hotel summary', () => {
    expect(BUILDER_SRC).not.toContain('Select a hotel to preview');
    expect(BUILDER_SRC).not.toContain('No hotel image');
  });

  it('reserves no preview column width or empty space', () => {
    expect(BUILDER_SRC).not.toContain('minmax(0,1fr)_220px');
    expect(BUILDER_SRC).not.toContain('_220px');
  });
});

describe('hotel form uses the available width', () => {
  it('the stay editor is a single full-width column', () => {
    expect(BUILDER_SRC).toContain('<div className="grid gap-5 p-4">');
  });

  it('the Hotel Name field spans the full width', () => {
    // The name wrapper no longer constrains itself to half width.
    expect(BUILDER_SRC).not.toMatch(/HotelMasterFields[\s\S]{0,400}md:grid-cols-2/);
  });

  it('stay dates keep check-in/check-out rows with readable date inputs and no heading', () => {
    // The "Stay Dates" heading and its section-title spacing are removed.
    expect(BUILDER_SRC).not.toContain('Stay Dates');
    expect(BUILDER_SRC).toContain('aria-label="Hotel check-in time"');
    expect(BUILDER_SRC).toContain('aria-label="Hotel check-out time"');
    expect(BUILDER_SRC).toContain('aria-label="Hotel nights"');
    expect(BUILDER_SRC).toContain('aria-label="Hotel total rooms"');
    // The City field is removed from the builder UI (city data still flows
    // underneath for masters, prefill, and saves).
    expect(BUILDER_SRC).not.toContain('aria-label="Hotel city"');
    expect(BUILDER_SRC).not.toContain('· from master');
  });

  it('stay action buttons carry no plus icons and sit in one tight group', () => {
    // Labels stay; neither insertion button renders a Plus icon anymore.
    expect(BUILDER_SRC).toContain('Add Hotel Before');
    expect(BUILDER_SRC).toContain('Add Hotel After');
    expect(BUILDER_SRC).not.toMatch(/<Plus[^>]*\/>\s*Add Hotel Before/);
    expect(BUILDER_SRC).not.toMatch(/<Plus[^>]*\/>\s*Add Hotel After/);
    // Compact gap with right alignment for the whole action group.
    expect(BUILDER_SRC).toContain('justify-end gap-1.5 ml-auto shrink-0');
    // Up and Down are borderless ghost icon buttons (no boxed secondary
    // style), keeping their reorder handlers, disabled boundaries, labels,
    // and tooltips.
    expect(BUILDER_SRC).toMatch(
      /variant="ghost"\s+className="px-0\.5 hover:bg-transparent"\s+disabled=\{index === 0\}/,
    );
    expect(BUILDER_SRC).toMatch(
      /variant="ghost"\s+className="px-0\.5 hover:bg-transparent"\s+disabled=\{index === hotels\.fields\.length - 1\}/,
    );
    // Up/Down/Delete sit in their own tight icon subgroup, and both Add
    // Hotel Before and Add Hotel After render at 12px.
    expect(BUILDER_SRC).toContain('flex items-center gap-0.5');
    expect(BUILDER_SRC.match(/className="px-2 text-\[12px\]"/g)).toHaveLength(2);
    expect(BUILDER_SRC).toContain('hotels.move(index, index - 1)');
    expect(BUILDER_SRC).toContain('hotels.move(index, index + 1)');
  });
});

describe('room configuration and meal plan sections are never collapsible', () => {
  it('removes both section headings', () => {
    expect(BUILDER_SRC).not.toContain('Room Configuration');
    // The bordered "Meal Plan" heading is gone; the "Meal Plan 1" label and
    // the "Add Meal Plan" button text legitimately remain.
    expect(BUILDER_SRC).not.toMatch(
      /subsectionHeadingMuted} mb-3 border-b border-border\/50 pb-1/,
    );
  });

  it('removes the per-stay accordion state and toggles', () => {
    expect(BUILDER_SRC).not.toContain('expandedHotelSections');
    expect(BUILDER_SRC).not.toContain('toggleHotelSection');
  });

  it('renders the room and meal editors unconditionally', () => {
    expect(BUILDER_SRC).toContain('HotelRoomLinesEditor');
    expect(BUILDER_SRC).toContain('HotelMealPlanLinesEditor');
    // No conditional render gated on a collapsed/expanded flag.
    expect(BUILDER_SRC).not.toMatch(/expanded[A-Za-z]*Sections/);
  });
});

describe('the rest of the hotel stay UI is preserved', () => {
  it('selection, clearing, and stay actions remain', () => {
    expect(BUILDER_SRC).toContain('HotelMasterFields');
    expect(BUILDER_SRC).toContain('Move hotel stay');
    expect(BUILDER_SRC).toContain('hotels.remove(index)');
    expect(BUILDER_SRC).toContain('hotels.move(index');
    expect(BUILDER_SRC).toContain('Add Hotel Before');
    expect(BUILDER_SRC).toContain('Add Hotel After');
  });

  it('room configuration, meal plan, and validation remain', () => {
    expect(BUILDER_SRC).toContain('HotelRoomLinesEditor');
    expect(BUILDER_SRC).toContain('HotelMealPlanLinesEditor');
    expect(BUILDER_SRC).toContain('displayNights');
  });

  it('nights and total-rooms calculations remain', () => {
    expect(BUILDER_SRC).toContain('hotelRoomLinesTotalRooms');
    expect(BUILDER_SRC).toContain('Reset to calculated total');
  });

  it('the Hotel Images gallery remains (separate feature)', () => {
    expect(BUILDER_SRC).toContain('<QuotationImageManager');
    expect(BUILDER_SRC).toContain('label="Hotel Images"');
    expect(BUILDER_SRC).toContain('moveHotelImage');
    expect(BUILDER_SRC).toContain('setHotelPdfImage');
  });

  it('gallery hydration and master image helpers remain intact', () => {
    expect(BUILDER_SRC).toContain('hotelPreviewImportsRef');
    expect(BUILDER_SRC).toContain('importMasterGalleryPreviews');
    expect(BUILDER_SRC).toContain('mergeMasterGalleryPreviews');
    expect(BUILDER_SRC).toContain('masterGallerySnapshot');
  });

  it('bookmark imports, pricing, and save paths remain', () => {
    expect(BUILDER_SRC).toContain('quotationSnapshotImageIdentity');
    expect(BUILDER_SRC).toContain('recalculateHotelTotals');
    expect(BUILDER_SRC).toContain('useUpdateQuotationVersion');
    expect(BUILDER_SRC).toContain('save.mutate(');
  });

  it('the Live Weblink Preview panel is untouched', () => {
    expect(BUILDER_SRC).toContain('FullQuotationPreview');
  });
});

describe('collapsed card header title size', () => {
  it('renders the hotel, cruise and vehicle header title variants at 16px', () => {
    // The two hotel card-header titles (named + fallback), the cruise
    // card-header title and the vehicle card-header title all share the same
    // 16px title style.
    expect(
      BUILDER_SRC.match(
        /className="truncate font-semibold text-\[16px\] text-slate-800"/g,
      ),
    ).toHaveLength(4);
    expect(BUILDER_SRC).toContain('text-[16px] text-slate-800">Hotel Stay');
    expect(BUILDER_SRC).toMatch(
      /truncate font-semibold text-\[16px\] text-slate-800">\s*\{cruise\?\.name/,
    );
    expect(BUILDER_SRC).toMatch(
      /truncate font-semibold text-\[16px\] text-slate-800">\s*\{vehicleName\.trim\(\) \|\| 'Vehicle'\}/,
    );
  });

  it('leaves the expanded hotel form and the public weblink name untouched', () => {
    const masterFields = readFileSync(
      `${process.cwd()}/src/features/quotations/MasterFields.tsx`,
      'utf8',
    );
    expect(masterFields).not.toContain('truncate font-semibold text-[16px]');
    const weblink = readFileSync(
      `${process.cwd()}/src/pages/quotations/PublicQuotationPage.tsx`,
      'utf8',
    );
    expect(weblink).not.toContain('truncate font-semibold text-[16px]');
    // The weblink hotel name keeps its own size, weight, and colour.
    expect(weblink).toContain('text-xl font-bold leading-tight text-[#000000]');
  });
});
