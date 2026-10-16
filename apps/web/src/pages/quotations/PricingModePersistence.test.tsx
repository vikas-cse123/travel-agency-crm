import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const quotationDetail = (pricingMode: string) => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
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
    },
  ],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
});

function masterFetch(base: unknown) {
  const routes: Record<string, unknown> = {
    '/masters/hotels': { success: true, data: [], pagination: { total: 0 } },
    '/masters/airlines': { success: true, data: [], pagination: { total: 0 } },
    '/masters/cruises': { success: true, data: [], pagination: { total: 0 } },
    '/masters/vehicles': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing/activities': { success: true, data: [], pagination: { total: 0 } },
    '/masters/add-on-services': { success: true, data: [], pagination: { total: 0 } },
    '/masters/faqs': { success: true, data: [], pagination: { total: 0 } },
    '/users': { success: true, data: [], pagination: { total: 0 } },
    '/settings': {
      success: true,
      data: { profile: { phone: null, email: 'a@b.test' }, quotationDefaults: {} },
    },
    '/destination-expert/presets': { success: true, data: [] },
  };
  return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    void options;
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes).sort(([a], [b]) => b.length - a.length))
      if (url.includes(prefix)) return response(body);
    return response(base);
  });
}

const renderBuilder = () =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

const saveAndReadPatch = async (fetchMock: ReturnType<typeof masterFetch>) => {
  await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
  );
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
  return JSON.parse(String(patch![1]!.body)) as Record<string, unknown>;
};

// Pricing Method now lives on the Quotation Details page. The builder owns no
// pricing-method UI; it only carries the stored mode through a save untouched.
describe('Builder carries the stored pricing mode through a save', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('no longer renders a Pricing Method tab', async () => {
    vi.stubGlobal('fetch', masterFetch(quotationDetail('PER_PERSON')));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    expect(screen.queryByRole('button', { name: 'Pricing Method' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flight' })).toBeInTheDocument();
  });

  it('preserves the stored SECTION_WISE mode on save', async () => {
    const fetchMock = masterFetch(quotationDetail('SECTION_WISE'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const body = await saveAndReadPatch(fetchMock);
    expect(body.pricingMode).toBe('SECTION_WISE');
  });

  it('preserves the stored PER_PERSON mode on save', async () => {
    const fetchMock = masterFetch(quotationDetail('PER_PERSON'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const body = await saveAndReadPatch(fetchMock);
    expect(body.pricingMode).toBe('PER_PERSON');
  });

  it('normalizes a legacy TOTAL quotation to PER_PERSON on save', async () => {
    const fetchMock = masterFetch(quotationDetail('TOTAL'));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const body = await saveAndReadPatch(fetchMock);
    expect(body.pricingMode).toBe('PER_PERSON');
  });
});
