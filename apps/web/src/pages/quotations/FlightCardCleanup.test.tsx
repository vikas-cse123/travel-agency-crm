import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { FlightRecordCard } from './FlightRecordCard';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const detail = () => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Goa',
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
    services: [{ serviceType: 'FLIGHT' }],
  },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Goa proposal',
      introduction: null,
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      pricingMode: 'PER_PERSON',
      perAdultPrice: '0',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      taxNote: null,
      netAmount: '0',
      initialPaymentAmount: '0',
      paymentLink: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
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

function builderFetch(base: unknown) {
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

function renderCard(bookmarkCode: string | null) {
  const onLoadBookmarks = vi.fn();
  const onRemoveFlight = vi.fn();
  const flight = {
    bookmarkCode,
    journeyType: 'ONEWAY_OUTBOUND',
    outbound: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
    returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
  };
  function Harness() {
    const form = useForm({ defaultValues: { flightDetails: { flights: [flight] } } });
    return (
      <FlightRecordCard
        flightIndex={0}
        form={form as never}
        airlineList={[]}
        onLoadBookmarks={onLoadBookmarks}
        onRemoveFlight={onRemoveFlight}
      />
    );
  }
  renderWithProviders(<Harness />);
}

describe('Flight card cleanup', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('shows only the flight number in the card header', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getByRole('button', { name: /^Flight/ }));
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.queryByText(/Manual entry/)).not.toBeInTheDocument();
  });

  it('labels the loader Bookmark ID with an empty input and an aligned Load button', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getByRole('button', { name: /^Flight/ }));
    expect(screen.getByText('Bookmark ID')).toBeInTheDocument();
    expect(screen.queryByText(/Bookmark ID \(optional\)/)).not.toBeInTheDocument();

    const input = screen.getByLabelText('Flight 1 bookmark ID') as HTMLInputElement;
    expect(input.placeholder).toBe('');
    expect(input.value).toBe('');
    // Input takes the available width; Load matches its height and stays compact.
    expect(input.className).toContain('min-w-0');
    expect(input.className).toContain('flex-1');
    expect(input.className).toContain('h-[38px]');
    const load = screen.getByRole('button', { name: 'Load' });
    expect(load.className).toContain('h-[38px]');
    expect(load.className).toContain('shrink-0');
    expect(load.parentElement!.className).toContain('items-center');
  });

  it('leaves Flight Number inputs blank with no placeholder', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getByRole('button', { name: /^Flight/ }));
    const labels = screen.getAllByText('Flight Number');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const input = label.querySelector('input') as HTMLInputElement | null;
      expect(input).not.toBeNull();
      expect(input!.placeholder).toBe('');
    }
  });

  it('keeps the Loaded-from indicator when a bookmark is saved', () => {
    renderCard('FLT-000123');
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.getByText(/Loaded from FLT-000123/)).toBeInTheDocument();
    expect(screen.queryByText(/Manual entry/)).not.toBeInTheDocument();
  });
});

describe('Flight information toggle and collapsible cards', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const openFlightTab = async () => {
    await userEvent.click(screen.getByRole('button', { name: /^Flight/ }));
  };

  it('drops the FLIGHT INFORMATION heading but keeps both toggle options working', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    expect(screen.queryByText('Flight Information')).not.toBeInTheDocument();
    const fill = screen.getByRole('radio', { name: 'Fill details' });
    const upload = screen.getByRole('radio', { name: 'Upload image' });
    expect(fill).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(upload);
    expect(screen.getByRole('radio', { name: 'Upload image' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // IMAGE mode swaps the flight cards for the screenshot upload interface.
    expect(screen.getByLabelText('Flight image')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Fill details' }));
    expect(screen.getByRole('radio', { name: 'Fill details' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('Flight 1 bookmark ID')).toBeInTheDocument();
  });

  it('collapses and expands a flight card via its chevron control', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    const toggle = screen.getByRole('button', { name: 'Collapse flight 1' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand flight 1' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Header and Remove stay visible; the form body hides via CSS.
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove flight 1' })).toBeInTheDocument();
    expect(screen.getByTestId('flight-1-body')).toHaveClass('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Expand flight 1' }));
    expect(screen.getByRole('button', { name: 'Collapse flight 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId('flight-1-body')).not.toHaveClass('hidden');
    expect(screen.getByLabelText('Flight 1 bookmark ID')).toBeInTheDocument();
  });

  it('keeps each flight card collapsed state independent and preserves data', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    expect(screen.getByLabelText('Flight 1 bookmark ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Flight 2 bookmark ID')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Flight 1 bookmark ID'), 'FLT-000123');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse flight 1' }));
    // Flight 2 stays expanded while flight 1 hides its body.
    expect(screen.getByTestId('flight-1-body')).toHaveClass('hidden');
    expect(screen.getByTestId('flight-2-body')).not.toHaveClass('hidden');
    expect(screen.getByLabelText('Flight 2 bookmark ID')).toBeInTheDocument();

    // Reopening restores the entered data (react-hook-form retains values).
    await userEvent.click(screen.getByRole('button', { name: 'Expand flight 1' }));
    expect(screen.getByLabelText('Flight 1 bookmark ID')).toHaveValue('FLT-000123');
  });

  it('removes a flight without toggling the other card', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Collapse flight 1' }));
    expect(screen.getByTestId('flight-1-body')).toHaveClass('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Remove flight 2' }));
    expect(screen.queryByTestId('flight-2-body')).not.toBeInTheDocument();
    expect(screen.queryByText('Flight Details 2')).not.toBeInTheDocument();
    // Flight 1 itself is untouched and still collapsed.
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.getByTestId('flight-1-body')).toHaveClass('hidden');
  });

  it('starts newly added flights expanded', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openFlightTab();
    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    expect(screen.getByRole('button', { name: 'Collapse flight 2' })).toBeInTheDocument();
    expect(screen.getByLabelText('Flight 2 bookmark ID')).toBeInTheDocument();
  });
});
