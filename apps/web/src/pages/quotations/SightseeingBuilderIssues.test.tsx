import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { decodeHtmlEntities } from '@/utils/richTextPaste';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const day = (n: number, title: string, activityName: string, description: unknown = null) => ({
  dayNumber: n,
  title,
  city: 'Singapore',
  date: null,
  meals: { breakfast: false, lunch: false, dinner: false },
  mealMode: 'NO_TRANSFER',
  dailyTransfer: 'NO_TRANSFER',
  activities: [
    {
      sightseeingId: null,
      name: activityName,
      description,
      startTime: '09:00',
      duration: null,
      city: 'Singapore',
      imageUrl: null,
      dailyTransfer: null,
      pricingOptions: [],
      sequence: 1,
    },
  ],
});

const threeDays = () => [
  day(1, 'Alpha', 'Act A', 'About Alpha.'),
  day(2, 'Bravo', 'Act B', 'About Bravo.'),
  day(3, 'Charlie', 'Act C', 'About Charlie.'),
];

const version = (overrides: Record<string, unknown> = {}) => ({
  id: 'version-1',
  versionNumber: 1,
  title: 'Singapore proposal',
  introduction: null,
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
  sightseeingDetails: {
    include: true,
    sectionTitle: 'Your Itinerary',
    amount: 0,
    description: null,
    days: threeDays(),
  },
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
  customerPhone: '+91 90000 00000',
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
    services: [{ serviceType: 'SIGHTSEEING' }],
    itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
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
    phone: '+91 90000 00001',
    website: 'https://alpha.test',
    address: 'Singapore',
    googleMapsUrl: null,
    operatingSince: 2015,
    totalReviews: null,
    tripsSold: 4200,
  },
  branding: { primaryColor: '#2563eb', hotelVoucherPrimaryColor: null, hasLogo: false, logoMimeType: null, logoFileSize: null },
  tax: { taxRegistrationNumber: '29ABCDE1234F1Z5', tan: 'ABCD12345E' },
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

const openSightseeing = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
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

const daySelectButtons = () =>
  screen.getAllByRole('button', { name: /Select sightseeing day/ });

describe('decodeHtmlEntities', () => {
  const NBSP = '\u00A0';
  it('decodes named, double-escaped, and numeric non-breaking spaces', () => {
    expect(decodeHtmlEntities('A&nbsp;B')).toBe(`A${NBSP}B`);
    expect(decodeHtmlEntities('Fish &amp;nbsp; Chips')).toBe(`Fish ${NBSP} Chips`);
    expect(decodeHtmlEntities('&#160;')).toBe(NBSP);
    expect(decodeHtmlEntities('&#xA0;')).toBe(NBSP);
    expect(decodeHtmlEntities('Fish &amp; Chips')).toBe('Fish & Chips');
    expect(decodeHtmlEntities('<p>a&nbsp;<strong>b</strong></p>')).toContain('<strong>b</strong>');
  });
});

describe('Sightseeing builder issues', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('Task 1: default section title is Your Itinerary', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail({ sightseeingDetails: null })),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    expect(await screen.findByLabelText('Sightseeing section title')).toHaveValue('Your Itinerary');
  });

  it('Task 1: previous default migrates, custom titles preserved', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Sightseeing & Experiences',
            amount: 0,
            description: null,
            days: threeDays(),
          },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    // Old default becomes the new default in the builder field…
    expect(await screen.findByLabelText('Sightseeing section title')).toHaveValue('Your Itinerary');
    // …and the preview heading follows (live, unsaved).
    const doc = await pinnedReady();
    expect(
      within(doc.body as HTMLElement).getByRole('heading', { name: 'Your Itinerary' }),
    ).toBeInTheDocument();
  });

  it('Task 1: custom title drives preview heading and nav without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    const title = await screen.findByLabelText('Sightseeing section title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Singapore Holiday Itinerary');
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(
      await within(body).findByRole('heading', { name: 'Singapore Holiday Itinerary' }),
    ).toBeInTheDocument();
    // Navigation chip follows the same title.
    const nav = within(body).getByRole('navigation', { name: 'Quotation sections' });
    expect(within(nav).getByRole('button', { name: 'Singapore Holiday Itinerary' })).toBeInTheDocument();
    // Builder tab itself is untouched.
    expect(screen.getByRole('button', { name: 'Sightseeing' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('Task 2: section Description gone, per-activity Description kept', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    expect(screen.queryByLabelText('Sightseeing description')).not.toBeInTheDocument();
    // Days area moved up: day list is present…
    expect(screen.getAllByRole('button', { name: /Select sightseeing day/ })).toHaveLength(3);
    // …and every activity keeps its own Description editor.
    expect(screen.getByLabelText('Day 1 activity 1 description')).toBeInTheDocument();
  });

  it('Task 3: standalone Add Day button is absent', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    expect(screen.queryByRole('button', { name: 'Add Day' })).not.toBeInTheDocument();
    // Insertion still available through Before/After.
    expect(screen.getByRole('button', { name: 'Add Day Before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Day After' })).toBeInTheDocument();
  });

  it('Task 4: Before/After insert relative to the selected day', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    const before = screen.getByRole('button', { name: 'Add Day Before' });
    const after = screen.getByRole('button', { name: 'Add Day After' });
    // Compact single-line labels with tooltips carrying the full names.
    expect(before.textContent?.trim()).toBe('Before');
    expect(after.textContent?.trim()).toBe('After');
    expect(before).toHaveAttribute('title', 'Add Day Before');
    expect(after).toHaveAttribute('title', 'Add Day After');
    expect(before.className).toMatch(/whitespace-nowrap/);
    expect(after.className).toMatch(/whitespace-nowrap/);
    expect(before.querySelector('svg')).not.toBeNull();
    expect(after.querySelector('svg')).not.toBeNull();
    // Select day 2, insert before → new day lands at index 1 and is selected.
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 2' }));
    await userEvent.click(before);
    expect(daySelectButtons()).toHaveLength(4);
    expect(screen.getByLabelText('Sightseeing day 2 title')).toBeInTheDocument();
    // Insert after the (new) day 2 → lands at index 2 and is selected.
    await userEvent.click(after);
    expect(daySelectButtons()).toHaveLength(5);
    expect(screen.getByLabelText('Sightseeing day 3 title')).toBeInTheDocument();
  });

  it('Task 5+7: per-row icon-only reorder with left badges and boundaries', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    // Shared text-button row is gone.
    expect(screen.queryByRole('button', { name: 'Move selected day up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move selected day down' })).not.toBeInTheDocument();
    const rows = daySelectButtons();
    expect(rows).toHaveLength(3);
    for (const [i, btn] of rows.entries()) {
      const row = btn.closest('div') as HTMLElement;
      const up = within(row).getByRole('button', { name: `Move Day ${i + 1} up` });
      const down = within(row).getByRole('button', { name: `Move Day ${i + 1} down` });
      // Icon-only with real icons.
      expect(up.textContent?.trim()).toBe('');
      expect(down.textContent?.trim()).toBe('');
      expect(up.querySelector('svg')).not.toBeNull();
      expect(down.querySelector('svg')).not.toBeNull();
      // Badge is the first element: [N] [title] … [up] [down].
      expect(btn.firstElementChild?.textContent).toBe(String(i + 1));
      const kids = Array.from(row.children).filter((el) => el.tagName === 'BUTTON');
      expect(kids[0]).toBe(btn);
    }
    // Boundaries.
    const firstRow = rows[0]!.closest('div') as HTMLElement;
    const lastRow = rows[2]!.closest('div') as HTMLElement;
    expect(within(firstRow).getByRole('button', { name: 'Move Day 1 up' })).toBeDisabled();
    expect(within(lastRow).getByRole('button', { name: 'Move Day 3 down' })).toBeDisabled();
    expect(within(firstRow).getByRole('button', { name: 'Move Day 1 down' })).toBeEnabled();
    // Reorder moves content with selection following (Alpha was day 1).
    await userEvent.click(within(firstRow).getByRole('button', { name: 'Move Day 1 down' }));
    const updated = daySelectButtons();
    expect(updated[0]!.textContent).toContain('Bravo');
    expect(updated[1]!.textContent).toContain('Alpha');
    // Selection followed Alpha to index 1: its activity still edits there.
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Act A');
    // Badge numbers track positions, shown once each.
    expect(updated[0]!.firstElementChild?.textContent).toBe('1');
    expect(updated[1]!.firstElementChild?.textContent).toBe('2');
  });

  it('Task 6 + Task 2 (new): day-detail header has no Add Day buttons; Remove Day + Add Activity After work', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    expect(screen.queryByRole('button', { name: 'Insert sightseeing day after day 1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Insert sightseeing day before day 1' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sightseeing day 1 title')).toBeInTheDocument();
    expect(screen.getByLabelText('Sightseeing day 1 city')).toBeInTheDocument();
    // Add Activity After belongs to the activity editor and remains.
    expect(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );
    expect(screen.getByLabelText('Day 1 activity 2 name')).toBeInTheDocument();
    // Remove Day still removes the selected day.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Day' }));
    expect(daySelectButtons()).toHaveLength(2);
  });

  it('Task 7: badges show positions including Day 11+ without duplicates', async () => {
    const days = Array.from({ length: 12 }, (_, i) =>
      day(i + 1, `Place ${i + 1}`, `Act ${i + 1}`, `About ${i + 1}.`),
    );
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          sightseeingDetails: { include: true, sectionTitle: 'Your Itinerary', amount: 0, description: null, days },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    const rows = daySelectButtons();
    expect(rows).toHaveLength(12);
    // Two-digit badges render fully at the row start, exactly once per row.
    expect(rows[9]!.firstElementChild?.textContent).toBe('10');
    expect(rows[10]!.firstElementChild?.textContent).toBe('11');
    expect(rows[11]!.firstElementChild?.textContent).toBe('12');
    const badgeTexts = rows.map((b) => b.firstElementChild?.textContent);
    expect(new Set(badgeTexts).size).toBe(12);
  });

  it('Task 8: entities render as content, formatting and links intact, no injection', async () => {
    const description =
      '<p>Beach&nbsp;day with <strong>sun</strong> &amp; sand</p>' +
      '<ul><li>Snorkel &#160; reef</li><li>Fish &amp;nbsp; chips &#xA0; please</li></ul>' +
      '<p>More at <a href="https://example.test/tide">tide&nbsp;times</a></p>' +
      '<script>window.__evil = 1;</script><img src="x" onerror="window.__evil = 2">';
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Your Itinerary',
            amount: 0,
            description: null,
            days: [day(1, 'Alpha', 'Act A', description)],
          },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const section = doc.querySelector('[data-preview-section="itinerary"]') as HTMLElement;
    const text = section.textContent ?? '';
    const html = section.innerHTML;
    // No literal entity artifacts anywhere in the rendered itinerary.
    for (const artifact of ['&nbsp;', '&amp;nbsp;', '&#160;', '&#xA0;', '&amp;amp;']) {
      expect(text).not.toContain(artifact);
    }
    // Intended content present with formatting and links intact.
    expect(text).toContain('Beach');
    expect(text).toContain('sun');
    expect(text).toContain('Fish');
    expect(text).toContain('chips');
    expect(section.querySelector('strong')).not.toBeNull();
    const link = section.querySelector('a[href="https://example.test/tide"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    // No script execution vectors survive.
    expect(section.querySelector('script')).toBeNull();
    expect(section.querySelector('[onerror]')).toBeNull();
    expect(html).not.toContain('onerror');
  });

  it('Task 8: plain-text entities and ordinary special characters stay correct', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Your Itinerary',
            amount: 0,
            description: null,
            days: [day(1, 'Alpha', 'Act A', 'Fish & Chips&nbsp;here')],
          },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const section = doc.querySelector('[data-preview-section="itinerary"]') as HTMLElement;
    const text = section.textContent ?? '';
    expect(text).not.toContain('&nbsp;');
    expect(text).not.toContain('&amp;');
    expect(text).toContain('Fish & Chips');
    expect(text).toContain('here');
  });

  it('Task 8: editing a description updates the preview live with no artifacts', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    await pinnedReady();
    const editor = (await screen.findByLabelText('Day 1 activity 1 description')) as HTMLElement;
    editor.innerHTML = '<p>Live&nbsp;update &amp; more</p>';
    fireEvent.input(editor);
    const doc = frameDocument();
    await within(doc.body as HTMLElement).findByText(/Live/);
    const section = doc.querySelector('[data-preview-section="itinerary"]') as HTMLElement;
    expect(section.textContent ?? '').not.toContain('&nbsp;');
    expect(section.textContent ?? '').toContain('Live');
    // Saved value keeps the stored HTML (no destructive rewrite on save).
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(String(body.sightseeingDetails.days[0].activities[0].description)).toContain('Live');
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH').length,
    ).toBeGreaterThan(0);
  });
});

describe('Sightseeing master meals end-to-end', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const masterLunch = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Hawker lunch tour',
    sequence: 1,
    estimatedHours: 2,
    suggestedStartTime: '12:00',
    description: null,
    pricing: [],
    mealDefaults: {
      meals: { breakfast: false, lunch: true, dinner: false },
      mealModes: { lunch: 'WITH_TRANSFER' },
      mealTransferDetails: { lunch: 'Hawker pickup at noon' },
      transfer: 'SHARED',
    },
    destination: { id: 'dest-1', name: 'Singapore' },
    city: { id: 'city-1', name: 'Singapore' },
    images: [],
  };

  const feedWith = (activities: unknown[]) => ({
    destination: { id: 'dest-1', name: 'Singapore' },
    city: { id: 'city-1', name: 'Singapore' },
    activities,
  });

  async function pickActivity(activityTitle: string) {
    const select = await screen.findByRole('combobox', { name: 'Day 1 activity 1' });
    await userEvent.click(select);
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByText(activityTitle));
  }

  it('prefills meals, mode, details, and transfer into builder, preview, and save', async () => {
    const fetchMock = builderFetch(detail(), {
      '/masters/sightseeing/activities': feedWith([masterLunch]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    await pinnedReady();

    await pickActivity('Hawker lunch tour');
    // Builder reflects the master exactly.
    expect(screen.getByLabelText('breakfast')).not.toBeChecked();
    await waitFor(() => expect(screen.getByLabelText('lunch')).toBeChecked());
    expect(screen.getByLabelText('dinner')).not.toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'lunch meal options' })).getByLabelText(
        'With Transfer',
      ),
    ).toBeChecked();
    expect(screen.getByLabelText('lunch transfer details')).toHaveValue('Hawker pickup at noon');
    expect(
      screen.getByLabelText('Day 1 activity 1 daily transfer Shared Transfer'),
    ).toBeChecked();
    // Live preview renders the prefilled details without saving.
    const doc = frameDocument();
    await within(doc.body as HTMLElement).findByText(/Hawker pickup at noon/);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
    // Saving preserves the quotation's own values.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.sightseeingDetails.days[0].mealPreferences.lunch).toMatchObject({
      mode: 'WITH_TRANSFER',
      transferDetails: 'Hawker pickup at noon',
    });
    expect(body.sightseeingDetails.days[0].activities[0].dailyTransfer).toBe('SHARED');
  });

  it('editing prefilled meals updates the preview immediately', async () => {
    const fetchMock = builderFetch(detail(), {
      '/masters/sightseeing/activities': feedWith([masterLunch]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    await pickActivity('Hawker lunch tour');
    await within(frameDocument().body as HTMLElement).findByText(/Hawker pickup at noon/);
    // Edit the details: preview follows at once, still without saving.
    await userEvent.clear(screen.getByLabelText('lunch transfer details'));
    await userEvent.type(screen.getByLabelText('lunch transfer details'), 'Changed pickup');
    await within(frameDocument().body as HTMLElement).findByText(/Changed pickup/);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('reopening keeps saved quotation meal overrides', async () => {
    const savedDay = {
      ...day(1, 'Alpha', 'Hawker lunch tour', null),
      meals: { breakfast: false, lunch: true, dinner: false },
      mealPreferences: { lunch: { mode: 'WITH_TRANSFER', transferDetails: 'Kept details' } },
      activities: [
        {
          sightseeingId: '11111111-1111-4111-8111-111111111111',
          name: 'Hawker lunch tour',
          description: null,
          startTime: null,
          showTime: false,
          duration: null,
          city: 'Singapore',
          imageUrl: null,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
          dailyTransfer: 'PRIVATE',
          pricingOptions: [],
          pricingBasis: null,
          pricingQuantity: null,
          sequence: 1,
          displayPricing: [],
          displayPricingHeading: 'PRICING',
        },
      ],
    };
    vi.stubGlobal('fetch', builderFetch(detail({ sightseeingDetails: {
      include: true,
      sectionTitle: 'Your Itinerary',
      amount: 0,
      description: null,
      days: [savedDay],
    } })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openSightseeing();
    // Saved overrides load verbatim (not reset to master/day defaults).
    expect(screen.getByLabelText('lunch')).toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'lunch meal options' })).getByLabelText(
        'With Transfer',
      ),
    ).toBeChecked();
    expect(screen.getByLabelText('lunch transfer details')).toHaveValue('Kept details');
    expect(
      screen.getByLabelText('Day 1 activity 1 daily transfer Private Transfer'),
    ).toBeChecked();
  });
});
