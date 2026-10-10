import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { HotelVouchersPage } from './HotelVouchersPage';
import { HotelVoucherFormPage } from './HotelVoucherFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    hasPermission: (key: string) => auth.permissions.has(key),
    user: { id: 'u-1', fullName: 'Owner' },
  }),
}));

const ALL = [
  'hotel_vouchers.view',
  'hotel_vouchers.create',
  'hotel_vouchers.update',
  'hotel_vouchers.delete',
  'hotel_vouchers.export',
  'hotel_vouchers.send',
  'settings.view',
  'settings.update',
];

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const guestNames = [
  'pintu', 'rohan', 'dsfadsf', 'Mrs. Pinki Patel', 'Lalu prasad',
  'krish', 'op rajbhar', 'abcdef', 'xyz kumar', 'op rider',
];

const fullVoucher = {
  id: 'dceba0fe-3339-4545-9cc9-89aa73404f90',
  voucherNumber: 'HV-000024',
  customerId: null,
  queryId: null,
  hotelId: 'a664a7da-da50-4727-bddc-02ff8eef2cb9',
  guestName: 'Vikas Sahni',
  guestPhone: null,
  guestEmail: null,
  adults: 7,
  children: 3,
  hotelName: 'Hotel Boss Singapore',
  hotelAddress: 'Address: 500 Jalan Sultan, Singapore 199020',
  hotelCity: 'Singapore',
  hotelPhone: '987654323',
  hotelEmail: 'hotelboss@gmail.com',
  hotelStarRating: '4 Star',
  checkIn: '2026-11-01',
  checkOut: '2026-11-04',
  roomTypeName: 'Superior Room',
  rooms: 1,
  mealPlanName: 'Breakfast only',
  confirmationNumber: null,
  confirmationNumberLabel: null,
  bookingId: null,
  bookingIdLabel: null,
  specialRequests: null,
  remarks: null,
  termsSnapshot: null,
  createdById: 'u-1',
  createdBy: { id: 'u-1', fullName: 'Owner' },
  createdAt: '2026-10-10T10:34:10.941Z',
  updatedAt: '2026-10-10T14:36:23.909Z',
  cancelledAt: null,
  documents: [],
  pricing: [],
  guests: guestNames.map((guestName, i) => ({
    id: `g-${i}`,
    guestName,
    age: null,
    sex: 'M',
    paxType: i < 7 ? 'ADULT' : 'CHILD',
  })),
  packageIncludes: [],
};

const masterHotel = {
  id: 'a664a7da-da50-4727-bddc-02ff8eef2cb9',
  name: 'Hotel Boss Singapore',
  address: 'Address: 500 Jalan Sultan, Singapore 199020',
  city: { id: 'c-1', name: 'Singapore' },
  phone: '987654323',
  email: 'hotelboss@gmail.com',
  starCategory: 4,
  starRating: 4.3,
  status: 'ACTIVE',
};

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/hotel-vouchers" element={<HotelVouchersPage />} />
      <Route path="/hotel-vouchers/:voucherId/edit" element={<HotelVoucherFormPage />} />
    </Routes>,
    { route },
  );
}

describe('HV-000024 navigation repro', () => {
  it('navigating list -> edit shows all 10 names without refresh', async () => {
    auth.permissions = new Set(ALL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const href = String(request);
        if (href.includes('/masters/hotels/') && !href.includes('?')) return response(masterHotel);
        if (href.includes('/masters/hotels')) return response({ data: [masterHotel], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
        if (href.includes('/customers')) return response({ data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
        if (href.includes('/queries')) return response({ data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
        if (href.includes('/settings')) return response({ branding: { hotelVoucherPrimaryColor: null } });
        if (/\/hotel-vouchers\/[^/?]+$/.test(href)) return response(fullVoucher);
        return response({
          data: [{ ...fullVoucher, guests: [], pricing: [], packageIncludes: [], documents: [] }],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    renderApp('/hotel-vouchers');
    expect(await screen.findByText('Vikas Sahni · Hotel Boss Singapore')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: `Edit voucher for Vikas Sahni` }));
    await waitFor(
      () => expect(screen.getByLabelText('Guest 10 name')).toHaveValue('op rider'),
      { timeout: 8000 },
    );
    for (const [i, name] of guestNames.entries()) {
      expect(screen.getByLabelText(`Guest ${i + 1} name`)).toHaveValue(name);
    }
  });
});
