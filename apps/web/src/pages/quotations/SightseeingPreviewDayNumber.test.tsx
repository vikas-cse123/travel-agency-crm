import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { buildFullPreviewData } from './FullQuotationPreview';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const sightDay = (n: number, title: string, activityName: string) => ({
  dayNumber: n,
  title,
  city: 'Singapore',
  date: null,
  meals: { breakfast: false, lunch: false, dinner: false },
  mealMode: 'NO_TRANSFER',
  mealPreferences: {},
  dailyTransfer: 'NO_TRANSFER',
  activities: [
    {
      sightseeingId: null,
      name: activityName,
      description: `${activityName} details.`,
      startTime: null,
      showTime: false,
      duration: null,
      city: 'Singapore',
      imageUrl: null,
      images: [],
      imageSnapshotPresent: false,
      pdfImageUrl: null,
      dailyTransfer: null,
      pricingOptions: [],
      sequence: 1,
      displayPricing: [],
      displayPricingHeading: 'PRICING',
    },
  ],
});

const baseVersion = (days: unknown[]) => ({
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
    days,
  },
});

const detail = (days: unknown[]) => ({
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
  versions: [baseVersion(days)],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
  booking: null,
});

const settings = {
  profile: { name: 'Alpha Travel', email: 'h@a.test', phone: '1', website: null, address: null, googleMapsUrl: null, operatingSince: null, totalReviews: null, tripsSold: null },
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

const renderBuilder = () =>
  renderWithProviders(
    <Routes>
      <Route path="/quotations/:quotationId/versions/:versionId/edit" element={<QuotationBuilderPage />} />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

function frameDoc(): Document {
  const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('preview frame has no document');
  return doc;
}

async function pinnedReady(): Promise<Document> {
  const doc = frameDoc();
  await within(doc.body as HTMLElement).findByText('Custom Package for Aarav Mehta');
  return doc;
}

const previewHeadings = (doc: Document) =>
  Array.from(doc.querySelectorAll('h3')).map((el) => (el.textContent ?? '').trim());

describe('Live Weblink Preview day numbering', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('renumbers stale saved dayNumbers from current position without mutating inputs', () => {
    const quotation = detail([]) as never;
    const savedVersion = (quotation as { versions: never[] }).versions[0]!;
    // Simulate: 3 saved days, then a new day inserted after Day 1 carrying a
    // stale duplicate dayNumber (exactly what the builder form holds pre-save).
    const form = {
      ...(savedVersion as Record<string, unknown>),
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Your Itinerary',
        amount: 0,
        description: null,
        days: [
          sightDay(1, 'Alpha', 'Alpha'),
          { ...sightDay(2, 'Inserted', 'Inserted'), dayNumber: 2 },
          { ...sightDay(2, 'Bravo', 'Bravo'), dayNumber: 2 },
          { ...sightDay(3, 'Universal studios', 'Universal studios'), dayNumber: 3 },
        ],
      },
    } as never;
    const before = JSON.stringify(form);
    const data = buildFullPreviewData({
      quotation,
      savedVersion,
      form,
      settings: settings as never,
      flightPreviewUrls: {},
    });
    expect(JSON.stringify(form)).toBe(before);
    const days = (data.version as unknown as { sightseeingDetails: { days: Array<{ dayNumber: number; title: string; activities: Array<{ name: string }> }> } }).sightseeingDetails.days;
    expect(days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4]);
    // Titles, activities and other data preserved — only numbering derived.
    expect(days.map((d) => d.title)).toEqual(['Alpha', 'Inserted', 'Bravo', 'Universal studios']);
    expect(days[3]!.activities[0]!.name).toBe('Universal studios');
  });

  it('insert after Day 1 shows Day 1..Day 4 in order; move/remove recalculates immediately', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail([sightDay(1, 'Alpha', 'Alpha'), sightDay(2, 'Bravo', 'Bravo'), sightDay(3, 'Universal studios', 'Universal studios')])),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    let doc = await pinnedReady();
    // Baseline sanity: three days numbered sequentially.
    expect(await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 1 | Alpha' })).toBeInTheDocument();
    expect(await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 2 | Bravo' })).toBeInTheDocument();

    // Select Day 1, insert a new day after it.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Day After' }));

    doc = await pinnedReady();
    // The previously-Day-2 activity must now read DAY 3 (stale-number regression).
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 3 | Bravo' }),
    ).toBeInTheDocument();
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 4 | Universal studios' }),
    ).toBeInTheDocument();
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 1 | Alpha' }),
    ).toBeInTheDocument();
    // No stale duplicate: Bravo never still reads DAY 2.
    expect(
      within(doc.body as HTMLElement).queryByRole('heading', { name: 'DAY 2 | Bravo' }),
    ).not.toBeInTheDocument();
    // Order check across all day headings.
    const headings = previewHeadings(doc).filter((h) => /^(DAY|Day) \d/.test(h));
    const idx = (name: string) => headings.findIndex((h) => h === name);
    expect(idx('DAY 1 | Alpha')).toBeGreaterThanOrEqual(0);
    expect(idx('DAY 3 | Bravo')).toBeGreaterThan(idx('DAY 1 | Alpha'));
    expect(idx('DAY 4 | Universal studios')).toBeGreaterThan(idx('DAY 3 | Bravo'));

    // Move the inserted day down one slot: Bravo should fall back to DAY 2 immediately.
    await userEvent.click(screen.getByRole('button', { name: 'Move Day 2 down' }));
    doc = await pinnedReady();
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 2 | Bravo' }),
    ).toBeInTheDocument();

    // Remove the inserted day again: Universal studios returns to DAY 3 immediately.
    // After the move the inserted day sits at position 3; select + remove it.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Day' }));
    doc = await pinnedReady();
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'DAY 3 | Universal studios' }),
    ).toBeInTheDocument();
    expect(
      within(doc.body as HTMLElement).queryByRole('heading', { name: 'DAY 4 | Universal studios' }),
    ).not.toBeInTheDocument();
  });
});
