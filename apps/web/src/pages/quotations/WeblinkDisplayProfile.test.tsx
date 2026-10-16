import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { PublicQuotationPage, resolveWeblinkProfile } from './PublicQuotationPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const itinerary = [{ country: 'Singapore', destination: 'Singapore', nights: 6, sequence: 1 }];

const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'version-1',
  versionNumber: 1,
  title: 'Singapore proposal',
  introduction: null,
  weblinkHeading: null,
  packageHeading: null,
  weblinkDurationText: null,
  weblinkProfileDestination: null,
  weblinkProfile: null,
  destinationSummary: 'Singapore',
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
  faqs: [],
  addOnDetails: { include: true },
  ...overrides,
});

const detail = (versionOverrides: Record<string, unknown> = {}) => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
  customerPhone: '+91 98765 43210',
  destinationSummary: 'Singapore',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  currency: 'INR',
  validUntil: null,
  createdAt: '2026-07-21T00:00:00.000Z',
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
    services: [],
    itinerary,
  },
  versions: [version(versionOverrides)],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
  booking: null,
});

const settings = {
  profile: {
    name: 'Alpha Travel',
    email: 'hello@alpha.test',
    phone: null,
    website: null,
    address: null,
    googleMapsUrl: null,
    operatingSince: null,
    totalReviews: null,
    tripsSold: null,
  },
  branding: { primaryColor: '#2563eb', hotelVoucherPrimaryColor: null, hasLogo: false, logoMimeType: null, logoFileSize: null },
  tax: { taxRegistrationNumber: null, tan: null },
  preferences: { timezone: 'Asia/Kolkata', defaultCurrency: 'INR' },
  defaultTerms: { quotationTerms: null, bookingTerms: null },
  bankAccount: { exists: false },
  numbering: {},
  capabilities: { canView: true, canUpdate: true },
};

function builderFetch(base: unknown, extra: Record<string, unknown> = {}) {
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
    '/settings': settings,
    '/destination-expert/presets': { success: true, data: [] },
    ...extra,
  };
  return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    void options;
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes).sort(([a], [b]) => b.length - a.length))
      if (url.includes(prefix)) return response(body);
    return response(base);
  });
}

const renderBuilder = (versionId = 'version-1') =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: `/quotations/quotation-1/versions/${versionId}/edit` },
  );

const openSettings = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
};

function frameDocument(): Document {
  const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('preview frame has no document');
  return doc;
}

async function pinnedReady(): Promise<Document> {
  const doc = frameDocument();
  await within(doc.body as HTMLElement).findByText('Custom Package for Aarav Mehta');
  return doc;
}

const PROFILE_LABELS = [
  'Traveler Name',
  'Travel Date',
  'Duration',
  'Travelers',
  'CWB Ages',
  'CWOB Ages',
  'Infant Ages',
  'Quotation ID',
  'Destinations',
];

function versionPatch(fetchMock: ReturnType<typeof builderFetch>) {
  return fetchMock.mock.calls.find(
    ([, options]) =>
      options?.method === 'PATCH' && String(options.body ?? '').includes('"destinationSummary"'),
  );
}

describe('resolveWeblinkProfile', () => {
  const base = {
    autoValues: {
      travelerName: 'Aarav Mehta',
      travelDate: '10 Mar 2026',
      duration: '6 Nights / 7 Days',
      travelers: '2 Adults, 1 CWB, 1 Infant',
      cwbAges: '8',
      cwobAges: '',
      infantAges: '1',
      quotationId: '#2026-000001',
      destinations: 'Singapore',
    },
    autoPreparedBy: { name: 'Aditi Rao', phone: '+91 90000 00001', email: 'aditi@alpha.test' },
  };

  it('falls back to the automatic labels and values when nothing is customized', () => {
    const resolved = resolveWeblinkProfile({ ...base, overrides: null });
    expect(resolved.items.map((item) => item.label)).toEqual(PROFILE_LABELS);
    expect(resolved.items.map((item) => item.id)).toEqual([
      'travelerName',
      'travelDate',
      'duration',
      'travelers',
      'cwbAges',
      'cwobAges',
      'infantAges',
      'quotationId',
      'destinations',
    ]);
    expect(resolved.items.find((item) => item.id === 'travelerName')?.value).toBe('Aarav Mehta');
    expect(resolved.items.every((item) => item.hidden === false)).toBe(true);
    expect(resolved.preparedBy).toEqual({
      label: 'Prepared By',
      name: 'Aditi Rao',
      phone: '+91 90000 00001',
      email: 'aditi@alpha.test',
      hidden: false,
    });
  });

  it('a custom label and value replace only that row', () => {
    const resolved = resolveWeblinkProfile({
      ...base,
      overrides: { travelerName: { label: 'Guest', value: 'The Mehtas' } },
    });
    const row = resolved.items.find((item) => item.id === 'travelerName');
    expect(row?.label).toBe('Guest');
    expect(row?.value).toBe('The Mehtas');
    expect(resolved.items.find((item) => item.id === 'travelers')?.value).toBe(
      '2 Adults, 1 CWB, 1 Infant',
    );
    expect(resolved.items.find((item) => item.id === 'travelers')?.label).toBe('Travelers');
  });

  it('blank customizations fall back to the automatic value and label', () => {
    const resolved = resolveWeblinkProfile({
      ...base,
      overrides: { duration: { label: '   ', value: '' } },
    });
    const row = resolved.items.find((item) => item.id === 'duration');
    expect(row?.label).toBe('Duration');
    expect(row?.value).toBe('6 Nights / 7 Days');
  });

  it('flags hidden rows and resolves prepared-by overrides independently', () => {
    const resolved = resolveWeblinkProfile({
      ...base,
      overrides: {
        cwbAges: { hidden: true },
        preparedBy: { label: 'Your Expert', name: 'Ravi', phone: '', email: 'ravi@alpha.test' },
      },
    });
    expect(resolved.items.find((item) => item.id === 'cwbAges')?.hidden).toBe(true);
    expect(resolved.items.find((item) => item.id === 'duration')?.hidden).toBe(false);
    expect(resolved.preparedBy.label).toBe('Your Expert');
    expect(resolved.preparedBy.name).toBe('Ravi');
    // Blank phone falls back to the automatic company number.
    expect(resolved.preparedBy.phone).toBe('+91 90000 00001');
    expect(resolved.preparedBy.email).toBe('ravi@alpha.test');
  });
});

describe('Builder profile information settings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('renders every profile row and prepared by with automatic placeholders', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    expect(screen.getByText('Profile Information')).toBeInTheDocument();
    for (const label of PROFILE_LABELS) {
      expect(screen.getByLabelText(`${label} value`)).toHaveValue('');
      expect(screen.getByLabelText(`${label} label`)).toHaveValue('');
      expect(screen.getByLabelText(`Show ${label}`)).toBeChecked();
    }
    expect(screen.getByLabelText('Traveler Name value')).toHaveAttribute('placeholder', 'Aarav Mehta');
    expect(screen.getByLabelText('Travel Date value')).toHaveAttribute('placeholder', 'Flexible');
    expect(screen.getByLabelText('Duration value')).toHaveAttribute('placeholder', '6 Nights / 7 Days');
    expect(screen.getByLabelText('Travelers value')).toHaveAttribute('placeholder', '2 Adults');
    expect(screen.getByLabelText('Quotation ID value')).toHaveAttribute('placeholder', '#QT-2026-000001');
    expect(screen.getByLabelText('Destinations value')).toHaveAttribute('placeholder', 'Singapore');
    expect(screen.getByLabelText('Prepared By name')).toHaveAttribute('placeholder', 'Aditi Rao');
  });

  it('editing a value updates the live preview without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await pinnedReady();
    await userEvent.type(screen.getByLabelText('Travelers value'), '2 Adults, 1 Child');
    const doc = frameDocument();
    await within(doc.body as HTMLElement).findByText('2 Adults, 1 Child');
    expect(
      fetchMock.mock.calls.some(
        ([, options]) => options?.method === 'PATCH' || options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('hiding a row removes it from the live preview', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await pinnedReady();
    await userEvent.click(screen.getByLabelText('Show Travel Date'));
    const doc = frameDocument();
    await waitFor(() => {
      expect(within(doc.body as HTMLElement).queryByText('Travel Date')).not.toBeInTheDocument();
    });
    expect(within(doc.body as HTMLElement).getByText('Traveler Name')).toBeInTheDocument();
  });

  it('saves the profile config and reopens with the values hydrated', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    const view = renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await userEvent.type(screen.getByLabelText('Traveler Name value'), 'The Mehtas');
    await userEvent.type(screen.getByLabelText('Traveler Name label'), 'Guest');
    await userEvent.click(screen.getByLabelText('Show Infant Ages'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(versionPatch(fetchMock)).toBeTruthy();
    });
    const body = JSON.parse(String(versionPatch(fetchMock)![1]!.body));
    expect(body.weblinkProfile).toMatchObject({
      travelerName: { label: 'Guest', value: 'The Mehtas' },
      infantAges: { hidden: true },
    });

    view.unmount();
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          weblinkProfile: {
            travelerName: { label: 'Guest', value: 'The Mehtas' },
            infantAges: { hidden: true },
          },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    expect(screen.getByLabelText('Traveler Name value')).toHaveValue('The Mehtas');
    expect(screen.getByLabelText('Traveler Name label')).toHaveValue('Guest');
    expect(screen.getByLabelText('Show Infant Ages')).not.toBeChecked();
  });
});

describe('Public weblink profile overrides', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const publicData = (versionOverrides: Record<string, unknown> = {}) => ({
    company: {
      name: 'Alpha Travel',
      email: 'a@b.test',
      phone: null,
      website: null,
      address: null,
      primaryColor: '#2563eb',
    },
    quotation: {
      quotationNumber: 'QT-2026-000001',
      customerName: 'Aarav Mehta',
      destinationSummary: 'Singapore',
      destinations: 'Singapore',
      durationNights: 6,
      travelStartDate: null,
      travelEndDate: null,
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      rooms: 1,
    },
    version: {
      title: 'Singapore proposal',
      introduction: null,
      weblinkHeading: null,
      packageHeading: null,
      currency: 'INR',
      finalAmount: '0',
      createdBy: person,
      hotels: [],
      services: [],
      sightseeingDetails: null,
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      ...versionOverrides,
    },
    downloadUrl: null,
  });

  const renderWeblink = (data: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const json = async () => ({ success: true, data });
        const headers = { get: () => 'application/json' };
        return { ok: true, status: 200, headers, json } as unknown as Response;
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
  };

  it('renders custom labels and values from the saved profile config', async () => {
    renderWeblink(
      publicData({
        weblinkProfile: {
          travelerName: { label: 'Guest', value: 'The Mehtas' },
          destinations: { value: 'Singapore & Bintan' },
        },
      }),
    );
    expect(await screen.findByText('Guest')).toBeInTheDocument();
    expect(screen.getByText('The Mehtas')).toBeInTheDocument();
    expect(screen.getByText('Singapore & Bintan')).toBeInTheDocument();
  });

  it('hides a row when marked hidden and keeps the rest automatic', async () => {
    renderWeblink(publicData({ weblinkProfile: { travelDate: { hidden: true } } }));
    await screen.findAllByText('Singapore');
    expect(screen.queryByText('Travel Date')).not.toBeInTheDocument();
    expect(screen.getByText('Traveler Name')).toBeInTheDocument();
  });

  it('renders a customized prepared by block', async () => {
    renderWeblink(
      publicData({
        weblinkProfile: {
          preparedBy: {
            label: 'Your Expert',
            name: 'Ravi Kumar',
            phone: '+91 91111 22222',
            email: 'ravi@alpha.test',
          },
        },
      }),
    );
    expect(await screen.findByText('Your Expert')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('+91 91111 22222')).toBeInTheDocument();
    expect(screen.getByText('ravi@alpha.test')).toBeInTheDocument();
  });

  it('hides the prepared by block entirely when marked hidden', async () => {
    renderWeblink(publicData({ weblinkProfile: { preparedBy: { hidden: true } } }));
    await screen.findAllByText('Singapore');
    expect(screen.queryByText('Prepared By')).not.toBeInTheDocument();
  });
});
