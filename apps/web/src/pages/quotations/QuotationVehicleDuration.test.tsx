import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { PublicQuotationPage } from './PublicQuotationPage';

const auth = vi.hoisted(() => ({
  permissions: new Set<string>(),
  user: { id: 'user-1', company: { name: 'Test' } },
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    hasPermission: (key: string) => auth.permissions.has(key),
    user: auth.user,
  }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 },
});
const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

/** API-shaped VEHICLE_TRANSFER service row inside a builder version fixture. */
const vehicleServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'svc-vehicle-1',
  serviceType: 'VEHICLE_TRANSFER',
  vehicleId: '11111111-1111-4111-8111-111111111111',
  name: 'Toyota Innova Crysta',
  description: null,
  dayNumber: null,
  city: 'SUV',
  quantity: '1',
  unitCost: 0,
  unitSellingPrice: '7000',
  totalSellingPrice: '7000',
  taxCategory: 'Transportation',
  notes: null,
  duration: null,
  images: [],
  imageSnapshotPresent: false,
  pdfImageUrl: null,
  sequence: 1,
  ...overrides,
});

const builderQuotation = (services: unknown[]) => ({
  quotationNumber: 'QT-2026-000001',
  destinationSummary: 'Singapore',
  travelStartDate: null,
  travelEndDate: null,
  rooms: 1,
  query: { id: 'lead-1', itinerary: [], services: [{ serviceType: 'VEHICLE_TRANSFER' }] },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Singapore package',
      introduction: null,
      destinationSummary: 'Singapore',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '0',
      subtotalCost: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      pricingMode: 'ITEMIZED',
      notes: null,
      internalNotes: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services,
      inclusions: [],
      exclusions: [],
      terms: [],
      addOnDetails: { include: true },
      faqs: [],
      weblinkSectionOrder: null,
      destinationExpertConfig: null,
    },
  ],
  currentVersionId: 'version-1',
});

/** Serve the quotation for every unmatched URL; masters resolve to empty pages. */
function stubFetch(quotation: unknown) {
  return vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    void _options;
    const url = String(input);
    if (url.includes('/masters/')) return response(page([]));
    if (url.includes('/api/users') || url.includes('/users?')) return response(page([]));
    if (url.includes('/settings')) return response({});
    return response(quotation);
  });
}

const renderBuilderPage = () =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

const openVehicleTab = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Vehicle' }));
};

const expandAllVehicles = async () => {
  for (const button of screen.queryAllByRole('button', { name: /^Expand vehicle \d+$/ })) {
    await userEvent.click(button);
  }
};

const clickSave = async () => {
  const buttons = await screen.findAllByRole('button', { name: 'Save quotation' });
  await userEvent.click(buttons[buttons.length - 1]!);
};

/** Latest version PATCH body that carries a VEHICLE_TRANSFER row. */
const getVehiclePatchBody = async (fetchMock: ReturnType<typeof stubFetch>) => {
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([, options]) => options?.method === 'PATCH' && options?.body,
      ),
    ).toBe(true),
  );
  const patch = fetchMock.mock.calls
    .filter(([, options]) => options?.method === 'PATCH')
    .map(([, options]) => JSON.parse(String(options!.body)))
    .filter(
      (body: { services?: Array<{ serviceType?: string }> }) =>
        Array.isArray(body.services) &&
        body.services.some((row) => row.serviceType === 'VEHICLE_TRANSFER'),
    );
  return patch[patch.length - 1] as { services: Array<Record<string, unknown>> };
};

describe('Vehicle Usage and Duration are separate fields', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'quotations.view_costing',
      'master_vehicles.view',
    ]);
  });

  it('renames the old label to Usage and adds a Duration input beside it', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([vehicleServiceRow()])));
    renderBuilderPage();
    await openVehicleTab();
    await expandAllVehicles();

    // Old combined label is gone.
    expect(screen.queryByText('Usage / Duration')).not.toBeInTheDocument();
    // New separate labels.
    expect(screen.getByText('Usage')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();

    // Independent inputs, each with its own accessible label.
    expect(screen.getByLabelText('Vehicle 1 usage')).toBeInTheDocument();
    expect(screen.getByLabelText('Vehicle 1 duration')).toBeInTheDocument();
  });

  it('editing Usage does not change Duration and editing Duration does not change Usage', async () => {
    const fetchMock = stubFetch(
      builderQuotation([vehicleServiceRow({ notes: 'Airport transfers', duration: '3 days' })]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openVehicleTab();
    await expandAllVehicles();

    const usageInput = screen.getByLabelText('Vehicle 1 usage') as HTMLInputElement;
    const durationInput = screen.getByLabelText('Vehicle 1 duration') as HTMLInputElement;

    // Both values reload independently.
    expect(usageInput.value).toBe('Airport transfers');
    expect(durationInput.value).toBe('3 days');

    // Change Usage only; Duration stays.
    await userEvent.clear(usageInput);
    await userEvent.type(usageInput, 'Hotel pickup & drop');
    expect(durationInput.value).toBe('3 days');

    // Change Duration only; Usage stays.
    await userEvent.clear(durationInput);
    await userEvent.type(durationInput, '8 hours');
    expect(usageInput.value).toBe('Hotel pickup & drop');

    await clickSave();
    const saved = await getVehiclePatchBody(fetchMock);
    const row = saved.services.find((r) => r.serviceType === 'VEHICLE_TRANSFER')!;
    expect(row.notes).toBe('Hotel pickup & drop');
    expect(row.duration).toBe('8 hours');
  });

  it('preserves independent values across multiple vehicles on save', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        vehicleServiceRow({
          id: 'svc-1',
          name: 'Innova',
          notes: 'Airport transfer',
          duration: '1 day',
          sequence: 1,
        }),
        vehicleServiceRow({
          id: 'svc-2',
          name: 'Tempo Traveller',
          notes: 'Sightseeing',
          duration: '4 days',
          sequence: 2,
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openVehicleTab();
    await expandAllVehicles();

    expect((screen.getByLabelText('Vehicle 1 usage') as HTMLInputElement).value).toBe(
      'Airport transfer',
    );
    expect((screen.getByLabelText('Vehicle 1 duration') as HTMLInputElement).value).toBe('1 day');
    expect((screen.getByLabelText('Vehicle 2 usage') as HTMLInputElement).value).toBe(
      'Sightseeing',
    );
    expect((screen.getByLabelText('Vehicle 2 duration') as HTMLInputElement).value).toBe('4 days');

    await clickSave();
    const saved = await getVehiclePatchBody(fetchMock);
    const vehicles = saved.services.filter((r) => r.serviceType === 'VEHICLE_TRANSFER');
    expect(vehicles).toHaveLength(2);
    expect(vehicles.map((r) => r.notes)).toEqual(['Airport transfer', 'Sightseeing']);
    expect(vehicles.map((r) => r.duration)).toEqual(['1 day', '4 days']);
  });

  it('keeps a legacy quotation (no duration) readable with empty Duration and preserves Usage', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        vehicleServiceRow({ notes: 'Airport transfers & sightseeing', duration: undefined }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openVehicleTab();
    await expandAllVehicles();

    expect((screen.getByLabelText('Vehicle 1 usage') as HTMLInputElement).value).toBe(
      'Airport transfers & sightseeing',
    );
    expect((screen.getByLabelText('Vehicle 1 duration') as HTMLInputElement).value).toBe('');

    await clickSave();
    const saved = await getVehiclePatchBody(fetchMock);
    const row = saved.services.find((r) => r.serviceType === 'VEHICLE_TRANSFER')!;
    expect(row.notes).toBe('Airport transfers & sightseeing');
    expect(row.duration ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Public weblink rendering
// ---------------------------------------------------------------------------

const publicFixture = (services: unknown[]) => ({
  company: {
    name: 'Alpha Travel',
    email: 'a@b.test',
    phone: null,
    website: null,
    address: null,
    primaryColor: '#2563eb',
  },
  quotation: {
    quotationNumber: 'QT-2026-000002',
    customerName: 'Mira Shah',
    destinationSummary: 'Singapore',
    travelStartDate: null,
    travelEndDate: null,
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
    rooms: 1,
    validUntil: null,
    status: 'VIEWED',
  },
  version: {
    title: 'Vehicle Trip',
    versionNumber: 1,
    currency: 'INR',
    finalAmount: '100',
    hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
    hotels: [],
    services,
    itinerary: [],
    inclusions: [],
    exclusions: [],
    terms: [],
  },
  vehiclePresentations: {},
  downloadUrl: null,
});

const publicVehicleService = (overrides: Record<string, unknown> = {}) => ({
  id: 'svc-vehicle-1',
  serviceType: 'VEHICLE_TRANSFER',
  name: 'Toyota Innova Crysta',
  description: null,
  dayNumber: null,
  city: 'SUV',
  quantity: '1',
  unitSellingPrice: '0',
  totalSellingPrice: '0',
  taxCategory: 'Transportation',
  notes: null,
  duration: null,
  sequence: 1,
  ...overrides,
});

const renderPublicPage = () =>
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: '/q/public-token-value-with-at-least-32-characters' },
  );

describe('Public weblink — vehicle Usage and Duration', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Usage and Duration as separate rows when both have values', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        publicFixture([
          publicVehicleService({ notes: 'Airport transfers', duration: '3 days' }),
        ]),
      ),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    const card = screen.getByRole('heading', { name: 'Toyota Innova Crysta' }).closest('article')!;
    expect(within(card).getByText('Usage:')).toBeInTheDocument();
    expect(within(card).getByText(/Airport transfers/)).toBeInTheDocument();
    expect(within(card).getByText('Duration:')).toBeInTheDocument();
    expect(within(card).getByText(/3 days/)).toBeInTheDocument();
    // Never recombined into the old single line.
    expect(screen.queryByText(/Usage \/ Duration/)).not.toBeInTheDocument();
  });

  it('renders Usage correctly and omits an empty Duration row', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(publicFixture([publicVehicleService({ notes: 'City tour', duration: null })])),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.getByText('Usage:')).toBeInTheDocument();
    expect(screen.getByText(/City tour/)).toBeInTheDocument();
    expect(screen.queryByText('Duration:')).not.toBeInTheDocument();
  });

  it('renders Duration with various free-text values and no Usage row when absent', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        publicFixture([
          publicVehicleService({ notes: null, duration: 'Airport transfer' }),
        ]),
      ),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.queryByText('Usage:')).not.toBeInTheDocument();
    expect(screen.getByText('Duration:')).toBeInTheDocument();
    expect(screen.getByText(/Airport transfer/)).toBeInTheDocument();
  });
});
