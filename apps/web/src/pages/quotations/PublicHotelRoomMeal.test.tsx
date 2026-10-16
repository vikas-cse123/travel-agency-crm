import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { PublicQuotationPage } from './PublicQuotationPage';

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const publicData = {
  company: {
    name: 'Alpha Travel',
    email: 'a@b.test',
    phone: null,
    website: null,
    address: null,
    primaryColor: '#2563eb',
  },
  quotation: {
    quotationNumber: 'QT-2026-000500',
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
    title: 'Room and Meal Layout',
    versionNumber: 1,
    currency: 'INR',
    finalAmount: '100',
    hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
    hotels: [
      {
        id: 'hA',
        hotelName: 'Heritage Hotel',
        city: 'Singapore',
        category: '4 Star',
        roomType: null,
        mealPlan: null,
        rooms: 8,
        nights: 2,
        checkInDate: '2026-08-10',
        checkOutDate: '2026-08-12',
        sellingPrice: '20000',
        selected: true,
        notes: null,
        sequence: 1,
        roomLines: [
          { roomType: 'Superior Room', rooms: 3, extraBedQuantity: 3 },
          { roomType: 'Premier Room', rooms: 3, extraBedQuantity: 1 },
          { roomType: 'Special Room', rooms: 2, extraBedQuantity: 0 },
        ],
        mealPlanLines: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner light' }],
      },
    ],
    services: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    terms: [],
  },
  downloadUrl: null,
};

async function renderPublic(data: unknown = publicData) {
  vi.stubGlobal('fetch', vi.fn(async () => response(data)));
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: '/q/public-token-value-with-at-least-32-characters' },
  );
  await screen.findByText('Custom Package for Mira Shah');
}

describe('Public weblink hotel room and meal plan', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
  });

  it('renders every configured room as a compact divider row without pills', async () => {
    await renderPublic();
    const card = screen.getByText('Heritage Hotel').closest('article') as HTMLElement;

    // All three configured rooms render — the count is data-driven, not fixed.
    const roomList = within(card).getByText('Superior Room').closest('.divide-y') as HTMLElement;
    expect(roomList).not.toBeNull();
    expect(roomList.children).toHaveLength(3);
    expect(within(card).getByText('Premier Room')).toBeInTheDocument();
    expect(within(card).getByText('Special Room')).toBeInTheDocument();

    // Plain rows on a transparent background: dividers only, no chips/panels.
    expect(roomList.className).toContain('divide-y');
    expect(roomList.querySelector('[class*="bg-slate-100"]')).toBeNull();
    expect(roomList.querySelector('[class*="rounded-lg"]')).toBeNull();

    // Room quantity shown on each row.
    expect(within(card).getAllByText('3 rooms')).toHaveLength(2);
    expect(within(card).getByText('2 rooms')).toBeInTheDocument();
  });

  it('shows extra-bed info only when the quantity is greater than zero', async () => {
    await renderPublic();
    const card = screen.getByText('Heritage Hotel').closest('article') as HTMLElement;
    expect(within(card).getByText('Extra bed: 3')).toBeInTheDocument();
    expect(within(card).getByText('Extra bed: 1')).toBeInTheDocument();
    // A configured room with zero extra beds shows no extra-bed text.
    expect(within(card).queryByText('Extra bed: 0')).not.toBeInTheDocument();
  });

  it('places each meal plan on its own full-width row below the room list', async () => {
    await renderPublic();
    const card = screen.getByText('Heritage Hotel').closest('article') as HTMLElement;
    const roomList = within(card).getByText('Superior Room').closest('.divide-y') as HTMLElement;
    const mealList = within(card).getByText('Breakfast only').closest('.divide-y') as HTMLElement;
    expect(mealList).not.toBeNull();
    expect(mealList).not.toBe(roomList);
    expect(mealList.children).toHaveLength(2);
    expect(within(card).getByText('Dinner light')).toBeInTheDocument();

    // The meal block follows the room block in document order (below, never beside).
    expect(
      roomList.compareDocumentPosition(mealList) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mealList.querySelector('[class*="bg-slate-100"]')).toBeNull();
    expect(mealList.querySelector('[class*="rounded-lg"]')).toBeNull();
  });

  it('omits the meal section when no meal plan is configured', async () => {
    const clone = JSON.parse(JSON.stringify(publicData)) as typeof publicData;
    const hotel = clone.version.hotels[0] as unknown as Record<string, unknown>;
    hotel.mealPlanLines = [];
    hotel.mealPlan = null;

    await renderPublic(clone);
    expect(screen.getByText('Superior Room')).toBeInTheDocument();
    expect(screen.queryByText('Meal Plan')).not.toBeInTheDocument();
  });
});
