import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
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
    }),
  );
}

async function openVehicleTab(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Quotation builder' });
  await user.click(screen.getByRole('button', { name: /Vehicle/ }));
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
    // matching vehicles appear automatically once destination + vehicle data resolve.
    await waitFor(() => {
      expect(screen.getByDisplayValue('Vehicle A')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle B')).toBeInTheDocument();
    });

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
      expect(screen.getByDisplayValue('Vehicle C')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle D')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('Vehicle A')).not.toBeInTheDocument();
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
      expect(screen.getByDisplayValue('Vehicle D')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle E')).toBeInTheDocument();
    });
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
      expect(screen.getByDisplayValue('Vehicle A')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle B')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle C')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Vehicle D')).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('Vehicle E')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Vehicle \d+ model/)).toHaveLength(4);
  });
});
