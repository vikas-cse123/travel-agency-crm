import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage, withSynthesizedLines } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const hotelRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'stay-1',
  city: 'Goa',
  hotelName: 'Coastal Bay Resort',
  category: '4 Star',
  roomType: 'Deluxe Room',
  mealPlan: 'Breakfast',
  hotelId: null,
  hotelRoomTypeId: null,
  hotelMealPlanId: null,
  rooms: 1,
  roomsOverride: null,
  nights: 2,
  checkInDate: '2026-09-10T00:00:00.000Z',
  checkOutDate: '2026-09-12T00:00:00.000Z',
  checkInTime: '14:00',
  checkOutTime: '11:00',
  showCheckInTime: true,
  showCheckOutTime: true,
  internalCost: 0,
  sellingPrice: 0,
  selected: true,
  notes: 'Sea view requested',
  sequence: 1,
  images: [
    { url: 'https://cdn.example/hotel-a.jpg', thumbnailUrl: null, alt: 'Coastal Bay Resort image 1' },
    { url: 'https://cdn.example/hotel-b.jpg', thumbnailUrl: null, alt: 'Coastal Bay Resort image 2' },
  ],
  imageSnapshotPresent: true,
  pdfImageUrl: 'https://cdn.example/hotel-a.jpg',
  roomLines: [
    {
      hotelRoomTypeId: null,
      roomType: 'Deluxe Room',
      rooms: 1,
      extraBedQuantity: null,
      extraBedPrice: null,
      childWithoutBedQuantity: null,
      childWithoutBedPrice: null,
      baseRoomPrice: null,
      pricingSource: null,
      sellingPrice: null,
      internalCost: null,
      notes: 'High floor',
    },
  ],
  mealPlanLines: [
    { hotelMealPlanId: null, mealPlan: 'Breakfast', sellingPrice: null, internalCost: null },
  ],
  ...overrides,
});

const version = (overrides: Record<string, unknown> = {}) => ({
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
  hotels: [hotelRow()],
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
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Goa',
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
    services: [{ serviceType: 'HOTEL' }],
    itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
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
    address: 'Goa, India',
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

const openHotelTab = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
};

const expandStay = async (n = 1) => {
  await userEvent.click(screen.getByRole('button', { name: `Expand hotel stay ${n}` }));
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

describe('Hotel quotation builder issues', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('Task 1: hotel Description editor is absent but bookmark + cards remain', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    expect(screen.queryByLabelText('Hotel description')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Description' })).not.toBeInTheDocument();
    // Bookmark + cards unaffected.
    expect(screen.getByLabelText('Hotel Bookmark ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^(Expand|Collapse) hotel stay 1$/ })).toBeInTheDocument();
    await expandStay();
    expect(screen.getByLabelText('Hotel master')).toBeInTheDocument();
  });

  it('Task 2: Hotel Options heading is absent while cards stay functional', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    expect(screen.queryByText('Hotel Options')).not.toBeInTheDocument();
    // Cards: expand, reorder, add/remove all present.
    await expandStay();
    expect(screen.getByLabelText('Hotel check-in')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add hotel after stay 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move hotel stay 1 up' })).toBeInTheDocument();
  });

  it('Task 3: room and meal sections are always visible and preserve values', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    // No accordion toggle remains for either section.
    expect(
      screen.queryByRole('button', { name: /room configuration for hotel stay 1/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /meal plan for hotel stay 1/ }),
    ).not.toBeInTheDocument();
    // The section headings are gone; their controls render immediately.
    expect(screen.queryByText('Room Configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Meal Plan')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room');
    expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast');
    // Editing works with no expand/collapse cycle and the value survives.
    await userEvent.clear(screen.getByLabelText('Room 1 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 1 number of rooms'), '3');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(3);
  });

  it('Task 4: check-in time can be cleared and selected again', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    const time = screen.getByLabelText('Hotel check-in time') as HTMLInputElement;
    expect(time).toHaveValue('14:00');
    await userEvent.click(screen.getByRole('button', { name: 'Clear check-in time' }));
    expect(screen.getByLabelText('Hotel check-in time')).toHaveValue('');
    // Clear control hides when empty; unrelated fields untouched.
    expect(screen.queryByRole('button', { name: 'Clear check-in time' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel check-out time')).toHaveValue('11:00');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('2');
    // A new time can be selected afterwards.
    await userEvent.type(screen.getByLabelText('Hotel check-in time'), '15:30');
    expect(screen.getByLabelText('Hotel check-in time')).toHaveValue('15:30');
    expect(screen.getByRole('button', { name: 'Clear check-in time' })).toBeInTheDocument();
  });

  it('Task 5: Child Without Bed quantity is absent, other guests + totals intact', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.queryByLabelText('Room 1 child without bed quantity')).not.toBeInTheDocument();
    expect(screen.queryByText('Child Without Bed Quantity')).not.toBeInTheDocument();
    // Adults-equivalents stay: room type, room count, extra bed.
    expect(screen.getByLabelText('Room 1 type master')).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 number of rooms')).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 extra bed quantity')).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(1);
  });

  it('Task 6: Room Remark is absent, hotel-level Remark removed (legacy data kept)', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.queryByLabelText('Room 1 remark')).not.toBeInTheDocument();
    expect(screen.queryByText('Room Remark')).not.toBeInTheDocument();
    // Hotel-level Remark field is gone from the UI (label, input, placeholder).
    expect(screen.queryByLabelText('Hotel remark')).not.toBeInTheDocument();
    expect(screen.queryByText('Remark')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g. additional bed, flower arrangement')).not.toBeInTheDocument();
  });

  it('Task 7: multiple hotel images render in live preview and follow unsaved moves', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // Both gallery images render with a 1 / 2 counter.
    expect(within(body).getByText('1 / 2')).toBeInTheDocument();
    const first = within(body).getAllByRole('img')[0] as HTMLImageElement;
    expect(first.getAttribute('src')).toBe('https://cdn.example/hotel-a.jpg');
    // Reorder in the builder (no save): preview follows the new order.
    await openHotelTab();
    await expandStay();
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel-0 image 1 right' }));
    await within(frameDocument().body as HTMLElement).findByText('1 / 2');
    const moved = within(frameDocument().body as HTMLElement).getAllByRole('img')[0] as HTMLImageElement;
    expect(moved.getAttribute('src')).toBe('https://cdn.example/hotel-b.jpg');
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('Task 7: two hotels keep distinct image galleries in the preview', async () => {
    const second = hotelRow({
      id: 'stay-2',
      hotelName: 'Second Stay Hotel',
      sequence: 2,
      images: [{ url: 'https://cdn.example/other.jpg', thumbnailUrl: null, alt: 'Second Stay Hotel image 1' }],
      pdfImageUrl: 'https://cdn.example/other.jpg',
    });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(within(body).getByText('Coastal Bay Resort')).toBeInTheDocument();
    expect(within(body).getByText('Second Stay Hotel')).toBeInTheDocument();
    const srcs = within(body).getAllByRole('img').map((img) => (img as HTMLImageElement).getAttribute('src'));
    // Active images are per-hotel: first stay shows its own first image.
    expect(srcs).toContain('https://cdn.example/hotel-a.jpg');
    expect(srcs).toContain('https://cdn.example/other.jpg');
    // Only the two-image stay has carousel navigation; stepping it reveals
    // the second image of the same stay (never the other stay's image).
    const nextButtons = within(body).getAllByRole('button', { name: 'Next hotel image' });
    expect(nextButtons).toHaveLength(1);
    fireEvent.click(nextButtons[0]!);
    expect(
      (within(body).getAllByRole('img')[0] as HTMLImageElement).getAttribute('src'),
    ).toBe('https://cdn.example/hotel-b.jpg');
  });

  it('Task 8: reorder controls are icon-only with labels and boundaries', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const up = screen.getByRole('button', { name: 'Move hotel stay 1 up' });
    const down = screen.getByRole('button', { name: 'Move hotel stay 2 down' });
    // Icon-only: no visible Up/Down words, but a real icon exists.
    expect(up.textContent?.trim()).toBe('');
    expect(down.textContent?.trim()).toBe('');
    expect(up.querySelector('svg')).not.toBeNull();
    expect(down.querySelector('svg')).not.toBeNull();
    // Boundaries: first up and last down disabled.
    expect(up).toBeDisabled();
    expect(down).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move hotel stay 1 down' })).toBeEnabled();
    // Reorder still works.
    const names = () =>
      screen
        .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
        .map((b) => (b.closest('article') as HTMLElement).querySelector('h4')!.textContent);
    expect(names()).toEqual(['Coastal Bay Resort', 'Second Stay Hotel']);
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 1 down' }));
    expect(names()).toEqual(['Second Stay Hotel', 'Coastal Bay Resort']);
  });

  it('remove control is icon-only with an accessible name and removes the stay', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const remove = screen.getByRole('button', { name: 'Remove hotel stay 1' });
    // Icon-only: no visible Remove text, but a real trash icon,
    // an accessible name, and a matching tooltip.
    expect(remove.textContent?.trim()).toBe('');
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(remove).toHaveAttribute('title', 'Remove hotel stay 1');
    // Clicking removes exactly that stay; the sibling survives
    // (renumbered to stay 1 by render position).
    await userEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Remove hotel stay 2' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay \d+$/ })).toHaveLength(1);
    // Add Hotel After / Up / Down labels and behavior are unchanged.
    expect(screen.getByRole('button', { name: 'Add hotel after stay 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move hotel stay 1 down' })).toBeInTheDocument();
  });

  it('all stay headers group actions on the right, including the first card', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    const third = hotelRow({ id: 'stay-3', hotelName: 'Third Stay Hotel', sequence: 3 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second, third] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const cards = [1, 2, 3].map(
      (n) =>
        screen
          .getByRole('button', { name: new RegExp(`^(Expand|Collapse) hotel stay ${n}$`) })
          .closest('article') as HTMLElement,
    );
    for (const card of cards) {
      const header = card.querySelector('header') as HTMLElement;
      const title = header.children[0] as HTMLElement;
      const actions = header.children[1] as HTMLElement;
      // Title flexes and shrinks first; actions never shrink away.
      expect(title.className).toMatch(/flex-1/);
      expect(title.className).toMatch(/min-w-0/);
      expect(actions.className).toMatch(/shrink-0/);
      // The wrapped action group hugs the right edge on every card —
      // never the far-left start, even on the first card which also
      // carries Add Hotel Before.
      expect(actions.className).toMatch(/ml-auto/);
      expect(actions.className).toMatch(/justify-end/);
      // No fixed widths or offsets anywhere in the header.
      expect(header.className).not.toMatch(/w-\[|w-\d+|ml-\[|mr-\[|left-\[/);
    }
    // First card alone shows Add Hotel Before, and it works.
    expect(screen.getByRole('button', { name: 'Add hotel before stay 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add hotel before stay 2' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel before stay 1' }));
    expect(
      screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay \d+$/ }),
    ).toHaveLength(4);
  });

  it('renders each collapsed header hotel title at half its computed size', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    const unnamed = hotelRow({ id: 'stay-3', hotelName: '', sequence: 3 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second, unnamed] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const titles = screen
      .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
      .map(
        (button) =>
          (button.closest('article') as HTMLElement).querySelector('h4') as HTMLElement,
      );
    expect(titles.map((title) => title.textContent)).toEqual([
      'Coastal Bay Resort',
      'Second Stay Hotel',
      'Hotel Stay',
    ]);
    for (const title of titles) {
      // Exactly 16px on every card-header title.
      expect(title.className).toContain('text-[16px]');
      // Font weight, colour, and truncation are preserved.
      expect(title.className).toContain('font-semibold');
      expect(title.className).toContain('text-slate-800');
      expect(title.className).toContain('truncate');
    }
  });

  it('newly added stays get the same icon-only remove control', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow()] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    const remove = screen.getByRole('button', { name: 'Remove hotel stay 2' });
    expect(remove.textContent?.trim()).toBe('');
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(remove).toHaveAttribute('title', 'Remove hotel stay 2');
  });
});

describe('Hotel quotation builder remaining issues', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('Task 1: newly added hotel starts with no rooms and no allocations', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    // Lead prefill creates one unnamed stay with no room allocation.
    expect(screen.getByRole('button', { name: /^(Expand|Collapse) hotel stay 1$/ })).toBeInTheDocument();
    await expandStay();
    // Total Rooms is empty — never an invented 1.
    expect((screen.getByLabelText('Hotel total rooms') as HTMLInputElement).value).toBe('');
    // Room configuration is always visible and shows no default Room 1 row.
    expect(screen.queryByLabelText('Room 1 type master')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add room' })).toBeInTheDocument();
    // Meal plans get no default row either; the user adds one explicitly.
    expect(screen.queryByLabelText('Meal plan 1 master')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add meal plan' })).toBeInTheDocument();
  });

  it('Task 1: Total Rooms follows explicitly added allocations', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    // A user-added allocation keeps the existing quantity behavior (1 room).
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(1);
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(1);
    await userEvent.clear(screen.getByLabelText('Room 1 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 1 number of rooms'), '3');
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(3);
  });

  it('Task 1: reordering never resets room counts', async () => {
    const line = (rooms: number) => ({
      hotelRoomTypeId: null,
      roomType: 'Deluxe Room',
      rooms,
      extraBedQuantity: null,
      extraBedPrice: null,
      childWithoutBedQuantity: null,
      childWithoutBedPrice: null,
      baseRoomPrice: null,
      pricingSource: null,
      sellingPrice: null,
      internalCost: null,
      notes: null,
    });
    const first = hotelRow({ id: 'stay-1', hotelName: 'Alpha Hotel', rooms: null, roomsOverride: null, roomLines: [line(2)] });
    const second = hotelRow({ id: 'stay-2', hotelName: 'Bravo Hotel', sequence: 2, rooms: null, roomsOverride: null, roomLines: [line(3)] });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [first, second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay(1);
    await expandStay(2);
    expect(screen.getAllByLabelText('Hotel total rooms').map((i) => (i as HTMLInputElement).value)).toEqual(['2', '3']);
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 1 down' }));
    // Same counts, swapped order — nothing reset to a default.
    expect(screen.getAllByLabelText('Hotel total rooms').map((i) => (i as HTMLInputElement).value)).toEqual(['3', '2']);
  });

  it('Task 1: room-less stays save and reload without inventing rooms', async () => {
    const fetchMock = builderFetch(
      detail({
        hotels: [
          hotelRow({
            roomType: null,
            mealPlan: null,
            roomLines: [],
            mealPlanLines: [],
            rooms: null,
            roomsOverride: null,
            notes: 'Legacy remark',
          }),
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect((screen.getByLabelText('Hotel total rooms') as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels).toHaveLength(1);
    expect(body.hotels[0].roomLines).toEqual([]);
    expect(body.hotels[0].rooms ?? null).toBeNull();
    // Legacy remark data survives even though its UI is gone.
    expect(body.hotels[0].notes).toBe('Legacy remark');
  });

  it('Task 1: withSynthesizedLines keeps empty stays empty, legacy stays intact', async () => {
    const empty = withSynthesizedLines({
      roomType: null,
      hotelRoomTypeId: null,
      rooms: null,
      extraBedQuantity: null,
      childWithoutBedQuantity: null,
      roomLines: [],
      mealPlanLines: [],
    } as never);
    expect(empty.roomLines).toEqual([]);
    const legacy = withSynthesizedLines({
      roomType: 'Deluxe Room',
      hotelRoomTypeId: null,
      rooms: 2,
      extraBedQuantity: null,
      childWithoutBedQuantity: null,
      roomLines: [],
      mealPlanLines: [],
    } as never);
    expect(legacy.roomLines).toHaveLength(1);
    expect(legacy.roomLines[0]).toMatchObject({ roomType: 'Deluxe Room', rooms: 2 });
  });

  it('Task 2: hotel-level Remark is gone but legacy notes save through', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.queryByLabelText('Hotel remark')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g. additional bed, flower arrangement')).not.toBeInTheDocument();
    // Saving preserves the stored legacy remark verbatim.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels[0].notes).toBe('Sea view requested');
  });

  it('Tasks 3+4: action order is Before, After, Up, Down, Remove with new labels', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const firstCard = screen
      .getByRole('button', { name: /^(Expand|Collapse) hotel stay 1$/ })
      .closest('article') as HTMLElement;
    // Action-row buttons only (exclude the stay expand toggle itself).
    const actions = (card: HTMLElement) =>
      within(card)
        .getAllByRole('button')
        .filter((b) => !/^(Expand|Collapse) hotel stay/.test(b.getAttribute('aria-label') ?? ''))
        .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim());
    const order = actions(firstCard);
    expect(order).toEqual([
      'Add hotel before stay 1',
      'Add hotel after stay 1',
      'Move hotel stay 1 up',
      'Move hotel stay 1 down',
      'Remove hotel stay 1',
    ]);
    // New visible labels, old Stay wording gone everywhere.
    expect(within(firstCard).getByRole('button', { name: 'Add hotel before stay 1' }).textContent).toContain('Add Hotel Before');
    expect(within(firstCard).getByRole('button', { name: 'Add hotel after stay 1' }).textContent).toContain('Add Hotel After');
    expect(screen.queryByText('Add Stay Before')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Stay After')).not.toBeInTheDocument();
    // Second card has no Before action (existing position rule preserved).
    const secondCard = screen
      .getByRole('button', { name: /^(Expand|Collapse) hotel stay 2$/ })
      .closest('article') as HTMLElement;
    expect(actions(secondCard)).toEqual(['Add hotel after stay 2', 'Move hotel stay 2 up', 'Move hotel stay 2 down', 'Remove hotel stay 2']);
    // Icon-only reorder controls with boundaries intact.
    const up = within(firstCard).getByRole('button', { name: 'Move hotel stay 1 up' });
    expect(up.textContent?.trim()).toBe('');
    expect(up.querySelector('svg')).not.toBeNull();
    expect(up).toBeDisabled();
    expect(within(secondCard).getByRole('button', { name: 'Move hotel stay 2 down' })).toBeDisabled();
  });

  it('Task 4: Add Hotel Before/After insert on the correct side collapsed', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const names = () =>
      screen
        .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
        .map((b) => (b.closest('article') as HTMLElement).querySelector('h4')!.textContent);
    // After inserts between the two stays; the new stay starts collapsed.
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    expect(names()).toEqual(['Coastal Bay Resort', 'Hotel Stay', 'Second Stay Hotel']);
    expect(screen.getByRole('button', { name: 'Expand hotel stay 2' })).toHaveAttribute('aria-expanded', 'false');
    // Before inserts ahead of the first stay.
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel before stay 1' }));
    expect(names()).toEqual(['Hotel Stay', 'Coastal Bay Resort', 'Hotel Stay', 'Second Stay Hotel']);
  });

  it('Task 5: blue headings gone, room and meal controls always visible', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    expect(screen.queryByText('Hotel Details')).not.toBeInTheDocument();
    // Hotel fields themselves remain.
    await expandStay();
    expect(screen.getByLabelText('Hotel master')).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel total rooms')).toBeInTheDocument();
    // The section headings are gone, with no accordion toggle behind them.
    expect(screen.queryByText('Room Configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Meal Plan')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /(Expand|Collapse) room configuration/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /(Expand|Collapse) meal plan/ }),
    ).not.toBeInTheDocument();
    // Both editors render immediately without any expansion click.
    expect(screen.getByLabelText('Room 1 type master')).toBeInTheDocument();
    expect(screen.getByLabelText('Meal plan 1 master')).toBeInTheDocument();
  });
});

describe('Hotel checkout calendar initial focus', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const decemberStay = () =>
    hotelRow({
      checkInDate: '2026-12-05T00:00:00.000Z',
      checkOutDate: null,
      nights: null,
    });

  it('opens on 6 December focused without committing it', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [decemberStay()] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('05-12-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6 December 2026' })).toHaveFocus();
    // Merely opening commits nothing: value and nights untouched.
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');
  });

  it('selecting the focused day sets checkout and recalculates nights', async () => {
    const fetchMock = builderFetch(detail({ hotels: [decemberStay()] }));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    await userEvent.click(screen.getByRole('button', { name: '6 December 2026' }));
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('06-12-2026');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('1');
    // Serialization matches the native-input shape (UTC midnight ISO).
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels[0].checkOutDate).toContain('2026-12-06');
    expect(body.hotels[0].nights).toBe(1);
  });

  it('check-in change updates minimum and focus; invalid checkout is preserved', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [decemberStay()] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    // Same-date checkout is disabled: checkout must be strictly later.
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    expect(screen.getByRole('button', { name: '5 December 2026' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    // Move check-in to 10 Dec: the calendar follows to 11 Dec.
    fireEvent.change(screen.getByLabelText('Hotel check-in'), { target: { value: '2026-12-10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '11 December 2026' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '10 December 2026' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    // Pick 12 Dec, then move check-in past it: stored value kept (existing
    // validation behavior), nights clears, focus falls back to day-after.
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    await userEvent.click(screen.getByRole('button', { name: '12 December 2026' }));
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('2');
    fireEvent.change(screen.getByLabelText('Hotel check-in'), { target: { value: '2026-12-15' } });
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('12-12-2026');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('—');
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16 December 2026' })).toHaveFocus();
  });
});

describe('Hotel check-in calendar (shared picker)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const decemberStay = () =>
    hotelRow({
      checkInDate: '2026-12-05T00:00:00.000Z',
      checkOutDate: null,
      nights: null,
    });

  it('check-in uses the same custom picker, not a native date input', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [decemberStay()] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    const input = screen.getByLabelText('Hotel check-in') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input).toHaveValue('05-12-2026');
    expect(input).toHaveAttribute('placeholder', 'DD-MM-YYYY');
    expect(input.className).toBe(
      (screen.getByLabelText('Hotel check-out') as HTMLInputElement).className,
    );
    expect(screen.getByRole('button', { name: 'Open check-in calendar' })).toBeInTheDocument();
  });

  it('selecting a check-in via calendar updates nights and checkout constraints', async () => {
    const fetchMock = builderFetch(detail({ hotels: [decemberStay()] }));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    await userEvent.click(screen.getByRole('button', { name: 'Open check-in calendar' }));
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '10 December 2026' }));
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('10-12-2026');
    // Checkout minimum follows the new check-in: 11 December focused.
    await userEvent.click(screen.getByRole('button', { name: 'Open checkout calendar' }));
    expect(screen.getByRole('button', { name: '11 December 2026' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '10 December 2026' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    // Clearing works and empties the value without committing a date.
    await userEvent.click(screen.getByRole('button', { name: 'Open check-in calendar' }));
    await userEvent.keyboard('{Escape}');
    fireEvent.change(screen.getByLabelText('Hotel check-in'), { target: { value: '' } });
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('');
  });

  it('two stays keep independent calendar state', async () => {
    const second = hotelRow({
      id: 'stay-2',
      hotelName: 'Second Stay Hotel',
      sequence: 2,
      checkInDate: '2026-11-20T00:00:00.000Z',
      checkOutDate: null,
      nights: null,
    });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [decemberStay(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay(1);
    await expandStay(2);
    const toggles = screen.getAllByRole('button', { name: 'Open check-in calendar' });
    expect(toggles).toHaveLength(2);
    // Opening the first stay's calendar does not open the second's.
    await userEvent.click(toggles[0]!);
    expect(screen.getByText('December 2026')).toBeInTheDocument();
    expect(screen.queryByText('November 2026')).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: 'Choose check-in date' })).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(toggles[1]!);
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    // Values stay independent.
    const inputs = screen.getAllByLabelText('Hotel check-in');
    expect((inputs[0] as HTMLInputElement).value).toBe('05-12-2026');
    expect((inputs[1] as HTMLInputElement).value).toBe('20-11-2026');
  });
});

describe('Hotel stay dates layout', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('collapsed header shows the hotel name with no city subtitle', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    const header = screen
      .getByRole('button', { name: 'Expand hotel stay 1' })
      .closest('article') as HTMLElement;
    // Hotel name stays; the city subtitle is gone from the header.
    expect(within(header).getByText('Coastal Bay Resort')).toBeInTheDocument();
    expect(within(header).queryByText('Goa')).not.toBeInTheDocument();
  });

  it('places check-in and check-out on separate rows with no city field', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    // The City field is gone from the expanded form (data still flows
    // underneath: selection, prefill, and saves keep hotel.city).
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    expect(screen.queryByText(/from master/)).not.toBeInTheDocument();
    const checkIn = screen.getByLabelText('Hotel check-in');
    const checkInTime = screen.getByLabelText('Hotel check-in time');
    const checkOut = screen.getByLabelText('Hotel check-out');
    const checkOutTime = screen.getByLabelText('Hotel check-out time');
    const nights = screen.getByLabelText('Hotel nights');
    const rooms = screen.getByLabelText('Hotel total rooms');
    // DOM order follows the rows: check-in date, check-in time,
    // check-out date, check-out time, nights, total rooms.
    const after = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(checkIn, checkInTime)).toBe(true);
    expect(after(checkInTime, checkOut)).toBe(true);
    expect(after(checkOut, checkOutTime)).toBe(true);
    expect(after(checkOutTime, nights)).toBe(true);
    expect(after(nights, rooms)).toBe(true);
    // Grid placement: two flexible columns (date wider than time),
    // no leftover city span or column offsets.
    const grid = checkIn.closest('div[class*="grid"]') as HTMLElement;
    expect(grid.className).toMatch(/md:grid-cols-\[minmax/);
    expect(grid.className).not.toMatch(/md:grid-cols-5/);
    expect(grid.className).not.toMatch(/md:row-span-2/);
    expect(nights.closest('label')?.className).not.toMatch(/md:col-start-2/);
  });

  it('stay action group is compact with no plus icons', async () => {
    const second = hotelRow({ id: 'stay-2', hotelName: 'Second Stay Hotel', sequence: 2 });
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelRow(), second] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    // Both insertion buttons keep their labels but render no plus icon.
    for (const name of ['Add hotel before stay 1', 'Add hotel after stay 1']) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent).toContain(name === 'Add hotel before stay 1' ? 'Add Hotel Before' : 'Add Hotel After');
      expect(button.querySelector('svg')).toBeNull();
    }
    // One tight group on the right: compact gap, right-aligned, non-shrinking.
    const card = screen
      .getByRole('button', { name: 'Expand hotel stay 1' })
      .closest('article') as HTMLElement;
    const actions = card.querySelector('header')!.children[1] as HTMLElement;
    expect(actions.className).toMatch(/gap-1\.5/);
    expect(actions.className).not.toMatch(/gap-2/);
    expect(actions.className).toMatch(/justify-end/);
    expect(actions.className).toMatch(/ml-auto/);
    expect(actions.className).toMatch(/shrink-0/);
    // Order: Add Before → Add After → Up → Down → Remove, all present.
    const labels = within(actions)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Add hotel before stay 1',
      'Add hotel after stay 1',
      'Move hotel stay 1 up',
      'Move hotel stay 1 down',
      'Remove hotel stay 1',
    ]);
    // Up/Down/Delete live in their own tight icon subgroup (~70% less
    // spacing: 2px gaps plus minimal side padding around the same 16px
    // icons), while the Add buttons keep the surrounding group spacing.
    const up = within(actions).getByRole('button', { name: 'Move hotel stay 1 up' });
    const iconGroup = up.parentElement as HTMLElement;
    expect(iconGroup.className).toMatch(/gap-0\.5/);
    for (const name of ['Move hotel stay 1 up', 'Move hotel stay 1 down', 'Remove hotel stay 1']) {
      const button = within(iconGroup).getByRole('button', { name });
      expect(button.className).toMatch(/px-0\.5/);
    }
    // Both Add Hotel Before and Add Hotel After render their label at 12px.
    const addBefore = within(actions).getByRole('button', { name: 'Add hotel before stay 1' });
    expect(addBefore.textContent).toContain('Add Hotel Before');
    expect(addBefore.className).toMatch(/text-\[12px\]/);
    const addAfter = within(actions).getByRole('button', { name: 'Add hotel after stay 1' });
    expect(addAfter.textContent).toContain('Add Hotel After');
    expect(addAfter.className).toMatch(/text-\[12px\]/);
    // Up and Down are borderless standalone icons: no border/background box,
    // muted icon color, keyboard-focus ring, tooltips, and boundary disabled
    // states (first stay cannot move up).
    for (const name of ['Move hotel stay 1 up', 'Move hotel stay 1 down']) {
      const button = within(actions).getByRole('button', { name });
      expect(button.className).not.toMatch(/border/);
      expect(button.className).not.toMatch(/bg-card/);
      expect(button.className).toMatch(/focus-visible:ring-2/);
      expect(button).toHaveAttribute('title', name);
    }
    expect(
      within(actions).getByRole('button', { name: 'Move hotel stay 1 up' }),
    ).toBeDisabled();
    expect(
      within(actions).getByRole('button', { name: 'Move hotel stay 1 down' }),
    ).toBeEnabled();
  });

  it('both date fields share one component with full readable values', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          hotels: [
            hotelRow({
              checkInDate: '2026-12-05T00:00:00.000Z',
              checkOutDate: '2026-12-06T00:00:00.000Z',
              nights: 1,
            }),
          ],
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    const checkIn = screen.getByLabelText('Hotel check-in') as HTMLInputElement;
    const checkOut = screen.getByLabelText('Hotel check-out') as HTMLInputElement;
    // Identical inputs: type, placeholder, styling, full DD-MM-YYYY values.
    expect(checkIn.type).toBe('text');
    expect(checkOut.type).toBe('text');
    expect(checkIn.className).toBe(checkOut.className);
    expect(checkIn).toHaveAttribute('placeholder', 'DD-MM-YYYY');
    expect(checkOut).toHaveAttribute('placeholder', 'DD-MM-YYYY');
    expect(checkIn).toHaveValue('05-12-2026');
    expect(checkOut).toHaveValue('06-12-2026');
    // One calendar + one clear control per populated field, same styling.
    for (const name of ['Open check-in calendar', 'Open checkout calendar']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Clear check-in date' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear checkout date' })).toBeInTheDocument();
    const inToggle = screen.getByRole('button', { name: 'Open check-in calendar' });
    const outToggle = screen.getByRole('button', { name: 'Open checkout calendar' });
    expect(inToggle.className).toBe(outToggle.className);
  });
});

describe('Hotel section — clear controls, icon-only removes and live preview', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('check-out time clears and hides exactly like the check-in time control', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.getByLabelText('Hotel check-out time')).toHaveValue('11:00');
    await userEvent.click(screen.getByRole('button', { name: 'Clear check-out time' }));
    expect(screen.getByLabelText('Hotel check-out time')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear check-out time' })).not.toBeInTheDocument();
    // Unrelated fields stay untouched.
    expect(screen.getByLabelText('Hotel check-in time')).toHaveValue('14:00');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('2');
    await userEvent.type(screen.getByLabelText('Hotel check-out time'), '12:00');
    expect(screen.getByRole('button', { name: 'Clear check-out time' })).toBeInTheDocument();
  });

  it('date and time Clear controls share one consistent style', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    const names = [
      'Clear check-in date',
      'Clear checkout date',
      'Clear check-in time',
      'Clear check-out time',
    ];
    const classes = names.map((name) => screen.getByRole('button', { name }).className);
    expect(new Set(classes).size).toBe(1);
  });

  it('room and meal-plan remove controls are icon-only with labels and tooltips', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    for (const name of ['Remove room 1', 'Remove meal plan 1']) {
      const button = screen.getByRole('button', { name });
      expect(button.textContent?.trim()).toBe('');
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button).toHaveAttribute('title', name);
    }
  });

  it('adds a meal plan explicitly when a new stay starts without one', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await expandStay();
    expect(screen.queryByLabelText('Meal plan 1 master')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add meal plan' }));
    expect(screen.getByLabelText('Meal plan 1 master')).toBeInTheDocument();
  });

  it('shows the first room and meal plan in the live preview before any save', async () => {
    const fetchMock = builderFetch(
      detail({ hotels: [hotelRow({ roomType: null, mealPlan: null })] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // The lines carry the values while the legacy scalar mirrors stay NULL
    // until save — the preview must still show the first allocation.
    expect(within(body).getByText('Deluxe Room')).toBeInTheDocument();
    expect(within(body).getByText('Breakfast')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });
});
