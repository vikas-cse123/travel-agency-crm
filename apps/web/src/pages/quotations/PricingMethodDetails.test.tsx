import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationDetailsPage } from './QuotationDetailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const quotationDetail = (
  pricingMode: string,
  versionOverrides: Record<string, unknown> = {},
) => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Akash Sahni',
  customerEmail: 'akash@example.test',
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Singapore',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
    services: [],
  },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Singapore Package',
      introduction: null,
      destinationSummary: 'Singapore',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '202440',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '202440',
      pricingMode,
      perAdultPrice: '101220',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      taxNote: null,
      netAmount: '0',
      initialPaymentAmount: '0',
      paymentLink: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-08-24T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      addOnDetails: { include: true },
      ...versionOverrides,
    },
  ],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
});

const detailFetch = (base: unknown) =>
  vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    const method = (options?.method ?? 'GET').toUpperCase();
    if (url.includes('/public-link') && method === 'POST')
      return response({ url: 'https://preview.test/q/preview-token-1234567890abcdef1234567890' });
    if (url.includes('/api/quotations/quotation-1') && method === 'GET') return response(base);
    if (url.includes('/api/quotations/quotation-1/versions/version-1') && method === 'PATCH') {
      const body = JSON.parse(String(options?.body ?? '{}'));
      const current = (base as { versions: Array<Record<string, unknown>> }).versions[0]!;
      return response({ ...current, ...body });
    }
    return response({});
  });

const renderDetails = () =>
  renderWithProviders(
    <Routes>
      <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
    </Routes>,
    { route: '/quotations/quotation-1' },
  );

describe('Pricing Method on the Quotation Details page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('shows the current method with both options on a DRAFT', async () => {
    vi.stubGlobal('fetch', detailFetch(quotationDetail('PER_PERSON')));
    renderDetails();
    await screen.findByRole('heading', { name: 'Pricing Method' });
    expect(screen.getByLabelText('By Section')).toBeInTheDocument();
    expect(screen.getByLabelText('By Traveler')).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists a switch to By Section to the current version', async () => {
    const fetchMock = detailFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByRole('heading', { name: 'Pricing Method' });
    await userEvent.click(screen.getByLabelText('By Section'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).includes('/versions/version-1') && options?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      ([url, options]) => String(url).includes('/versions/version-1') && options?.method === 'PATCH',
    );
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.pricingMode).toBe('SECTION_WISE');
  });

  it('does not re-send a mode when the same option is clicked again', async () => {
    const fetchMock = detailFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByRole('heading', { name: 'Pricing Method' });
    await userEvent.click(screen.getByLabelText('By Traveler'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).includes('/versions/version-1') && options?.method === 'PATCH',
      ),
    ).toBe(false);
  });

  it('is read-only for a finalized version', async () => {
    vi.stubGlobal(
      'fetch',
      detailFetch(quotationDetail('SECTION_WISE', { status: 'FINALIZED' })),
    );
    renderDetails();
    await screen.findByRole('heading', { name: 'Pricing Method' });
    expect(screen.queryByLabelText('By Section')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('By Traveler')).not.toBeInTheDocument();
    expect(screen.getByText(/Current method: By Section/)).toBeInTheDocument();
  });

  it('renders Pricing Method directly below Customer and travel', async () => {
    vi.stubGlobal('fetch', detailFetch(quotationDetail('PER_PERSON')));
    renderDetails();
    const customer = await screen.findByRole('heading', { name: 'Customer and travel' });
    const pricing = screen.getByRole('heading', { name: 'Pricing Method' });
    const visitors = screen.getByRole('heading', { name: 'Weblink visitors' });
    // DOCUMENT_POSITION_FOLLOWING === 4: the second node follows the first.
    expect(customer.compareDocumentPosition(pricing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pricing.compareDocumentPosition(visitors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is read-only without the quotations.update permission', async () => {
    auth.permissions = new Set(['quotations.view']);
    vi.stubGlobal('fetch', detailFetch(quotationDetail('PER_PERSON')));
    renderDetails();
    await screen.findByRole('heading', { name: 'Pricing Method' });
    expect(screen.queryByLabelText('By Section')).not.toBeInTheDocument();
    expect(screen.getByText(/Current method: By Traveler/)).toBeInTheDocument();
  });
});
