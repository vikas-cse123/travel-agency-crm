import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { PublicQuotationPage } from './PublicQuotationPage';
import { STANDARD_CRUISE_CABINS } from './cruiseStandardOptions';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 },
});

const cruiseLine = (overrides: Record<string, unknown> = {}) => ({
  cruiseRoomTypeId: null,
  roomType: 'Interior',
  rooms: 1,
  roomRate: 1000,
  sellingPrice: 1000,
  internalCost: null,
  notes: null,
  ...overrides,
});

const CRUISE_ID = 'aaaaaaa5-1111-4111-8111-111111111111';
const ROOM_TYPE_INTERIOR_ID = 'aaaaaaa6-1111-4111-8111-111111111111';
const ROOM_TYPE_OCEANVIEW_ID = 'aaaaaaa7-1111-4111-8111-111111111111';

/** API-shaped cruise service row inside a builder version fixture. */
const cruiseServiceRow = (overrides: Record<string, unknown> = {}) => ({
  serviceType: 'CRUISE',
  cruiseId: CRUISE_ID,
  cruiseRoomTypeId: ROOM_TYPE_INTERIOR_ID,
  name: 'Genting Dream',
  description: null,
  dayNumber: null,
  city: 'Interior',
  quantity: 1,
  unitCost: 0,
  unitSellingPrice: 6000,
  taxCategory: 'Cruise Details',
  notes: null,
  cruiseNights: 3,
  cruiseRoomLines: [
    cruiseLine({ cruiseRoomTypeId: ROOM_TYPE_INTERIOR_ID, roomType: 'Interior', rooms: 2, roomRate: 1000, sellingPrice: 1000 }),
    cruiseLine({ cruiseRoomTypeId: ROOM_TYPE_OCEANVIEW_ID, roomType: 'Oceanview', rooms: 1, roomRate: 2000, sellingPrice: 2000 }),
  ],
  images: [],
  imageSnapshotPresent: false,
  pdfImageUrl: null,
  sequence: 1,
  ...overrides,
});

const builderQuotation = (services: unknown[]) => ({
  quotationNumber: 'QT-2026-000001',
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Singapore cruise proposal',
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
    },
  ],
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

const openCruiseTab = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
  // Every cruise card starts collapsed; expand the first so its fields show.
  await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));
};

/** Cruise card titles in DOM order (header headings inside cruise articles). */
const cruiseCardTitles = () =>
  screen
    .getAllByRole('article')
    .filter(
      (card) =>
        within(card).queryAllByRole('button', { name: /Move cruise stay \d+ (up|down)/ }).length > 0,
    )
    .map((card) => within(card).getByRole('heading', { level: 4 }).textContent);

const removeRoomButtons = () =>
  screen.queryAllByRole('button', { name: /Remove room \d+/ });

/** The builder renders Save in the top bar and the bottom action bar — use the bottom one. */
const clickSave = async () => {
  const buttons = await screen.findAllByRole('button', { name: 'Save quotation' });
  await userEvent.click(buttons[buttons.length - 1]!);
};

const getPatchBody = async (fetchMock: ReturnType<typeof stubFetch>) => {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
  );
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
  return JSON.parse(String(patch![1]!.body));
};

const cruiseOf = (body: { services: Array<Record<string, unknown>> }) =>
  body.services.find((service) => service.serviceType === 'CRUISE') as unknown as {
    name: string;
    cruiseId: string;
    cruiseNights: number | null;
    cruiseRoomLines: Array<{ roomType: string | null; rooms: number; roomRate: number | null }>;
    cruiseRoomTypeId: string | null;
    city: string | null;
    quantity: number;
    sellingPrice: number;
  };

const nightsValue = () =>
  (screen.getByLabelText('Cruise nights') as HTMLInputElement).value;

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
});

describe('Quotation Builder — cruise room removal', () => {
  it('removing a room immediately removes its section and keeps the other room values', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await openCruiseTab();

    expect(removeRoomButtons()).toHaveLength(2);
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Interior');
    expect(screen.getByLabelText('Room 2 type master')).toHaveValue('Oceanview');

    // Remove the FIRST room only.
    await userEvent.click(screen.getByRole('button', { name: 'Remove room 1' }));

    await waitFor(() => expect(removeRoomButtons()).toHaveLength(1));
    // The survivor re-indexes to Room 1 with its own values intact.
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Oceanview');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(1);
    expect(screen.queryByRole('button', { name: 'Remove room 2' })).not.toBeInTheDocument();
  });

  it('removing the only room leaves zero rooms and does not recreate ROOM 1', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        builderQuotation([
          cruiseServiceRow({
            cruiseRoomLines: [cruiseLine({ roomType: 'Interior', rooms: 1 })],
          }),
        ]),
      ),
    );
    renderBuilderPage();
    await openCruiseTab();

    expect(removeRoomButtons()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove room 1' }));

    await waitFor(() => expect(removeRoomButtons()).toHaveLength(0));
    expect(screen.queryByLabelText('Room 1 type master')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Room 1 number of rooms')).not.toBeInTheDocument();
    // The stay itself remains (header shows its name), ready for Add Room.
    expect(screen.getByRole('heading', { level: 4, name: 'Genting Dream' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument();
  });

  it('saving after removing all rooms submits an empty list with cleared type scalars', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        cruiseServiceRow({
          cruiseRoomLines: [cruiseLine({ cruiseRoomTypeId: ROOM_TYPE_INTERIOR_ID, roomType: 'Interior' })],
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    await userEvent.click(screen.getByRole('button', { name: 'Remove room 1' }));
    await waitFor(() => expect(removeRoomButtons()).toHaveLength(0));

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseRoomLines).toEqual([]);
    // Stale scalars are cleared so reload cannot resurrect the room.
    expect(cruise.cruiseRoomTypeId).toBeNull();
    expect(cruise.city).toBeNull();
    expect(cruise.sellingPrice).toBe(0);
    // The stay itself is preserved.
    expect(cruise.name).toBe('Genting Dream');
    expect(cruise.cruiseId).toBe(CRUISE_ID);
    expect(cruise.cruiseNights).toBe(3);
  });

  it('reopening a saved empty room list stays roomless', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        builderQuotation([
          cruiseServiceRow({
            cruiseRoomTypeId: null,
            city: null,
            quantity: 1,
            unitSellingPrice: 0,
            cruiseRoomLines: [],
          }),
        ]),
      ),
    );
    renderBuilderPage();
    await openCruiseTab();

    expect(removeRoomButtons()).toHaveLength(0);
    expect(screen.queryByLabelText(/type master/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument();
  });

  it('adding a room after removing all rooms works normally', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(builderQuotation([cruiseServiceRow({ cruiseRoomLines: [] })])),
    );
    renderBuilderPage();
    await openCruiseTab();
    expect(removeRoomButtons()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));

    expect(await screen.findByRole('button', { name: 'Remove room 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 type master')).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(1);
  });

  it('keeps hydrating one room for legacy scalar-only cruises', async () => {
    const { cruiseRoomLines: _dropped, ...legacyRow } = cruiseServiceRow({
      cruiseRoomTypeId: ROOM_TYPE_INTERIOR_ID,
      city: 'Interior',
      quantity: 2,
      unitSellingPrice: 1000,
    });
    void _dropped;
    vi.stubGlobal('fetch', stubFetch(builderQuotation([legacyRow])));
    renderBuilderPage();
    await openCruiseTab();

    // Pre-migration quotations keep rendering their single room from scalars.
    expect(await screen.findByRole('button', { name: 'Remove room 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Interior');
  });

  it('leaves other cruise fields and pricing configuration unaffected by room removal', async () => {
    const fetchMock = stubFetch(builderQuotation([cruiseServiceRow()]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    // Sanity: nights and section chrome are present before removal.
    expect(screen.getByLabelText('Cruise nights')).toHaveValue(3);
    expect(screen.getByLabelText('Cruise section title')).toHaveValue('Cruise Details');

    await userEvent.click(screen.getByRole('button', { name: 'Remove room 2' }));
    await waitFor(() => expect(removeRoomButtons()).toHaveLength(1));

    expect(screen.getByLabelText('Cruise nights')).toHaveValue(3);
    expect(screen.getByRole('heading', { level: 4, name: 'Genting Dream' })).toBeInTheDocument();

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    // Survivor repriced: 2 × 1000 × 3 nights.
    expect(cruise.cruiseRoomLines).toHaveLength(1);
    expect(cruise.cruiseRoomLines[0]).toMatchObject({ roomType: 'Interior', rooms: 2 });
    expect(cruise.sellingPrice).toBe(6000);
    expect(cruise.quantity).toBe(1);
    expect(cruise.cruiseNights).toBe(3);
    expect(cruise.name).toBe('Genting Dream');
  });

  it('uses stable field-array keys so removal cannot reshuffle room values', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await openCruiseTab();

    const firstSection = screen.getByLabelText('Room 1 type master').closest('div.rounded-lg');
    const secondSection = screen.getByLabelText('Room 2 type master').closest('div.rounded-lg');
    expect(firstSection).not.toBe(secondSection);

    // Remove the second room: the first section keeps its own inputs.
    const removeSecond = within(secondSection as HTMLElement).getByRole('button', {
      name: 'Remove room 2',
    });
    await userEvent.click(removeSecond);

    await waitFor(() => expect(removeRoomButtons()).toHaveLength(1));
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Interior');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
  });
});

describe('Quotation Builder — cruise rooms appear only via Add Room', () => {
  it('a newly added cruise stay shows no room section at all', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));

    // No room rows, no room inputs — only the explicit Add control.
    expect(removeRoomButtons()).toHaveLength(0);
    expect(screen.queryByText(/Room 1/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Room 1 type master')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Room 1 number of rooms')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument();
  });

  it('Add Room creates exactly one room row', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));

    expect(await screen.findByRole('button', { name: 'Remove room 1' })).toBeInTheDocument();
    expect(removeRoomButtons()).toHaveLength(1);
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(1);
    expect(screen.queryByRole('button', { name: 'Remove room 2' })).not.toBeInTheDocument();
  });

  it('selecting a cruise never auto-creates a room', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));
    expect(removeRoomButtons()).toHaveLength(0);

    // Opening the tab chrome and switching tabs must not create rooms either.
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));
    expect(removeRoomButtons()).toHaveLength(0);
    expect(screen.queryByLabelText('Room 1 type master')).not.toBeInTheDocument();
  });

  it('a key-less blank row (template default) stays roomless', async () => {
    const blankRow = {
      serviceType: 'CRUISE',
      cruiseId: CRUISE_ID,
      cruiseRoomTypeId: null,
      name: 'Genting Dream',
      description: null,
      dayNumber: null,
      city: null,
      quantity: 1,
      unitCost: 0,
      unitSellingPrice: 0,
      taxCategory: 'Cruise Details',
      notes: null,
      cruiseNights: null,
      images: [],
      imageSnapshotPresent: false,
      pdfImageUrl: null,
      sequence: 1,
    };
    vi.stubGlobal('fetch', stubFetch(builderQuotation([blankRow])));
    renderBuilderPage();
    await openCruiseTab();

    expect(removeRoomButtons()).toHaveLength(0);
    expect(screen.queryByLabelText('Room 1 type master')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument();
  });

  it('adding a room to a named stay then saving submits exactly one room', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        cruiseServiceRow({
          cruiseRoomLines: [],
          cruiseRoomTypeId: null,
          city: null,
          quantity: 1,
          unitSellingPrice: 0,
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();
    expect(removeRoomButtons()).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    expect(await screen.findByRole('button', { name: 'Remove room 1' })).toBeInTheDocument();
    expect(removeRoomButtons()).toHaveLength(1);

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    // The untouched default row is dropped on save; the stay itself persists.
    expect(cruise.cruiseRoomLines).toEqual([]);
    expect(cruise.name).toBe('Genting Dream');
  });
});

describe('Quotation Builder — optional cruise nights', () => {
  it('starts a newly added cruise stay with an empty Number of Nights field', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    expect(screen.queryByText('Cruise Stay')).not.toBeInTheDocument();
    // Enabling Cruise auto-creates the first stay.
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));

    await userEvent.click(await screen.findByRole('button', { name: 'Expand cruise stay 1' }));
    expect(nightsValue()).toBe('');
    // The field is optional: no required marker on its label.
    expect(screen.getByLabelText('Cruise nights').closest('label')?.textContent).not.toContain(
      '*',
    );
  });

  it('saves cleared nights as null and keeps them empty on reopen', async () => {
    const fetchMock = stubFetch(builderQuotation([cruiseServiceRow({ cruiseNights: 3 })]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    expect(screen.getByLabelText('Cruise nights')).toHaveValue(3);
    await userEvent.clear(screen.getByLabelText('Cruise nights'));
    expect(nightsValue()).toBe('');

    await clickSave();
    expect(cruiseOf(await getPatchBody(fetchMock)).cruiseNights).toBeNull();
  });

  it('reopening a null-nights cruise keeps the field empty', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(builderQuotation([cruiseServiceRow({ cruiseNights: null })])),
    );
    renderBuilderPage();
    await openCruiseTab();

    await screen.findByLabelText('Cruise nights');
    expect(nightsValue()).toBe('');
  });

  it('keeps an entered valid nights value through save and reopen', async () => {
    const fetchMock = stubFetch(builderQuotation([cruiseServiceRow({ cruiseNights: null })]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    await userEvent.type(screen.getByLabelText('Cruise nights'), '5');
    expect(screen.getByLabelText('Cruise nights')).toHaveValue(5);

    await clickSave();
    expect(cruiseOf(await getPatchBody(fetchMock)).cruiseNights).toBe(5);
  });

  it('saving with empty nights still prices rooms without NaN or blocking errors', async () => {
    const fetchMock = stubFetch(builderQuotation([cruiseServiceRow({ cruiseNights: null })]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseNights).toBeNull();
    // Rooms survive; total falls back to rate × rooms without a multiplier.
    expect(cruise.cruiseRoomLines).toHaveLength(2);
    expect(cruise.sellingPrice).toBe(4000);
    expect(screen.queryByText('Please fix the following before saving:')).not.toBeInTheDocument();
  });
});

describe('Quotation Builder — cruise card header, collapse and ordering', () => {
  it('opens the Cruise tab with every card collapsed by default', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    const expand = await screen.findByRole('button', { name: 'Expand cruise stay 1' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    // Body is hidden until expanded, but the header keeps the cruise name.
    expect(screen.queryByLabelText('Cruise nights')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Genting Dream' })).toBeInTheDocument();
  });

  it('shows the entered cruise name in the header and falls back to Cruise Stay', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        builderQuotation([
          cruiseServiceRow({ name: 'Genting Dream', sequence: 1 }),
          cruiseServiceRow({ name: '   ', sequence: 2 }),
        ]),
      ),
    );
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    await waitFor(() => expect(cruiseCardTitles()).toEqual(['Genting Dream', 'Cruise Stay']));
  });

  it('expanding and collapsing never changes the cruise values', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    // Collapsed by default.
    await screen.findByRole('button', { name: 'Expand cruise stay 1' });
    expect(screen.queryByLabelText('Cruise nights')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Expand cruise stay 1' }));
    expect(await screen.findByLabelText('Cruise nights')).toHaveValue(3);
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Interior');
    expect(screen.getByLabelText('Room 2 type master')).toHaveValue('Oceanview');

    // Collapse: body hidden, header/title/delete remain.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse cruise stay 1' }));
    await screen.findByRole('button', { name: 'Expand cruise stay 1' });
    expect(screen.queryByLabelText('Cruise nights')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Genting Dream' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove cruise stay 1' })).toBeInTheDocument();

    // Re-expand: values untouched.
    await userEvent.click(screen.getByRole('button', { name: 'Expand cruise stay 1' }));
    expect(await screen.findByLabelText('Cruise nights')).toHaveValue(3);
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Interior');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
    expect(screen.getByLabelText('Room 2 type master')).toHaveValue('Oceanview');
  });

  it('saving while a cruise card is collapsed still submits its data', async () => {
    const fetchMock = stubFetch(builderQuotation([cruiseServiceRow()]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
    await screen.findByRole('button', { name: 'Expand cruise stay 1' });
    expect(screen.queryByLabelText('Cruise nights')).not.toBeInTheDocument();

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseRoomLines).toHaveLength(2);
    expect(cruise.cruiseNights).toBe(3);
    expect(cruise.name).toBe('Genting Dream');
  });

  it('keeps only the delete icon with an accessible label', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    const remove = await screen.findByRole('button', { name: 'Remove cruise stay 1' });
    expect(remove).toHaveAttribute('title', 'Remove cruise stay 1');
    // Icon-only: no visible "Remove" text remains in the header.
    expect(within(remove).queryByText(/Remove/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('reorders cruises with the Up/Down controls and disables the ends', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        builderQuotation([
          cruiseServiceRow({ name: 'Cruise A', sequence: 1 }),
          cruiseServiceRow({ name: 'Cruise B', sequence: 2 }),
        ]),
      ),
    );
    renderBuilderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));

    await waitFor(() => expect(cruiseCardTitles()).toEqual(['Cruise A', 'Cruise B']));

    // Ends are disabled, middles enabled.
    expect(screen.getByRole('button', { name: 'Move cruise stay 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move cruise stay 1 down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move cruise stay 2 up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move cruise stay 2 down' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Move cruise stay 1 down' }));
    await waitFor(() => expect(cruiseCardTitles()).toEqual(['Cruise B', 'Cruise A']));

    // Move it back up to restore the original order (data preserved).
    await userEvent.click(screen.getByRole('button', { name: 'Move cruise stay 2 up' }));
    await waitFor(() => expect(cruiseCardTitles()).toEqual(['Cruise A', 'Cruise B']));
  });
});

const CRUISE_MASTER_DETAIL = {
  id: CRUISE_ID,
  name: 'Genting Dream',
  roomTypes: [
    { id: ROOM_TYPE_INTERIOR_ID, name: 'Interior', price: 1000, status: 'ACTIVE' },
    { id: ROOM_TYPE_OCEANVIEW_ID, name: 'Oceanview', price: 2000, status: 'ACTIVE' },
  ],
};

/** Serve a Cruise Master with cabins plus the quotation; other masters stay empty. */
function stubFetchWithMaster(quotation: unknown, master: unknown = CRUISE_MASTER_DETAIL) {
  return vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    void _options;
    const url = String(input);
    if (url.includes(`/masters/cruises/${CRUISE_ID}`)) return response(master);
    if (url.includes('/masters/cruises')) return response(page([master]));
    if (url.includes('/masters/')) return response(page([]));
    if (url.includes('/api/users') || url.includes('/users?')) return response(page([]));
    if (url.includes('/settings')) return response({});
    return response(quotation);
  });
}

/** Values offered by the Room 1 type datalist. */
const roomTypeOptionValues = () => {
  const input = screen.getByLabelText('Room 1 type master') as HTMLInputElement;
  const list = document.getElementById(input.getAttribute('list') as string);
  return Array.from(list?.querySelectorAll('option') ?? []).map((option) =>
    option.getAttribute('value'),
  );
};

describe('Quotation Builder — cruise standard cabin suggestions', () => {
  it('offers all eight standard cabins alongside the master cabins', async () => {
    vi.stubGlobal('fetch', stubFetchWithMaster(builderQuotation([cruiseServiceRow()])));
    renderBuilderPage();
    await openCruiseTab();

    const normalized = roomTypeOptionValues().map((value) => (value ?? '').trim().toLowerCase());
    // Master cabins stay available...
    expect(normalized).toContain('interior');
    expect(normalized).toContain('oceanview');
    // ...and every standard cabin is offered even though the master lacks them.
    for (const cabin of STANDARD_CRUISE_CABINS) {
      expect(normalized).toContain(cabin.toLowerCase());
    }
  });

  it('keeps master cabins first, omits duplicates, and preserves custom master cabins', async () => {
    const master = {
      id: CRUISE_ID,
      name: 'Genting Dream',
      roomTypes: [
        { id: 'cabin-balcony', name: '  balcony cabin ', price: 3000, status: 'ACTIVE' },
        { id: 'cabin-verandah', name: 'Owner Suite with Verandah', price: 9000, status: 'ACTIVE' },
      ],
    };
    vi.stubGlobal('fetch', stubFetchWithMaster(builderQuotation([cruiseServiceRow()]), master));
    renderBuilderPage();
    await openCruiseTab();

    const values = roomTypeOptionValues();
    // Master options come first, unchanged.
    expect(values[0]).toBe('  balcony cabin ');
    expect(values[1]).toBe('Owner Suite with Verandah');
    const normalized = values.map((value) => (value ?? '').trim().toLowerCase());
    // The standard "Balcony Cabin" is matched case-insensitively and trimmed, so
    // it is not duplicated...
    expect(normalized.filter((value) => value === 'balcony cabin')).toHaveLength(1);
    // ...and a custom master cabin is never dropped.
    expect(values).toContain('Owner Suite with Verandah');
    // The remaining standards are appended.
    for (const cabin of STANDARD_CRUISE_CABINS) {
      expect(normalized).toContain(cabin.toLowerCase());
    }
  });

  it('saves a standard cabin selection as free text without a fabricated master id', async () => {
    const fetchMock = stubFetchWithMaster(
      builderQuotation([
        cruiseServiceRow({ cruiseRoomLines: [cruiseLine({ cruiseRoomTypeId: null, roomType: null })] }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    const input = screen.getByLabelText('Room 1 type master');
    await userEvent.type(input, 'Balcony Cabin');
    expect(input).toHaveValue('Balcony Cabin');

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseRoomLines[0]).toMatchObject({
      roomType: 'Balcony Cabin',
      cruiseRoomTypeId: null,
    });
  });

  it('saves an arbitrary custom cabin name as free text without a fabricated master id', async () => {
    const fetchMock = stubFetchWithMaster(
      builderQuotation([
        cruiseServiceRow({ cruiseRoomLines: [cruiseLine({ cruiseRoomTypeId: null, roomType: null })] }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    const input = screen.getByLabelText('Room 1 type master');
    await userEvent.type(input, 'Owner Suite with Verandah');
    expect(input).toHaveValue('Owner Suite with Verandah');

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseRoomLines[0]).toMatchObject({
      roomType: 'Owner Suite with Verandah',
      cruiseRoomTypeId: null,
    });
  });

  it('reopening keeps an arbitrary custom cabin name intact', async () => {
    const fetchMock = stubFetchWithMaster(
      builderQuotation([
        cruiseServiceRow({
          city: null,
          cruiseRoomTypeId: null,
          cruiseRoomLines: [
            cruiseLine({ cruiseRoomTypeId: null, roomType: 'Owner Suite with Verandah' }),
          ],
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openCruiseTab();

    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Owner Suite with Verandah');

    await clickSave();
    const cruise = cruiseOf(await getPatchBody(fetchMock));
    expect(cruise.cruiseRoomLines[0]).toMatchObject({
      roomType: 'Owner Suite with Verandah',
      cruiseRoomTypeId: null,
    });
  });
});

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
    title: 'Cruise Trip',
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
  cruisePresentations: {},
  downloadUrl: null,
});

const publicCruiseService = (overrides: Record<string, unknown> = {}) => ({
  id: 's-cruise',
  serviceType: 'CRUISE',
  name: 'Genting Dream',
  description: null,
  dayNumber: null,
  city: null,
  quantity: '1',
  unitSellingPrice: '0',
  totalSellingPrice: '0',
  taxCategory: 'Cruise Details',
  notes: null,
  cruiseNights: 3,
  cruiseRoomLines: [],
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

describe('Public weblink — cruise rooms', () => {
  it('shows no room badge for an explicitly roomless cruise', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(publicFixture([publicCruiseService({ cruiseNights: 3 })])),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.getByRole('heading', { name: 'Cruise Details' })).toBeInTheDocument();
    expect(screen.queryByText(/Room 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 room/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Room Type:/)).not.toBeInTheDocument();
    // Valid nights still display.
    expect(screen.getByText(/3 Nights/)).toBeInTheDocument();
  });

  it('renders explicitly added rooms after save and reopen', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        publicFixture([
          publicCruiseService({
            cruiseNights: 2,
            cruiseRoomLines: [
              { cruiseRoomTypeId: null, roomType: 'Interior', rooms: 2, roomRate: 1000 },
              { cruiseRoomTypeId: null, roomType: 'Oceanview', rooms: 1, roomRate: 2000 },
            ],
          }),
        ]),
      ),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    // Room configurations render as "<type> · <qty>" with no "ROOM N" prefix.
    expect(screen.getByText('Interior · 2 rooms')).toBeInTheDocument();
    expect(screen.getByText('Oceanview · 1 room')).toBeInTheDocument();
    expect(screen.queryByText(/Room 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Room 2/)).not.toBeInTheDocument();
  });

  it('renders a safe label when a room line omits both type and quantity', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        publicFixture([
          publicCruiseService({
            cruiseNights: 2,
            cruiseRoomLines: [
              { cruiseRoomTypeId: null, roomType: '  ', rooms: null, roomRate: 1000 },
            ],
          }),
        ]),
      ),
    );
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    // Falls back to a single neutral label with no index prefix and no
    // fabricated quantity, so nothing duplicates or reads as a bug.
    expect(screen.getByText('Room')).toBeInTheDocument();
    expect(screen.queryByText(/Room 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/room(s)?\b/)).not.toBeInTheDocument();
  });

  it('shows scalar fallbacks without a badge for key-less legacy cruises', async () => {
    const { cruiseRoomLines: _dropped, cruiseNights: _nights, ...legacy } = publicCruiseService({
      city: 'Balcony Snapshot',
      notes: '2 nights',
    });
    void _dropped;
    void _nights;
    vi.stubGlobal('fetch', stubFetch(publicFixture([legacy])));
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.queryByText(/Room 1/)).not.toBeInTheDocument();
    expect(screen.getByText('Balcony Snapshot')).toBeInTheDocument();
    expect(screen.getByText('2 nights')).toBeInTheDocument();
  });
});

describe('Public weblink — cruise nights', () => {
  const renderWithNights = async (cruiseNights: unknown, omitKey = false) => {
    const base = publicCruiseService({
      cruiseRoomLines: [
        { cruiseRoomTypeId: null, roomType: 'Interior', rooms: 1, roomRate: 1000 },
      ],
    }) as Record<string, unknown>;
    if (omitKey) delete base.cruiseNights;
    else base.cruiseNights = cruiseNights;
    vi.stubGlobal('fetch', stubFetch(publicFixture([base])));
    renderPublicPage();
    await screen.findByText('Custom Package for Mira Shah');
  };

  it.each([null, 0, -2])('omits the cruise duration for nights=%s', async (cruiseNights) => {
    await renderWithNights(cruiseNights);
    expect(screen.queryByText(/Nights?\s*·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Duration:/)).not.toBeInTheDocument();
  });

  it('omits the cruise duration when nights are omitted', async () => {
    await renderWithNights(undefined, true);
    expect(screen.queryByText(/Nights?\s*·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Duration:/)).not.toBeInTheDocument();
  });

  it('keeps the existing convention for valid nights', async () => {
    await renderWithNights(1);
    expect(screen.getByText('1 Night · 2 Days')).toBeInTheDocument();
  });
});
