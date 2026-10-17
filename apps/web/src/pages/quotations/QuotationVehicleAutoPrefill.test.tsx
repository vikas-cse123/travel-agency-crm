import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>(), user: { id: 'user-1', company: { name: 'Test' } } }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key), user: auth.user }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const DEST = {
  singapore: { id: 'dest-singapore', name: 'Singapore', status: 'ACTIVE' },
  kashmir: { id: 'dest-kashmir', name: 'Kashmir', status: 'ACTIVE' },
  goa: { id: 'dest-goa', name: 'Goa', status: 'ACTIVE' },
  // No master vehicle maps to Dubai, so a Dubai quotation must still offer the
  // Singapore/Goa vehicles for MANUAL selection while auto-prefilling nothing.
  dubai: { id: 'dest-dubai', name: 'Dubai', status: 'ACTIVE' },
  // No master vehicle maps to New Zealand, so seeded rows are left untouched
  // by auto-prefill — used to exercise card UI behavior in isolation.
  nz: { id: 'dest-nz', name: 'New Zealand', status: 'ACTIVE' },
} as const;

type DestKey = keyof typeof DEST;

interface VehicleSeed {
  id: string;
  name: string;
  vehicleType: string;
  destinations: DestKey[];
}

function vehicle(seed: VehicleSeed) {
  return {
    id: seed.id,
    name: seed.name,
    vehicleType: seed.vehicleType,
    status: 'ACTIVE',
    description: seed.name,
    price: 7000,
    images: [],
    destinations: seed.destinations.map((key) => ({ id: DEST[key].id, name: DEST[key].name })),
  };
}

// Vehicle Master: A→Singapore, B→Singapore, C→Kashmir, D→Kashmir+Goa, E→Goa
const VEHICLES = [
  vehicle({ id: 'v-a', name: 'Vehicle A', vehicleType: 'SUV', destinations: ['singapore'] }),
  vehicle({ id: 'v-b', name: 'Vehicle B', vehicleType: 'Sedan', destinations: ['singapore'] }),
  vehicle({ id: 'v-c', name: 'Vehicle C', vehicleType: 'Van', destinations: ['kashmir'] }),
  vehicle({ id: 'v-d', name: 'Vehicle D', vehicleType: 'MPV', destinations: ['kashmir', 'goa'] }),
  vehicle({ id: 'v-e', name: 'Vehicle E', vehicleType: 'Compact', destinations: ['goa'] }),
];

/** The placeholder VEHICLE_TRANSFER row the backend seeds onto a NEW quotation from the lead's requested services. */
const seededVehicleRow = {
  serviceType: 'VEHICLE_TRANSFER',
  vehicleId: null,
  name: 'vehicle transfer',
  description: null,
  dayNumber: null,
  city: null,
  quantity: '1',
  unitSellingPrice: '0',
  taxCategory: null,
  notes: null,
  images: [],
  pdfImageUrl: null,
  sequence: 1,
};

function makeQuotation(destinations: DestKey[], versionServices: unknown[] = []) {
  const destNames = destinations.map((key) => DEST[key].name);
  return {
    id: 'quotation-1',
    queryId: 'lead-1',
    destinationSummary: destNames.join(' • '),
    travelStartDate: '2026-10-10',
    travelEndDate: '2026-10-13',
    rooms: 1,
    query: {
      id: 'lead-1',
      itinerary: destinations.map((key, index) => ({
        country: DEST[key].name,
        destination: DEST[key].name,
        nights: 3,
        sequence: index + 1,
      })),
      services: [{ serviceType: 'VEHICLE_TRANSFER' }],
    },
    versions: [
      {
        id: 'version-1',
        versionNumber: 1,
        title: 'Package',
        introduction: null,
        destinationSummary: destNames.join(' • '),
        travelStartDate: null,
        travelEndDate: null,
        currency: 'INR',
        pricingMode: 'PER_PERSON',
        markupMode: 'NONE',
        markupValue: '0',
        taxRate: '0',
        discountAmount: '0',
        perAdultPrice: '0',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        netAmount: '0',
        initialPaymentAmount: '0',
        paymentLink: null,
        showServiceChargesSeparately: false,
        markServiceChargesOutside: false,
        hidePricing: false,
        showIndividualPricing: false,
        showQuickNav: true,
        quickNavSticky: true,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: true,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        hotelDetails: null,
        addOnDetails: null,
        sightseeingDetails: null,
        notes: null,
        internalNotes: null,
        status: 'DRAFT',
        finalizedAt: null,
        createdAt: '2026-09-17T00:00:00.000Z',
        createdBy: { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' },
        itinerary: [],
        hotels: [],
        services: versionServices,
        inclusions: [],
        exclusions: [],
        terms: [],
        faqs: [],
        weblinkSectionOrder: null,
        destinationExpertConfig: null,
      },
    ],
    currentVersionId: 'version-1',
  };
}

function stubApi(quotation: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/quotations/quotation-1')) return response(quotation);
      if (url.includes('/masters/destinations')) return response(page(Object.values(DEST)));
      if (url.includes('/masters/vehicles')) {
        const urlObj = new URL(url, 'http://localhost');
        const destId = urlObj.searchParams.get('destinationId');
        if (destId) {
          const filtered = VEHICLES.filter((v) =>
            v.destinations.some((d) => d.id === destId),
          );
          return response(page(filtered));
        }
        return response(page(VEHICLES));
      }
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/masters/cruises')) return response(page([]));
      if (url.includes('/masters/sightseeings')) return response(page([]));
      if (url.includes('/masters/faqs')) return response(page([]));
      if (url.includes('/users')) return response(page([]));
      if (url.includes('/settings')) return response({ profile: { phone: '', email: '' } });
      if (url.includes('/destination-expert')) return response([]);
      return response(page([]));
    });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openVehicleTab(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Quotation builder' });
  await user.click(screen.getByRole('button', { name: /Vehicle/ }));
}

// Vehicle cards start collapsed, so their inner fields are not mounted until the
// card is expanded. The collapsed header shows the mapped master name.
async function expandAllVehicles(user: ReturnType<typeof userEvent.setup>) {
  for (const button of screen.queryAllByRole('button', { name: /^Expand vehicle \d+$/ })) {
    await user.click(button);
  }
}

describe('Vehicle auto-prefill regression', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'quotations.view_costing',
      'master_vehicles.view',
    ]);
  });

  it('NEW quotation (lead already has destination Singapore, seeded placeholder row) → A and B populate the existing row with no leftover empty row', async () => {
    const user = userEvent.setup();
    stubApi(makeQuotation(['singapore'], [seededVehicleRow]));

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);

    // The lead requested a vehicle, so the section is already included; the
    // matching vehicles appear automatically once destination + vehicle data
    // resolve. Cards start collapsed, so the mapped names show in the headers.
    await waitFor(() => {
      expect(screen.getByText('Vehicle A')).toBeInTheDocument();
      expect(screen.getByText('Vehicle B')).toBeInTheDocument();
    });
    await expandAllVehicles(user);

    // Exactly two populated vehicle rows — the seeded placeholder row was filled,
    // not left behind as a third "Select Vehicle Type / Select Vehicle Model" row.
    expect(screen.getAllByLabelText(/Vehicle \d+ type/)).toHaveLength(2);
    expect(screen.getAllByLabelText(/Vehicle \d+ model/)).toHaveLength(2);

    // Rendered Vehicle Type select values are the masters' types.
    expect(screen.getByDisplayValue('SUV')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sedan')).toBeInTheDocument();

    // No manual destination picker exists.
    expect(screen.queryByLabelText('Prefill vehicles for destination')).not.toBeInTheDocument();
    expect(screen.queryByText('Vehicles for destination…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Vehicle' })).toBeInTheDocument();

    // No duplicates.
    expect(screen.getAllByDisplayValue('Vehicle A')).toHaveLength(1);
    expect(screen.getAllByDisplayValue('Vehicle B')).toHaveLength(1);
  });

  it('Kashmir → C and D (D matched via its Kashmir link)', async () => {
    const user = userEvent.setup();
    stubApi(makeQuotation(['kashmir'], []));

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);
    await user.click(await screen.findByLabelText('Include Vehicle in Quotation'));

    await waitFor(() => {
      expect(screen.getByText('Vehicle C')).toBeInTheDocument();
      expect(screen.getByText('Vehicle D')).toBeInTheDocument();
    });
    expect(screen.queryByText('Vehicle A')).not.toBeInTheDocument();
    await expandAllVehicles(user);
    expect(screen.getAllByLabelText(/Vehicle \d+ model/)).toHaveLength(2);
  });

  it('Goa → D and E (D matched via its Goa link, not duplicated)', async () => {
    const user = userEvent.setup();
    stubApi(makeQuotation(['goa'], []));

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);
    await user.click(await screen.findByLabelText('Include Vehicle in Quotation'));

    await waitFor(() => {
      expect(screen.getByText('Vehicle D')).toBeInTheDocument();
      expect(screen.getByText('Vehicle E')).toBeInTheDocument();
    });
    await expandAllVehicles(user);
    expect(screen.getAllByDisplayValue('Vehicle D')).toHaveLength(1);
    expect(screen.getAllByLabelText(/Vehicle \d+ model/)).toHaveLength(2);
  });

  it('Singapore + Kashmir → A, B, C, D (deduplicated across destinations)', async () => {
    const user = userEvent.setup();
    stubApi(makeQuotation(['singapore', 'kashmir'], []));

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);
    await user.click(await screen.findByLabelText('Include Vehicle in Quotation'));

    await waitFor(() => {
      expect(screen.getByText('Vehicle A')).toBeInTheDocument();
      expect(screen.getByText('Vehicle B')).toBeInTheDocument();
      expect(screen.getByText('Vehicle C')).toBeInTheDocument();
      expect(screen.getByText('Vehicle D')).toBeInTheDocument();
    });
    expect(screen.queryByText('Vehicle E')).not.toBeInTheDocument();
    await expandAllVehicles(user);
    expect(screen.getAllByLabelText(/Vehicle \d+ model/)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Vehicle card accordion, collapsed header, reorder and delete — Hotel parity
// ---------------------------------------------------------------------------

const vehicleRow = (id: string, name: string, sequence: number) => ({
  serviceType: 'VEHICLE_TRANSFER',
  vehicleId: id || null,
  name,
  description: null,
  dayNumber: null,
  city: 'SUV',
  quantity: '1',
  unitSellingPrice: '0',
  taxCategory: null,
  notes: null,
  images: [],
  pdfImageUrl: null,
  sequence,
});

function renderVehicleBuilder(destinations: DestKey[], rows: unknown[]) {
  const fetchMock = stubApi(makeQuotation(destinations, rows));
  renderWithProviders(
    <Routes>
      <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );
  return fetchMock;
}

describe('Vehicle builder card behavior', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'quotations.view_costing',
      'master_vehicles.view',
    ]);
  });

  it('starts every vehicle card collapsed, shows the saved name in the header and toggles independently', async () => {
    const user = userEvent.setup();
    renderVehicleBuilder(['nz'], [
      vehicleRow('11111111-1111-4111-8111-111111111111', 'Vehicle One', 1),
      vehicleRow('22222222-2222-4222-8222-222222222222', 'Vehicle Two', 2),
    ]);
    await openVehicleTab(user);

    // Card bodies are not mounted while collapsed.
    expect(screen.queryByLabelText('Vehicle 1 type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vehicle 2 type')).not.toBeInTheDocument();
    // The saved vehicle names are shown in the collapsed headers.
    expect(screen.getByRole('heading', { name: 'Vehicle One' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle Two' })).toBeInTheDocument();

    // Expanding one card does not expand the other.
    await user.click(screen.getByRole('button', { name: 'Expand vehicle 1' }));
    expect(await screen.findByLabelText('Vehicle 1 type')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vehicle 2 type')).not.toBeInTheDocument();

    // Collapsing it again hides the body without touching values.
    await user.click(screen.getByRole('button', { name: 'Collapse vehicle 1' }));
    expect(screen.queryByLabelText('Vehicle 1 type')).not.toBeInTheDocument();
  });

  it('falls back to a generic header label when no vehicle is selected', async () => {
    const user = userEvent.setup();
    renderVehicleBuilder(['nz'], [vehicleRow('', '', 1)]);
    await openVehicleTab(user);
    expect(screen.getByRole('heading', { name: 'Vehicle' })).toBeInTheDocument();
  });

  it('reorders with the icon controls, disables the ends, and persists the new order on save', async () => {
    const user = userEvent.setup();
    const fetchMock = renderVehicleBuilder(['nz'], [
      vehicleRow('11111111-1111-4111-8111-111111111111', 'Vehicle One', 1),
      vehicleRow('22222222-2222-4222-8222-222222222222', 'Vehicle Two', 2),
      vehicleRow('33333333-3333-4333-8333-333333333333', 'Vehicle Three', 3),
    ]);
    await openVehicleTab(user);

    expect(screen.getByRole('button', { name: 'Move vehicle 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move vehicle 3 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move vehicle 1 down' })).toBeEnabled();
    // Text-based move buttons are not used.
    expect(screen.queryByRole('button', { name: 'Move Up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Down' })).not.toBeInTheDocument();

    const one = screen.getByRole('heading', { name: 'Vehicle One' });
    const two = screen.getByRole('heading', { name: 'Vehicle Two' });
    expect(one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Move "Vehicle Two" up one position.
    await user.click(screen.getByRole('button', { name: 'Move vehicle 2 up' }));
    expect(
      two.compareDocumentPosition(one) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    // The latest version PATCH (ignore any initial auto-save or traveler-count PATCH).
    const versionPatches = fetchMock.mock.calls
      .filter(([, options]) => options?.method === 'PATCH')
      .map(([, options]) => JSON.parse(String(options!.body)))
      .filter(
        (body) =>
          Array.isArray(body.services) &&
          body.services.some((row: { serviceType?: string }) => row.serviceType === 'VEHICLE_TRANSFER'),
      );
    const saved = versionPatches[versionPatches.length - 1];
    const names = saved.services.map((row: { name?: string }) => row.name);
    expect(names).toEqual(['Vehicle Two', 'Vehicle One', 'Vehicle Three']);
  });

  it('removes a vehicle from an icon-only, labelled delete control', async () => {
    const user = userEvent.setup();
    renderVehicleBuilder(['nz'], [
      vehicleRow('11111111-1111-4111-8111-111111111111', 'Vehicle One', 1),
      vehicleRow('22222222-2222-4222-8222-222222222222', 'Vehicle Two', 2),
    ]);
    await openVehicleTab(user);

    // The legacy text "Remove" button is gone.
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove vehicle 2' }));
    expect(screen.queryByRole('heading', { name: 'Vehicle Two' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle One' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Destination-independent picker: every ACTIVE vehicle is offered regardless of
// the destinations it is linked to; automatic prefill stays destination-specific.
// ---------------------------------------------------------------------------

describe('Vehicle selection — any destination', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'quotations.view_costing',
      'master_vehicles.view',
    ]);
  });

  it('offers every active vehicle type/model from other destinations and fills details on selection (Dubai quotation)', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(makeQuotation(['dubai'], [seededVehicleRow]));

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);
    await expandAllVehicles(user);

    // The dropdown is fed by the destination-independent active lookup: a
    // status=ACTIVE request with NO destinationId.
    const dropdownCall = fetchMock.mock.calls.find(([url]) => {
      const value = String(url);
      return value.includes('/masters/vehicles') && !value.includes('destinationId=');
    });
    expect(String(dropdownCall?.[0])).toContain('status=ACTIVE');

    // All active types are offered, though none are linked to Dubai.
    const typeSelect = screen.getByLabelText('Vehicle 1 type');
    const typeTexts = within(typeSelect)
      .getAllByRole('option')
      .map((option) => option.textContent?.trim());
    expect(typeTexts).toEqual(expect.arrayContaining(['SUV', 'Sedan', 'Van', 'MPV', 'Compact']));

    // Nothing was linked to Dubai, so nothing was auto-prefilled: only the
    // seeded placeholder row exists.
    expect(screen.queryByRole('heading', { name: 'Vehicle A' })).not.toBeInTheDocument();

    // Selecting a Singapore vehicle's type then model fills the row.
    await user.selectOptions(typeSelect, 'SUV');
    const modelSelect = screen.getByLabelText('Vehicle 1 model') as HTMLSelectElement;
    const modelTexts = within(modelSelect)
      .getAllByRole('option')
      .map((option) => option.textContent?.trim());
    expect(modelTexts).toContain('Vehicle A');

    await user.selectOptions(modelSelect, 'v-a');
    expect(modelSelect.value).toBe('v-a');
    expect(screen.getByRole('heading', { name: 'Vehicle A' })).toBeInTheDocument();
  });

  it('shows a clear empty state instead of blank dropdowns when no active vehicles exist', async () => {
    const user = userEvent.setup();
    const quotation = makeQuotation(['dubai'], []);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/quotations/quotation-1')) return response(quotation);
      if (url.includes('/masters/destinations')) return response(page(Object.values(DEST)));
      if (url.includes('/masters/vehicles')) return response(page([]));
      if (url.includes('/users')) return response(page([]));
      if (url.includes('/settings')) return response({ profile: { phone: '', email: '' } });
      if (url.includes('/destination-expert')) return response([]);
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );

    await openVehicleTab(user);
    await user.click(await screen.findByLabelText('Include Vehicle in Quotation'));

    expect(await screen.findByRole('status')).toHaveTextContent(/No active vehicles are available/i);
    expect(screen.queryByRole('button', { name: 'Add Vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vehicle 1 type')).not.toBeInTheDocument();
  });

  it('keeps a reopened saved vehicle visible even when it is no longer in the active list', async () => {
    const user = userEvent.setup();
    const saved = {
      ...vehicleRow('99999999-9999-4999-8999-999999999999', 'Ghost Van', 1),
      city: 'Van',
    };
    renderVehicleBuilder(['dubai'], [saved]);
    await openVehicleTab(user);

    await user.click(screen.getByRole('button', { name: 'Expand vehicle 1' }));
    const modelSelect = screen.getByLabelText('Vehicle 1 model') as HTMLSelectElement;
    expect(modelSelect.value).toBe('99999999-9999-4999-8999-999999999999');
    expect(within(modelSelect).getByRole('option', { name: 'Ghost Van' })).toBeInTheDocument();
  });
});
