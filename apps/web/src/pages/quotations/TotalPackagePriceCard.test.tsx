import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { resolveQuotationPricing } from '@interscale/shared';
import { PublicQuotationPage } from './PublicQuotationPage';

const publicQuotation = (versionOverrides: Record<string, unknown> = {}) => ({
  company: {
    name: 'Alpha Travel',
    email: 'hello@alpha.test',
    phone: '+91 90000 00001',
    website: null,
    address: null,
    primaryColor: '#2563eb',
    logoUrl: null,
  },
  quotation: {
    quotationNumber: 'QT-2026-000001',
    customerName: 'Aarav Mehta',
    destinationSummary: 'Goa',
    travelStartDate: null,
    travelEndDate: null,
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
    rooms: 1,
    createdAt: '2026-08-04T10:00:00.000Z',
  },
  version: {
    title: 'Goa proposal',
    versionNumber: 1,
    currency: 'INR',
    finalAmount: '0',
    pricingMode: 'PER_PERSON',
    perAdultPrice: '25000',
    perChildWithBedPrice: '0',
    perChildWithoutBedPrice: '0',
    perInfantPrice: '0',
    discountAmount: '0',
    taxRate: '0',
    taxNote: null,
    initialPaymentAmount: '0',
    paymentLink: null,
    flightDetails: null,
    hotelDetails: null,
    hotels: [],
    services: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    terms: [],
    addOnDetails: { include: true },
    sightseeingDetails: { include: true, days: [] },
    pricingHeading: 'Price Breakdown',
    pricingSubheading: null,
    createdAt: '2026-08-04T10:00:00.000Z',
    status: 'VIEWED',
    ...versionOverrides,
  },
  heroImageUrl: null,
});

function mockFetch(payload: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: payload }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: {} }),
    } as unknown as Response;
  });
}

function renderWeblink(payload: unknown, token = 'token-total-card') {
  vi.stubGlobal('fetch', mockFetch(payload));
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: `/q/${token}` },
  );
}

const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);

const card = () =>
  screen.getByText('Total Package Price', { selector: 'p' }).closest('div.bg-emerald-600') as HTMLElement;

/**
 * Alignment regression guard, shared by the saved weblink and the Live Weblink
 * Preview. The heading is pinned to the top and Contact Now to the bottom; the
 * pricing group (original price + discount badge on one row, final price
 * beneath) is centred as a whole — on both axes — in the space between them.
 */
function assertPriceCentered(expectDiscount: boolean) {
  const cardEl = card();
  const inner = cardEl.firstElementChild as HTMLElement;
  const heading = inner.children[0] as HTMLElement;
  const group = inner.children[1] as HTMLElement;
  const contact = inner.children[2] as HTMLElement;

  // A flex column whose middle region grows to fill the leftover height.
  expect(inner.className).toContain('flex');
  expect(inner.className).toContain('flex-1');

  // Heading pinned to the top, Contact Now pinned to the bottom.
  expect(heading.tagName).toBe('P');
  expect(contact.tagName).toBe('A');
  expect(contact).toHaveAccessibleName(/Contact Now/);

  // The pricing group is centred vertically (justify-center) and horizontally
  // (items-center) inside the flexible middle region.
  expect(group.className).toContain('flex-1');
  expect(group.className).toContain('justify-center');
  expect(group.className).toContain('items-center');

  const finalPrice = screen.getByTestId('total-final-price');
  expect(group.contains(finalPrice)).toBe(true);
  // The button stays after the group, so the group is centred above it.
  expect(group.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  if (expectDiscount) {
    const original = screen.getByTestId('total-original-price');
    const badge = screen.getByTestId('total-discount-badge');
    const priceRow = original.parentElement as HTMLElement;

    // Struck-through original + badge share one non-wrapping row...
    expect(priceRow.className).toContain('flex');
    expect(priceRow.className).not.toContain('flex-wrap');
    expect(priceRow.contains(badge)).toBe(true);
    // ...with the badge to the right of the original price...
    expect(
      original.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and the row sits directly above the final price, inside the group.
    expect(priceRow.parentElement).toBe(group);
    expect(
      priceRow.compareDocumentPosition(finalPrice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  } else {
    // No discount: no empty space or leftover discount elements — the final
    // price is the only thing in the centred group.
    expect(screen.queryByTestId('total-original-price')).not.toBeInTheDocument();
    expect(screen.queryByTestId('total-discount-badge')).not.toBeInTheDocument();
    expect(group.firstElementChild).toBe(finalPrice);
  }
}

describe('Public weblink — Total Package Price card', () => {
  it('keeps the clean single-price card when there is no discount', async () => {
    const payload = publicQuotation();
    renderWeblink(payload);
    await screen.findByText('Custom Package for Aarav Mehta');

    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    expect(pricing.grandTotal).toBe(50000);

    const cardEl = card();
    // No fake discount, no crossed-out price and no empty badge.
    expect(within(cardEl).queryByTestId('total-original-price')).not.toBeInTheDocument();
    expect(within(cardEl).queryByTestId('total-discount-badge')).not.toBeInTheDocument();
    // The final price is the authoritative grand total.
    expect(within(cardEl).getByTestId('total-final-price')).toHaveTextContent('₹50,000');
    // The full-width white Contact Now button is preserved.
    const contact = within(cardEl).getByRole('link', { name: /Contact Now/ });
    expect(contact).toHaveAttribute('href', 'tel:+91 90000 00001');
  });

  it('highlights a fixed-amount discount with a strikethrough and a badge', async () => {
    const payload = publicQuotation({ discountAmount: '5000' });
    renderWeblink(payload, 'token-fixed-discount');
    await screen.findByText('Custom Package for Aarav Mehta');

    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // subtotal 2 × 25,000 = 50,000 − 5,000 = 45,000.
    expect(pricing.subtotal).toBe(50000);
    expect(pricing.discountAmount).toBe(5000);
    expect(pricing.grandTotal).toBe(45000);

    const cardEl = card();
    const original = within(cardEl).getByTestId('total-original-price');
    const badge = within(cardEl).getByTestId('total-discount-badge');
    const final = within(cardEl).getByTestId('total-final-price');

    // Original (pre-discount) price, muted and crossed out.
    expect(original).toHaveTextContent(money(50000));
    expect(original.className).toContain('line-through');
    // Discount badge carries the actual applied amount.
    expect(badge).toHaveTextContent('₹5,000 OFF');
    // Final price exactly matches the authoritative payable total.
    expect(final).toHaveTextContent('₹45,000');

    // Consistency: original − discount === final, to the cent.
    expect(pricing.grandTotal + pricing.discountAmount).toBe(pricing.subtotal);
    expect(pricing.subtotal - pricing.discountAmount).toBe(pricing.grandTotal);
  });

  it('renders a percentage-derived discount from the resolved amount only', async () => {
    // The engine stores a single fixed discount amount; a "10% off" campaign is
    // expressed as 10% of the 50,000 subtotal. The card must never recompute it.
    const payload = publicQuotation({ discountAmount: '5000' });
    renderWeblink(payload, 'token-percent-discount');
    await screen.findByText('Custom Package for Aarav Mehta');

    const cardEl = card();
    expect(within(cardEl).getByTestId('total-discount-badge')).toHaveTextContent('₹5,000 OFF');
    expect(within(cardEl).getByTestId('total-final-price')).toHaveTextContent('₹45,000');
  });

  it('falls back to the clean card for an invalid (negative) discount', async () => {
    const payload = publicQuotation({ discountAmount: '-1000' });
    renderWeblink(payload, 'token-invalid-discount');
    await screen.findByText('Custom Package for Aarav Mehta');

    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    const cardEl = card();
    expect(within(cardEl).queryByTestId('total-discount-badge')).not.toBeInTheDocument();
    expect(within(cardEl).queryByTestId('total-original-price')).not.toBeInTheDocument();
    expect(within(cardEl).getByTestId('total-final-price')).toHaveTextContent(
      money(pricing.grandTotal),
    );
  });

  it('echoes the same discounted total in the package breakdown', async () => {
    const payload = publicQuotation({ discountAmount: '5000' });
    renderWeblink(payload, 'token-card-consistency');
    await screen.findByText('Custom Package for Aarav Mehta');

    // Card and the By Traveler breakdown agree on the payable amount.
    expect(screen.getAllByText('₹45,000').length).toBeGreaterThanOrEqual(2);
    const breakdown = screen.getByTestId('traveler-price-breakdown');
    expect(within(breakdown).getByText('-₹5,000')).toBeInTheDocument();
  });

  it('centres the final price between the label and Contact Now (no discount)', async () => {
    renderWeblink(publicQuotation(), 'token-center-nodiscount');
    await screen.findByText('Custom Package for Aarav Mehta');
    assertPriceCentered(false);
  });

  it('centres the original price and badge above the final price (with discount)', async () => {
    renderWeblink(publicQuotation({ discountAmount: '5000' }), 'token-center-discount');
    await screen.findByText('Custom Package for Aarav Mehta');
    const cardEl = card();
    expect(within(cardEl).getByTestId('total-original-price')).toHaveTextContent(money(50000));
    expect(within(cardEl).getByTestId('total-discount-badge')).toHaveTextContent('₹5,000 OFF');
    expect(within(cardEl).getByTestId('total-final-price')).toHaveTextContent(money(45000));
    assertPriceCentered(true);
  });
});
