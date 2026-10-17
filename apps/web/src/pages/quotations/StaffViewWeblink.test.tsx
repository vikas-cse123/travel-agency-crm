import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { PublicQuotationPage } from './PublicQuotationPage';

/**
 * The public weblink must forward the signed staff-view signal (`?stv=`) from
 * its own URL to the API, so a signed-in employee opening the link on the
 * branded/custom domain is classified HOME. Ordinary customer links carry no
 * signal and their requests must be byte-for-byte unchanged.
 */

function publicQuotation() {
  return {
    company: {
      name: 'Alpha Travel',
      email: 'hello@alpha.test',
      phone: '919876543210',
      website: null,
      address: null,
      primaryColor: '#2563eb',
      operatingSince: 2015,
      tripsSold: 4200,
      tan: 'ABCD12345E',
      taxRegistrationNumber: '29ABCDE1234F1Z5',
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
      validUntil: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      status: 'VIEWED',
    },
    version: {
      title: 'Goa proposal',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '19000',
      pricingMode: 'SECTION_WISE',
      flightDetails: null,
      hotelDetails: null,
      hotels: [],
      services: [],
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      inclusionsHtml: null,
      exclusionsHtml: null,
      paymentPolicies: null,
      cancellationPolicies: null,
      bookingTerms: null,
      childPolicy: null,
      pricingHeading: 'Price Breakdown',
      pricingSubheading: null,
      pricingDisplayOrder: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      status: 'VIEWED',
    },
    heroImageUrl: null,
  };
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: publicQuotation() }),
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

const getCalls = (mock: ReturnType<typeof mockFetch>) =>
  mock.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/api/public/quotations'));

function render(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('staff-view signal forwarding', () => {
  it('forwards ?stv= from the public URL to the weblink API', async () => {
    window.history.replaceState({}, '', '/q/customer-token-with-at-least-32-chars?stv=staff-signal-123');
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    render('/q/customer-token-with-at-least-32-chars');
    await screen.findByText('Custom Package for Aarav Mehta');
    const calls = getCalls(fetchMock);
    expect(calls.some((url) => url.includes('/api/public/quotations/customer-token-with-at-least-32-chars?stv=staff-signal-123'))).toBe(true);
  });

  it('leaves an ordinary customer link without a signal unchanged', async () => {
    window.history.replaceState({}, '', '/q/customer-token-with-at-least-32-chars');
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    render('/q/customer-token-with-at-least-32-chars');
    await screen.findByText('Custom Package for Aarav Mehta');
    const calls = getCalls(fetchMock);
    expect(calls.some((url) => url.includes('/api/public/quotations/customer-token-with-at-least-32-chars'))).toBe(true);
    expect(calls.every((url) => !url.includes('stv='))).toBe(true);
  });
});
