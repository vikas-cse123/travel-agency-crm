import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { PublicQuotationPage } from './PublicQuotationPage';
import { resolveWeblinkDisplay } from './PublicQuotationPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

// Auto values for this fixture: main 'Singapore', duration '6 Nights / 7 Days',
// subtitle 'Custom Package for Aarav Mehta', profile 'Singapore'.
const itinerary = [{ country: 'Singapore', destination: 'Singapore', nights: 6, sequence: 1 }];

const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'version-1',
  versionNumber: 1,
  title: 'Singapore proposal',
  introduction: null,
  weblinkHeading: null,
  packageHeading: null,
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

describe('resolveWeblinkDisplay', () => {
  const source = {
    destinations: 'Singapore',
    destinationSummary: 'Singapore',
    durationNights: 6,
    travelStartDate: null,
    travelEndDate: null,
    customerName: 'Aarav Mehta',
  };
  it('resolves automatic values when no overrides exist', () => {
    expect(resolveWeblinkDisplay(source, {})).toEqual({
      mainHeading: 'Singapore',
      durationText: '6 Nights / 7 Days',
      subtitle: 'Custom Package for Aarav Mehta',
      profileDestination: 'Singapore',
    });
  });
  it('each override replaces only its own text', () => {
    expect(
      resolveWeblinkDisplay(source, {
        weblinkHeading: 'My Heading',
        packageHeading: 'My Subtitle',
        weblinkDurationText: 'My Duration',
        weblinkProfileDestination: 'My Places',
      }),
    ).toEqual({
      mainHeading: 'My Heading',
      durationText: 'My Duration',
      subtitle: 'My Subtitle',
      profileDestination: 'My Places',
    });
  });
  it('blank overrides fall back to automatic values', () => {
    const resolved = resolveWeblinkDisplay(source, {
      weblinkHeading: '   ',
      weblinkDurationText: '',
      packageHeading: null,
      weblinkProfileDestination: undefined,
    });
    expect(resolved.mainHeading).toBe('Singapore');
    expect(resolved.durationText).toBe('6 Nights / 7 Days');
    expect(resolved.subtitle).toBe('Custom Package for Aarav Mehta');
    expect(resolved.profileDestination).toBe('Singapore');
  });
});

describe('Weblink Display Settings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('renders all four fields with automatic defaults', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    expect(screen.getByText('Hero & Display Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Main Heading')).toHaveValue('');
    expect(screen.getByLabelText('Main Heading')).toHaveAttribute('placeholder', 'Singapore');
    expect(screen.getByLabelText('Duration Text')).toHaveValue('');
    expect(screen.getByLabelText('Duration Text')).toHaveAttribute('placeholder', '6 Nights / 7 Days');
    expect(screen.getByLabelText('Subtitle')).toHaveValue('');
    expect(screen.getByLabelText('Subtitle')).toHaveAttribute('placeholder', 'Custom Package for Aarav Mehta');
    expect(screen.getByLabelText('Profile Destination')).toHaveValue('');
    expect(screen.getByLabelText('Profile Destination')).toHaveAttribute('placeholder', 'Singapore');
    for (const label of ['Main Heading', 'Duration Text', 'Subtitle', 'Profile Destination']) {
      expect(screen.getByRole('button', { name: `Reset ${label} to default` })).toBeInTheDocument();
    }
  });

  it('editing a field updates only its preview text without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await pinnedReady();
    await userEvent.type(screen.getByLabelText('Main Heading'), 'Sagar Special');
    const doc = frameDocument();
    await within(doc.body as HTMLElement).findByText('Sagar Special');
    // Only the hero title changed; duration, subtitle, destinations intact.
    expect(within(doc.body as HTMLElement).getAllByText('6 Nights / 7 Days')).toHaveLength(2);
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('duration and profile overrides render in hero and profile card', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await pinnedReady();
    await userEvent.type(screen.getByLabelText('Duration Text'), 'Slow travel week');
    await userEvent.type(screen.getByLabelText('Profile Destination'), 'Singapore + Bintan');
    const doc = frameDocument();
    const body = doc.body as HTMLElement;
    // Duration override renders in both hero and profile card.
    await waitFor(() => {
      expect(within(body).getAllByText('Slow travel week')).toHaveLength(2);
    });
    expect(within(body).queryByText('6 Nights / 7 Days')).not.toBeInTheDocument();
    expect(within(body).getByText('Singapore + Bintan')).toBeInTheDocument();
    // Hero title and subtitle untouched.
    expect(doc.querySelector('header h1')?.textContent).toBe('Singapore');
    expect(
      within(body).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('saving and reopening preserves overrides; resets are independent', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    const view = renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await userEvent.type(screen.getByLabelText('Main Heading'), 'Kept Heading');
    await userEvent.type(screen.getByLabelText('Subtitle'), 'Kept Subtitle');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.weblinkHeading).toBe('Kept Heading');
    expect(body.packageHeading).toBe('Kept Subtitle');
    expect(body.weblinkDurationText ?? null).toBeNull();
    // Reopen with the saved values: overrides show, auto placeholder intact.
    view.unmount();
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({ weblinkHeading: 'Kept Heading', packageHeading: 'Kept Subtitle' }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    expect(screen.getByLabelText('Main Heading')).toHaveValue('Kept Heading');
    expect(screen.getByLabelText('Subtitle')).toHaveValue('Kept Subtitle');
    expect(screen.getByLabelText('Duration Text')).toHaveValue('');
    const reopenedFrame = frameDocument();
    await within(reopenedFrame.body as HTMLElement).findByText('Kept Subtitle');
    // Resetting one field restores its automatic text without touching others.
    await userEvent.click(screen.getByRole('button', { name: 'Reset Main Heading to default' }));
    expect(screen.getByLabelText('Main Heading')).toHaveValue('');
    expect(screen.getByLabelText('Main Heading')).toHaveAttribute('placeholder', 'Singapore');
    expect(screen.getByLabelText('Subtitle')).toHaveValue('Kept Subtitle');
    const reopenedDoc = frameDocument();
    expect(reopenedDoc.querySelector('header h1')?.textContent).toBe('Singapore');
  });

  it('different versions stay isolated; legacy versions render automatically', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder('version-1');
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    // Legacy payload without the new keys behaves like no overrides.
    expect(screen.getByLabelText('Duration Text')).toHaveValue('');
    expect(screen.getByLabelText('Duration Text')).toHaveAttribute('placeholder', '6 Nights / 7 Days');
    const doc = await pinnedReady();
    expect(
      within(doc.body as HTMLElement).getAllByText('6 Nights / 7 Days'),
    ).toHaveLength(2);
  });

  it('never touches master data and leaves PDF inputs alone', async () => {
    const calls: Array<{ url: string; method?: string | undefined }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      calls.push({ url: String(input), method: options?.method });
      return builderFetch(detail())(input, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSettings();
    await userEvent.type(screen.getByLabelText('Main Heading'), 'Touched');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
    });
    // No master writes of any kind.
    expect(
      calls.some(
        (c) =>
          c.url.includes('/masters/') &&
          (c.method === 'POST' || c.method === 'PATCH' || c.method === 'PUT' || c.method === 'DELETE'),
      ),
    ).toBe(false);
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.destinationSummary).toBe('Singapore');
    expect(body.itinerary ?? []).toEqual([]);
  });
});

describe('Public weblink display overrides', () => {
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

  it('renders saved overrides on the real weblink', async () => {
    renderWeblink(
      publicData({
        weblinkHeading: 'Live Heading',
        packageHeading: 'Live Subtitle',
        weblinkDurationText: 'Live Duration',
        weblinkProfileDestination: 'Live Places',
      }),
    );
    await screen.findByText('Live Heading');
    expect(screen.getAllByText('Live Duration')).toHaveLength(2);
    expect(screen.getByText('Live Subtitle')).toBeInTheDocument();
    expect(screen.getByText('Live Places')).toBeInTheDocument();
    expect(screen.queryByText('6 Nights / 7 Days')).not.toBeInTheDocument();
  });

  it('renders automatic values for legacy versions without overrides', async () => {
    renderWeblink(publicData({}));
    expect((await screen.findAllByText('Singapore')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('6 Nights / 7 Days')).toHaveLength(2);
    expect(screen.getByText('Custom Package for Aarav Mehta')).toBeInTheDocument();
  });
});
