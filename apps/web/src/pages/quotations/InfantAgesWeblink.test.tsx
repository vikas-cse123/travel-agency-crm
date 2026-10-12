import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { PublicQuotationPage } from './PublicQuotationPage';

function publicQuotation(ages: {
  infants?: number;
  infantAges?: number[] | null;
  childrenWithBed?: number;
  childrenWithBedAges?: number[] | null;
}) {
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
      childrenWithBed: ages.childrenWithBed ?? 0,
      childrenWithoutBed: 0,
      infants: ages.infants ?? 0,
      rooms: 1,
      childrenWithBedAges: ages.childrenWithBedAges ?? null,
      childrenWithoutBedAges: null,
      infantAges: ages.infantAges ?? null,
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
    } as unknown as Record<string, unknown>,
    heroImageUrl: null,
  };
}

function mockFetch(ages: Parameters<typeof publicQuotation>[0]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: publicQuotation(ages) }),
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

function renderWeblink() {
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: '/q/test-token-infant' },
  );
}

describe('Infant Ages - Weblink', () => {
  it('shows a single infant age explicitly in months', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 1, infantAges: [8] }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('Infant Ages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 months').length).toBeGreaterThan(0);
  });

  it('shows every infant age with month units', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 2, infantAges: [8, 10] }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('8 months, 10 months').length).toBeGreaterThan(0);
  });

  it('omits the Infant Ages line when ages are missing', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 1, infantAges: null }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByText('Infant Ages')).not.toBeInTheDocument();
  });

  it('keeps CWB age formatting unchanged (years, no unit)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ infants: 1, infantAges: [8], childrenWithBed: 1, childrenWithBedAges: [8, 10] }),
    );
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('CWB Ages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8, 10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 months').length).toBeGreaterThan(0);
  });
});
