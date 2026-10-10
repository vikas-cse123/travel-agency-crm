import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hotelStayNights, quotationHotelSchema } from '@interscale/shared';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';

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

/** Builder-version fixture with a single named hotel stay. */
const hotelRow = (overrides: Record<string, unknown> = {}) => ({
  hotelId: null,
  hotelRoomTypeId: null,
  hotelMealPlanId: null,
  city: 'Baku',
  hotelName: 'Shah Palace Hotel',
  category: '4 Star',
  roomType: 'Deluxe Room',
  mealPlan: 'Breakfast',
  rooms: 2,
  nights: 4,
  checkInDate: '2026-09-10T00:00:00.000Z',
  checkOutDate: '2026-09-14T00:00:00.000Z',
  checkInTime: null,
  checkOutTime: null,
  showCheckInTime: false,
  showCheckOutTime: false,
  internalCost: 0,
  sellingPrice: 0,
  selected: true,
  notes: null,
  sequence: 1,
  ...overrides,
});

const builderQuotation = (hotels: unknown[]) => ({
  quotationNumber: 'QT-2026-000001',
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
      hotelDetails: {
        include: true,
        sectionTitle: 'Your Hotels',
        amount: 0,
        description: null,
        images: [],
        pdfImageUrl: null,
      },
      hotels,
      services: [],
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

const openHotelStay = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
};

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

beforeEach(() => {
  auth.permissions = new Set([
    'MASTER_HOTELS_VIEW',
    'QUOTATIONS_VIEW',
    'QUOTATIONS_UPDATE',
  ]);
});

describe('Quotation Builder — optional hotel stay dates', () => {
  it('renders Check-In and Check-Out without required-field indicators', async () => {
    vi.stubGlobal('fetch', stubFetch(builderQuotation([hotelRow()])));
    renderBuilderPage();
    await openHotelStay();

    expect(await screen.findByLabelText('Hotel check-in')).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel check-out')).toBeInTheDocument();
    // Neither Stay Dates label carries a required-field indicator.
    expect(screen.getByLabelText('Hotel check-in').closest('label')?.textContent).not.toContain(
      '*',
    );
    expect(screen.getByLabelText('Hotel check-out').closest('label')?.textContent).not.toContain(
      '*',
    );
  });

  it('saves a hotel option with both dates blank (nights stays null)', async () => {
    const fetchMock = stubFetch(
      builderQuotation([hotelRow({ checkInDate: null, checkOutDate: null, nights: null })]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openHotelStay();

    expect(await screen.findByLabelText('Hotel check-in')).toHaveValue('');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
    // Neutral placeholder instead of an invalid date, NaN or an invented duration.
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');

    await clickSave();
    const body = await getPatchBody(fetchMock);
    expect(body.hotels[0]).toMatchObject({
      hotelName: 'Shah Palace Hotel',
      checkInDate: null,
      checkOutDate: null,
      nights: null,
    });
    // No required-field validation error blocks the save.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves an option with only Check-in populated', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        hotelRow({ checkInDate: '2026-09-10T00:00:00.000Z', checkOutDate: null, nights: null }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openHotelStay();

    expect(await screen.findByLabelText('Hotel check-in')).toHaveValue('2026-09-10');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');

    await clickSave();
    const body = await getPatchBody(fetchMock);
    expect(body.hotels[0].checkInDate).not.toBeNull();
    expect(body.hotels[0].checkOutDate).toBeNull();
    expect(body.hotels[0].nights).toBeNull();
  });

  it('saves an option with only Check-out populated', async () => {
    const fetchMock = stubFetch(
      builderQuotation([
        hotelRow({ checkInDate: null, checkOutDate: '2026-09-14T00:00:00.000Z', nights: null }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openHotelStay();

    expect(await screen.findByLabelText('Hotel check-in')).toHaveValue('');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('2026-09-14');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');

    await clickSave();
    const body = await getPatchBody(fetchMock);
    expect(body.hotels[0].checkInDate).toBeNull();
    expect(body.hotels[0].checkOutDate).not.toBeNull();
    expect(body.hotels[0].nights).toBeNull();
  });

  it('keeps calculating Nights when both dates are provided', async () => {
    const fetchMock = stubFetch(builderQuotation([hotelRow()]));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openHotelStay();

    // 10 Sep → 14 Sep = 4 nights (exclusive convention, unchanged).
    expect(await screen.findByLabelText('Hotel nights')).toHaveValue('4');

    await clickSave();
    const body = await getPatchBody(fetchMock);
    expect(body.hotels[0].nights).toBe(4);
  });

  it('recalculates Nights when the second date is entered after a blank', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(builderQuotation([hotelRow({ checkInDate: null, checkOutDate: null, nights: null })])),
    );
    renderBuilderPage();
    await openHotelStay();

    expect(await screen.findByLabelText('Hotel nights')).toHaveValue('—');

    fireEvent.change(screen.getByLabelText('Hotel check-in'), {
      target: { value: '2026-09-10' },
    });
    // One date alone still shows the placeholder.
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');

    fireEvent.change(screen.getByLabelText('Hotel check-out'), {
      target: { value: '2026-09-13' },
    });
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('3');

    // Clearing a date drops back to the placeholder without keeping a stale count.
    fireEvent.change(screen.getByLabelText('Hotel check-out'), { target: { value: '' } });
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');
  });
});

describe('quotationHotelSchema — hotel stay date rules', () => {
  const base = {
    city: 'Baku',
    hotelName: 'Shah Palace Hotel',
    rooms: 2,
    nights: 4,
    checkInDate: new Date('2026-09-10'),
    checkOutDate: new Date('2026-09-14'),
    selected: true,
    sequence: 1,
  };

  it('accepts both dates blank, either date alone, or both together', () => {
    expect(
      quotationHotelSchema.safeParse({ ...base, checkInDate: null, checkOutDate: null, nights: null })
        .success,
    ).toBe(true);
    expect(
      quotationHotelSchema.safeParse({ ...base, checkInDate: new Date('2026-09-10'), checkOutDate: null, nights: null })
        .success,
    ).toBe(true);
    expect(
      quotationHotelSchema.safeParse({ ...base, checkInDate: null, checkOutDate: new Date('2026-09-14'), nights: null })
        .success,
    ).toBe(true);
    expect(quotationHotelSchema.safeParse(base).success).toBe(true);
  });

  it('rejects malformed dates instead of treating them as blank', () => {
    expect(
      quotationHotelSchema.safeParse({ ...base, checkInDate: 'not-a-date' }).success,
    ).toBe(false);
    expect(
      quotationHotelSchema.safeParse({ ...base, checkOutDate: '2026-13-45' }).success,
    ).toBe(false);
  });

  it('keeps the existing check-out-on-or-after-check-in rule', () => {
    const parsed = quotationHotelSchema.safeParse({
      ...base,
      checkInDate: new Date('2026-09-14'),
      checkOutDate: new Date('2026-09-10'),
    });
    expect(parsed.success).toBe(false);
  });

  it('computes calendar nights only when both dates are present and valid', () => {
    expect(hotelStayNights(new Date('2026-09-10'), new Date('2026-09-14'))).toBe(4);
    expect(hotelStayNights(null, new Date('2026-09-14'))).toBeNull();
    expect(hotelStayNights(new Date('2026-09-10'), null)).toBeNull();
    expect(hotelStayNights(null, null)).toBeNull();
    expect(hotelStayNights('garbage', new Date('2026-09-14'))).toBeNull();
  });
});
