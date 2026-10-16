import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { buildDestinationPolicyPrefill, policyValue } from './QuotationBuilderPage';
import { PublicQuotationPage } from './PublicQuotationPage';
import type { Destination } from '@/features/masters/masters.api';

function publicQuotation(
  childPolicy: string | null,
  policies: Record<string, string | null> = {},
) {
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
      adults: 3,
      childrenWithBed: 1,
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
      childPolicy,
      ...policies,
      pricingHeading: 'Price Breakdown',
      pricingSubheading: null,
      pricingDisplayOrder: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      status: 'VIEWED',
    } as unknown as Record<string, unknown>,
    heroImageUrl: null,
  };
}

function mockFetch(childPolicy: string | null, policies: Record<string, string | null> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: publicQuotation(childPolicy, policies) }),
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

describe('Child Policy - Weblink', () => {
  it('shows the Child Policy section with saved content', async () => {
    vi.stubGlobal('fetch', mockFetch('<p>Children below 5 stay <strong>free</strong>.</p>'));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/test-token-child' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    // Accordion label is visible and the first policy panel opens by default.
    await screen.findByText('Child Policy');
    const panel = document.getElementById('policy-panel-child');
    expect(panel?.textContent).toMatch(/Children below 5 stay/);
    expect(panel?.textContent).toContain('free');
  });

  it('orders Child Policy immediately after Exclusions', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch('<p>Children below 5 stay <strong>free</strong>.</p>', {
        inclusionsHtml: '<p>Breakfast included</p>',
        exclusionsHtml: '<p>Flights excluded</p>',
        paymentPolicies: '<p>50 percent advance</p>',
        cancellationPolicies: '<p>Free up to 7 days</p>',
        bookingTerms: '<p>Valid for dates shown</p>',
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/test-token-child-order' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    const labels = screen
      .getAllByRole('button', { name: /Inclusions|Exclusions|Child Policy|Payment Policies|Cancellation Policies|Booking Terms/ })
      .map((button) => button.textContent);
    expect(labels).toEqual([
      'Inclusions',
      'Exclusions',
      'Child Policy',
      'Payment Policies',
      'Cancellation Policies',
      'Booking Terms',
    ]);
  });

  it('hides the Child Policy section when empty', async () => {
    vi.stubGlobal('fetch', mockFetch(null));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/test-token-no-child' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByText('Child Policy')).not.toBeInTheDocument();
  });
});

describe('Child Policy - destination prefill', () => {
  const destination = (name: string, childPolicy: string | null) =>
    ({
      name,
      inclusions: null,
      exclusions: null,
      paymentPolicies: null,
      cancellationPolicies: null,
      bookingTerms: null,
      childPolicy,
    }) as Destination;

  it('prefills the quotation Child Policy from the destination master', () => {
    const prefill = buildDestinationPolicyPrefill(
      [destination('Singapore', '<p>Children below 5 stay free</p>')],
      ['Singapore'],
    );
    expect(prefill.childPolicy).toContain('Children below 5 stay free');
    // Saved quotation content wins over the master default.
    expect(policyValue('<p>Custom child terms</p>', prefill.childPolicy)).toBe(
      '<p>Custom child terms</p>',
    );
    // Only an unset (null) quotation value falls back to the master default.
    expect(policyValue(null, prefill.childPolicy)).toContain('Children below 5 stay free');
    // A cleared quotation value stays cleared instead of restoring the master.
    expect(policyValue('', prefill.childPolicy)).toBe('');
  });

  it('leaves Child Policy empty when no destination defines one', () => {
    const prefill = buildDestinationPolicyPrefill([destination('Singapore', null)], ['Singapore']);
    expect(prefill.childPolicy).toBeUndefined();
    expect(policyValue(null, prefill.childPolicy)).toBeNull();
  });
});
