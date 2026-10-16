import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { PublicQuotationPage } from './PublicQuotationPage';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { QuotationDetailsPage } from './QuotationDetailsPage';
import {
  normalizeQuotationVersionForBuilder,
} from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const weblinkDay = {
  dayNumber: 1,
  title: 'City Tour',
  city: 'Singapore',
  date: null,
  meals: { breakfast: false, lunch: false, dinner: false },
  mealMode: 'NO_TRANSFER',
  dailyTransfer: 'NO_TRANSFER',
  activities: [
    {
      name: 'Merlion Park',
      description: null,
      startTime: null,
      sightseeingId: null,
      imageUrl: null,
    },
  ],
};

const publicData = (
  versionOverrides: Record<string, unknown> = {},
  quotationOverrides: Record<string, unknown> = {},
) => ({
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
    customerName: 'Akash Sahni',
    destinationSummary: 'Singapore',
    durationNights: 5,
    ...quotationOverrides,
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
    title: 'Singapore Escape',
    introduction: null,
    weblinkHeading: null,
    destinationSummary: 'Singapore',
    travelStartDate: null,
    travelEndDate: null,
    currency: 'INR',
    finalAmount: '100',
    hotels: [],
    services: [],
    sightseeingDetails: {
      include: true,
      sectionTitle: 'Sightseeing & Experiences',
      amount: 0,
      description: null,
      days: [weblinkDay],
    },
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
    vi.fn(async (input: RequestInfo | URL) => {
      const json = async () => ({ success: true, data });
      const headers = { get: () => 'application/json' };
      void input;
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

const heroHeader = () => document.querySelector('header') as HTMLElement;
const heroText = () => heroHeader().textContent ?? '';

describe('Weblink hero package heading', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set();
  });

  it('A: falls back to "Custom Package for [Lead]" for legacy versions', async () => {
    renderWeblink(publicData());
    await screen.findByText('Custom Package for Akash Sahni');
    const header = heroHeader();
    // Line 1: public destination name only.
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Singapore');
    // Line 2: duration unchanged.
    expect(within(header).getByText('5 Nights / 6 Days')).toBeInTheDocument();
    // Line 3 is the fallback, never the quotation title.
    const text = heroText();
    expect(text).toContain('Custom Package for Akash Sahni');
    expect(text).not.toContain('Singapore Escape');
    // Exact order: destination, duration, package heading.
    expect(text.indexOf('Singapore')).toBeLessThan(text.indexOf('5 Nights / 6 Days'));
    expect(text.indexOf('5 Nights / 6 Days')).toBeLessThan(
      text.indexOf('Custom Package for Akash Sahni'),
    );
  });

  it('B: shows a saved custom heading as the third line', async () => {
    renderWeblink(publicData({ packageHeading: 'Singapore Family Holiday Package' }));
    await screen.findByText('Singapore Family Holiday Package');
    const header = heroHeader();
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe('Singapore');
    expect(within(header).getByText('5 Nights / 6 Days')).toBeInTheDocument();
    const text = heroText();
    expect(text).not.toContain('Custom Package for Akash Sahni');
    expect(text).not.toContain('Singapore Escape');
    expect(text.indexOf('Singapore')).toBeLessThan(text.indexOf('5 Nights / 6 Days'));
    expect(text.indexOf('5 Nights / 6 Days')).toBeLessThan(
      text.indexOf('Singapore Family Holiday Package'),
    );
  });

  it('C: Line 1 uses the Destination Master name, never the itinerary city', async () => {
    renderWeblink(
      publicData(
        { destinationSummary: 'north goa' },
        { destinations: 'Goa Beach Escape', destinationSummary: 'north goa', durationNights: 1 },
      ),
    );
    await screen.findByText('Custom Package for Akash Sahni');
    const header = heroHeader();
    expect(within(header).getByRole('heading', { level: 1 }).textContent).toBe(
      'Goa Beach Escape',
    );
    expect(within(header).getByText('1 Nights / 2 Days')).toBeInTheDocument();
    const text = heroText();
    expect(text).not.toContain('north goa');
  });

  it('C2: first destination wins with multiple itinerary destinations', async () => {
    renderWeblink(
      publicData(
        { destinationSummary: 'north goa' },
        {
          destinations: 'Goa Beach Escape → Kerala',
          destinationSummary: 'north goa',
          durationNights: 5,
        },
      ),
    );
    await screen.findByText('Custom Package for Akash Sahni');
    expect(heroHeader().querySelector('h1')?.textContent).toBe('Goa Beach Escape');
  });

  it('D: never renders a private name in the hero', async () => {
    renderWeblink(
      publicData(
        {
          destinationSummary: 'Lucknow',
          // Even if a private name ever leaked into the payload, the hero only
          // reads the public destination summary and package heading.
          privateName: 'avd',
        },
        { destinationSummary: 'Lucknow' },
      ),
    );
    await screen.findByText('Custom Package for Akash Sahni');
    expect(heroHeader().querySelector('h1')?.textContent).toBe('Lucknow');
    expect(document.body.textContent).not.toContain('avd');
  });
});

const builderPerson = person;
const builderVersion = (overrides: Record<string, unknown> = {}) => ({
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
  pricingMode: 'PER_PERSON',
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
  createdBy: builderPerson,
  itinerary: [],
  hotels: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
  addOnDetails: { include: true },
  ...overrides,
});

const builderDetail = (versionOverrides: Record<string, unknown> = {}) => ({
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
  createdBy: builderPerson,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
  },
  versions: [builderVersion(versionOverrides)],
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

describe('Builder metadata card removal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('no longer shows the title/weblink metadata fields but keeps tabs and save', async () => {
    vi.stubGlobal('fetch', builderFetch(builderDetail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // All five metadata fields are gone from the builder.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weblink Heading')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weblink Package Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Quotation Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Weblink Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Weblink Package Heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Lead Stage')).not.toBeInTheDocument();
    // Builder chrome is unchanged.
    expect(screen.getAllByRole('button', { name: 'Save quotation' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Flight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pricing' })).toBeInTheDocument();
    // Pricing Method moved to the Quotation Details page.
    expect(screen.queryByRole('button', { name: 'Pricing Method' })).not.toBeInTheDocument();
  });

  it('preserves the stored title and headings on save without visible inputs', async () => {
    const fetchMock = builderFetch(
      builderDetail({ packageHeading: 'Singapore Package for Akash Sahni' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    // Hidden builder fields carry the loaded values through untouched.
    expect(body.title).toBe('Singapore Package');
    expect(body.packageHeading).toBe('Singapore Package for Akash Sahni');
  });

  it('normalizeQuotationVersionForBuilder keeps or nulls the heading', () => {
    expect(
      normalizeQuotationVersionForBuilder({
        packageHeading: 'Singapore Family Holiday Package',
      } as never).packageHeading,
    ).toBe('Singapore Family Holiday Package');
    expect(normalizeQuotationVersionForBuilder({} as never).packageHeading).toBeNull();
  });
});

const detailFetch = (base: unknown) =>
  vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    const method = (options?.method ?? 'GET').toUpperCase();
    if (url.includes('/public-link') && method === 'POST')
      return response({ url: 'https://preview.test/q/preview-token-1234567890abcdef1234567890' });
    if (url.includes('/api/quotations/quotation-1') && method === 'GET') return response(base);
    if (url.includes('/api/quotations/quotation-1') && method === 'PATCH') {
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

describe('Details page quotation title and package heading', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('shows the saved title and package heading from the current version', async () => {
    vi.stubGlobal(
      'fetch',
      detailFetch(
        builderDetail({
          title: 'Singapore Escape',
          packageHeading: 'Singapore Family Holiday Package',
        }),
      ),
    );
    renderDetails();
    await screen.findByRole('heading', { name: /Akash Sahni/ });
    // Actual saved values, not reconstructed ones.
    expect(screen.getByText('Singapore Escape')).toBeInTheDocument();
    expect(screen.getByText('Singapore Family Holiday Package')).toBeInTheDocument();
    expect(screen.queryByText('Custom Package for Akash Sahni')).not.toBeInTheDocument();
  });

  it('falls back to "Custom Package for [Lead]" when the saved heading is blank', async () => {
    vi.stubGlobal('fetch', detailFetch(builderDetail()));
    renderDetails();
    await screen.findByRole('heading', { name: /Akash Sahni/ });
    expect(screen.getByText('Custom Package for Akash Sahni')).toBeInTheDocument();
  });

  it('edits and saves both fields to the current version', async () => {
    const fetchMock = detailFetch(
      builderDetail({ packageHeading: 'Singapore Package for Akash Sahni' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByRole('heading', { name: /Akash Sahni/ });
    await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
    expect(screen.getByLabelText('Quotation Title')).toHaveValue('Singapore Package');
    expect(screen.getByLabelText('Weblink Package Heading')).toHaveValue(
      'Singapore Package for Akash Sahni',
    );
    await userEvent.clear(screen.getByLabelText('Quotation Title'));
    await userEvent.type(screen.getByLabelText('Quotation Title'), 'Singapore Escape');
    await userEvent.clear(screen.getByLabelText('Weblink Package Heading'));
    await userEvent.type(
      screen.getByLabelText('Weblink Package Heading'),
      'Singapore Family Holiday Package',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).includes('/versions/version-1') && options?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).includes('/versions/version-1') && options?.method === 'PATCH',
    );
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.title).toBe('Singapore Escape');
    expect(body.packageHeading).toBe('Singapore Family Holiday Package');
  });

  it('hides the editor for finalized versions and without update permission', async () => {
    const { cleanup } = await import('@testing-library/react');
    vi.stubGlobal(
      'fetch',
      detailFetch(builderDetail({ status: 'FINALIZED' } as never)),
    );
    const first = renderDetails();
    await screen.findByRole('heading', { name: /Akash Sahni/ });
    // Version history marks it finalized; no inline editor is offered.
    expect(screen.queryByRole('button', { name: 'Edit title' })).not.toBeInTheDocument();
    first.unmount();
    cleanup();

    vi.stubGlobal('fetch', detailFetch(builderDetail()));
    auth.permissions = new Set(['quotations.view']);
    renderDetails();
    await screen.findByRole('heading', { name: /Akash Sahni/ });
    expect(screen.queryByRole('button', { name: 'Edit title' })).not.toBeInTheDocument();
  });
});
