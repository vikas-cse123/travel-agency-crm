import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { NAV_ITEMS } from '@/components/layout/navigation';
import { HotelVouchersPage } from './HotelVouchersPage';
import { HotelVoucherFormPage } from './HotelVoucherFormPage';
import { HotelVoucherDetailsPage } from './HotelVoucherDetailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const ALL = [
  'hotel_vouchers.view',
  'hotel_vouchers.create',
  'hotel_vouchers.update',
  'hotel_vouchers.delete',
  'hotel_vouchers.export',
  'hotel_vouchers.send',
];

const WITH_BRANDING = [...ALL, 'settings.view', 'settings.update'];

const brandingSettings = (hotelVoucherPrimaryColor: string | null) => ({
  branding: {
    primaryColor: '#2563eb',
    hotelVoucherPrimaryColor,
    hasLogo: false,
    logoMimeType: null,
    logoFileSize: null,
  },
});

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 10, total: data.length, totalPages: 1 },
});

const draftVoucher = {
  id: 'aaaaaaaa-1111-4111-8111-111111111111',
  voucherNumber: 'HV-000001',
  status: 'DRAFT',
  issueDate: null,
  customerId: null,
  queryId: null,
  hotelId: '33333333-3333-4333-8333-333333333333',
  guestName: 'Aarav Mehta',
  guestPhone: '+91 90000 00000',
  guestEmail: 'aarav@example.test',
  adults: 2,
  children: 1,
  hotelName: 'Shah Palace Hotel',
  hotelAddress: 'Palace Road, Jaipur',
  hotelCity: 'Jaipur',
  hotelPhone: '+91 14100 00000',
  hotelEmail: 'stay@shahpalace.test',
  hotelStarRating: '4 Star',
  checkIn: '2026-11-10',
  checkOut: '2026-11-13',
  nights: 3,
  roomTypeName: 'Deluxe',
  rooms: 1,
  mealPlanName: 'Breakfast',
  confirmationNumber: 'CONF-1',
  specialRequests: null,
  remarks: null,
  termsSnapshot: null,
  createdById: 'bbbbbbbb-2222-4222-8222-222222222222',
  createdBy: { id: 'bbbbbbbb-2222-4222-8222-222222222222', fullName: 'Priya Nair' },
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  cancelledAt: null,
  documents: [],
  pricing: [],
  guests: [],
  packageIncludes: [],
};

const issuedVoucher = { ...draftVoucher, status: 'ISSUED', issueDate: '2026-10-07' };

const hotelMaster = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Shah Palace Hotel',
  address: 'Palace Road, Jaipur',
  city: { id: 'c-1', name: 'Jaipur' },
  phone: '+91 14100 00000',
  email: 'stay@shahpalace.test',
  starCategory: 4,
  starRating: null,
};

function renderRoutes(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/hotel-vouchers" element={<HotelVouchersPage />} />
      <Route path="/hotel-vouchers/new" element={<HotelVoucherFormPage />} />
      <Route path="/hotel-vouchers/:voucherId" element={<HotelVoucherDetailsPage />} />
      <Route path="/hotel-vouchers/:voucherId/edit" element={<HotelVoucherFormPage />} />
    </Routes>,
    { route },
  );
}

/** Drive a MasterUi rich-text editor: jsdom typing can hit execCommand, so set HTML directly. */
function setEditorHtml(label: string, html: string) {
  const editor = screen.getByLabelText(label);
  editor.innerHTML = html;
  fireEvent.input(editor);
}

describe('Hotel Voucher pages (standalone)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('adds a Vouchers-section Hotel nav item gated by its own permission', () => {
    const item = NAV_ITEMS.find((entry) => entry.label === 'Hotel');
    expect(item).toMatchObject({
      to: '/hotel-vouchers',
      permission: 'hotel_vouchers.view',
      available: true,
    });
    expect(item?.section).toBe('VOUCHERS');
    const salesLabels = NAV_ITEMS.filter((entry) => entry.section === 'SALES').map(
      (entry) => entry.label,
    );
    expect(salesLabels).not.toContain('Hotel');
    expect(salesLabels).not.toContain('Hotel Vouchers');
  });

  it('lists vouchers with search and no status filter or badges', async () => {
    const fetchMock = vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher])));
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    // System voucher numbers stay internal: never rendered in list rows.
    expect(screen.queryByText('HV-000001')).not.toBeInTheDocument();
    // Statuses are gone from the workflow: no badge, no filter control.
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by status')).not.toBeInTheDocument();
    const calls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calls.some((url) => url.includes('/hotel-vouchers?'))).toBe(true);
    expect(calls.some((url) => url.includes('status='))).toBe(false);
  });

  it('hides the New button without the create permission', async () => {
    auth.permissions = new Set(['hotel_vouchers.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([]))),
    );
    renderRoutes('/hotel-vouchers');
    await screen.findByText('No hotel vouchers yet. Create one from a hotel stay.');
    expect(screen.queryByRole('link', { name: /New voucher/ })).not.toBeInTheDocument();
  });

  it('validates the form and computes nights read-only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      }),
    );
    renderRoutes('/hotel-vouchers/new');
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    // Required-field errors appear; nothing is submitted.
    await waitFor(() => expect(screen.getByText('Nights: —')).toBeInTheDocument());
    // Special Requests/Remarks are not part of the form; only Terms remains.
    expect(screen.queryByLabelText('Special Requests')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remarks')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Terms & Conditions').textContent).toBe('');
    const user = screen.getByLabelText('Guest Name');
    await userEvent.type(user, 'Aarav Mehta');
    expect(user).toHaveValue('Aarav Mehta');
  });

  it('creates vouchers directly with a Create Voucher action and no draft step', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      }),
    );
    renderRoutes('/hotel-vouchers/new');
    await screen.findByLabelText('Guest Name');
    expect(screen.getByRole('button', { name: 'Create Voucher' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue voucher' })).not.toBeInTheDocument();
  });

  it('lists an Edit action for every voucher', async () => {
    const fetchMock = vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher])));
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers');
    const edit = await screen.findByRole('link', { name: 'Edit voucher for Aarav Mehta' });
    expect(edit).toHaveAttribute('href', `/hotel-vouchers/${draftVoucher.id}/edit`);
  });

  it('shows a Back button on the detail page linking to the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(draftVoucher)));
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    const back = await screen.findByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute('href', '/hotel-vouchers');
  });

  it('lists Open, Download, Edit and Delete actions in order for every row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByRole('button', { name: 'Open voucher for Aarav Mehta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download voucher for Aarav Mehta' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit voucher for Aarav Mehta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete voucher for Aarav Mehta' })).toBeInTheDocument();
  });

  it('asks for confirmation naming guest and hotel, and skips delete on cancel', async () => {
    const fetchMock = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      return response(page([draftVoucher]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderRoutes('/hotel-vouchers');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Delete voucher for Aarav Mehta' }),
      );
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining('Aarav Mehta'),
      );
      expect(confirmSpy.mock.calls[0]?.[0]).toContain('Shah Palace Hotel');
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE')).toBe(
        false,
      );
      // Row left unchanged.
      expect(screen.getByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('deletes the voucher and refreshes the list on confirm', async () => {
    let rows = [draftVoucher];
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const href = String(request);
      if (init?.method === 'DELETE' && href.includes(`/hotel-vouchers/${draftVoucher.id}`)) {
        rows = [];
        return response({ id: draftVoucher.id, deleted: true });
      }
      return response(page(rows));
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderRoutes('/hotel-vouchers');
      expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete voucher for Aarav Mehta' }),
      );
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(
            ([url, init]) =>
              String(url).includes(`/hotel-vouchers/${draftVoucher.id}`) &&
              (init as RequestInit)?.method === 'DELETE',
          ),
        ).toBe(true),
      );
      await waitFor(() =>
        expect(screen.queryByText('Aarav Mehta · Shah Palace Hotel')).not.toBeInTheDocument(),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('steps back a page when the last row on the page is deleted', async () => {
    const second = { ...draftVoucher, id: 'bbbbbbbb-2222-4222-8222-222222222222' };
    let pageTwo = [second];
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const href = String(request);
      if (init?.method === 'DELETE') {
        pageTwo = [];
        return response({ id: second.id, deleted: true });
      }
      const url = new URL(href, 'http://localhost');
      if (url.searchParams.get('page') === '1' || !url.searchParams.get('page')) {
        return response({
          data: [draftVoucher],
          pagination: { page: 1, pageSize: 10, total: 11, totalPages: 2 },
        });
      }
      return response({
        data: pageTwo,
        pagination: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderRoutes('/hotel-vouchers?page=2');
      expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Delete voucher for Aarav Mehta' }),
      );
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes('page=1')),
        ).toBe(true),
      );
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('hides Delete without the delete permission', async () => {
    auth.permissions = new Set([
      'hotel_vouchers.view',
      'hotel_vouchers.create',
      'hotel_vouchers.update',
      'hotel_vouchers.export',
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete voucher/ })).not.toBeInTheDocument();
    // Other actions still respect their own permissions.
    expect(screen.getByRole('link', { name: 'Edit voucher for Aarav Mehta' })).toBeInTheDocument();
  });

  it('hides Voucher Branding without the settings.view permission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voucher Branding Settings' })).not.toBeInTheDocument();
  });

  it('loads the saved voucher color and previews edits before saving', async () => {
    auth.permissions = new Set(WITH_BRANDING);
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const href = String(request);
      if (href.includes('/settings')) return response(brandingSettings('#15803D'));
      return response(page([draftVoucher]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers');
    const gear = await screen.findByRole('button', { name: 'Voucher Branding Settings' });
    // Icon-only gear button: no visible text label in the header.
    expect(gear.textContent?.trim()).toBe('');
    await userEvent.click(gear);
    const hex = await screen.findByLabelText('Voucher primary colour hex');
    expect(hex).toHaveValue('#15803D');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#2563EB');
    const preview = screen.getByLabelText('Voucher colour preview');
    expect(preview).toHaveStyle({ backgroundColor: '#2563EB' });
    // Unsaved edits never persist on their own.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/settings/branding')),
    ).toBe(false);
  });

  it('saves the voucher color and resets to the default purple', async () => {
    auth.permissions = new Set(WITH_BRANDING);
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const href = String(request);
      if (href.includes('/settings/branding') && init?.method === 'PATCH') {
        return response(brandingSettings('#fde68a'));
      }
      if (href.includes('/settings')) return response(brandingSettings(null));
      return response(page([draftVoucher]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers');
    await userEvent.click(await screen.findByRole('button', { name: 'Voucher Branding Settings' }));
    const hex = await screen.findByLabelText('Voucher primary colour hex');
    // No saved color: the established default purple loads.
    expect(hex).toHaveValue('#3d2352');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#FDE68A');
    await userEvent.click(screen.getByRole('button', { name: 'Save Color' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, o]) => {
          const body = (o as RequestInit)?.body ? JSON.parse(String((o as RequestInit).body)) : null;
          return (
            String(url).endsWith('/settings/branding') &&
            (o as RequestInit)?.method === 'PATCH' &&
            body?.hotelVoucherPrimaryColor === '#fde68a'
          );
        }),
      ).toBe(true),
    );
    expect(await screen.findByText('Voucher color saved. New PDFs will use it.')).toBeInTheDocument();
    // After saving, Reset to Default clears back to null (default purple).
    await userEvent.click(await screen.findByRole('button', { name: 'Reset to Default' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url, o]) => {
          const body = (o as RequestInit)?.body ? JSON.parse(String((o as RequestInit).body)) : null;
          return (
            String(url).endsWith('/settings/branding') &&
            (o as RequestInit)?.method === 'PATCH' &&
            body?.hotelVoucherPrimaryColor === null
          );
        }),
      ).toBe(true),
    );
  });

  it('requests 20 vouchers per page and numbers page 2 from 21', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      ...draftVoucher,
      id: `v-${i}`,
      guestName: `Guest ${i + 1}`,
    }));
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const href = String(request);
      if (href.includes('/settings')) return response(brandingSettings(null));
      const url = new URL(href, 'http://localhost');
      if (url.searchParams.get('page') === '2') {
        return response({
          data: [{ ...draftVoucher, id: 'v-21', guestName: 'Guest 21' }],
          pagination: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
        });
      }
      return response({
        data: twenty,
        pagination: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers');
    await screen.findByText('Guest 20 · Shah Palace Hotel');
    // The outgoing list query asks for 20 rows, not 10.
    expect(
      fetchMock.mock.calls.some(([url]) => {
        const href = String(url);
        return href.includes('/hotel-vouchers?') && href.includes('pageSize=20');
      }),
    ).toBe(true);
    expect(screen.getByText('20')).toBeInTheDocument();
    renderRoutes('/hotel-vouchers?page=2&pageSize=20');
    await screen.findByText('Guest 21 · Shah Palace Hotel');
    expect(screen.getByText('21')).toBeInTheDocument();
  });

  it('renders enterprise row hierarchy with stay facts and traveller meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    // Secondary facts from the same row: city, date range, duration, occupancy.
    expect(screen.getByText('Jaipur')).toBeInTheDocument();
    expect(screen.getByText('10-11-2026 → 13-11-2026')).toBeInTheDocument();
    expect(screen.getByText('3 nights')).toBeInTheDocument();
    expect(screen.getByText('3 guests')).toBeInTheDocument();
    expect(screen.getByText('1 room')).toBeInTheDocument();
  });

  it('uses the Leads-style green compact table header with voucher columns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher]))),
    );
    const { container } = renderRoutes('/hotel-vouchers');
    await screen.findByText('Aarav Mehta · Shah Palace Hotel');
    // Scope class wires the CSS variables (green header, divider colors).
    expect(container.querySelector('.vouchers-page')).not.toBeNull();
    const thead = document.querySelector('.vouchers-thead');
    expect(thead).not.toBeNull();
    const headers = Array.from(thead!.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).toEqual(['No.', 'Guest / Hotel', 'Stay Dates', 'Created By', 'Actions']);
    const bodyRow = document.querySelector('.vouchers-tbody tr');
    expect(bodyRow).not.toBeNull();
    expect(thead!.querySelectorAll('th').length).toBe(5);
    expect(bodyRow!.querySelectorAll('td').length).toBe(5);
    // Header sits above the first body row inside the same table.
    const table = document.querySelector('table.vouchers-table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('thead.vouchers-thead')).not.toBeNull();
    expect(table!.querySelector('tbody.vouchers-tbody')).not.toBeNull();
  });

  it('lists sequential row numbers with a No. column and no initials avatars', async () => {
    const second = {
      ...draftVoucher,
      id: 'cccccccc-3333-4333-8333-333333333333',
      guestName: 'Mohan Rao',
      createdBy: { id: 'dddddddd-4444-4444-8444-444444444444', fullName: 'Rahul Verma' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([draftVoucher, second]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('No.')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Circular initials badges are gone; names align directly.
    expect(screen.queryByText('AM')).not.toBeInTheDocument();
    expect(screen.queryByText('MR')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('Rahul Verma')).toBeInTheDocument();
  });

  it('continues row numbering on subsequent pages', async () => {
    const paged = {
      data: [draftVoucher],
      pagination: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
    };
    vi.stubGlobal('fetch', vi.fn(async (_request: RequestInfo | URL) => response(paged)));
    renderRoutes('/hotel-vouchers?page=2');
    expect(await screen.findByText('11')).toBeInTheDocument();
  });

  it('shows — for a missing creator without fabricating a name', async () => {
    const orphan = { ...draftVoucher, createdBy: null, createdById: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_request: RequestInfo | URL) => response(page([orphan]))),
    );
    renderRoutes('/hotel-vouchers');
    expect(await screen.findByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Priya Nair')).not.toBeInTheDocument();
  });

  it('opens the voucher PDF in a viewer without downloading', async () => {
    const replaceSpy = vi.fn();
    vi.stubGlobal('open', vi.fn(() => ({ location: { replace: replaceSpy }, document: {}, opener: null, close: vi.fn() })));
    const originalCreateObjectURL = URL.createObjectURL;
    vi.stubGlobal('fetch', (async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === 'https://signed.test/v.pdf')
        return { ok: true, blob: async () => new Blob(['pdf'], { type: 'application/pdf' }) };
      const method = (init as RequestInit | undefined)?.method;
      if (href.includes('/generate-pdf') && method === 'POST')
        return response({ id: 'doc-1', fileName: 'Aarav - Shah.pdf' });
      if (href.includes('/documents/doc-1/download-url'))
        return response({ url: 'https://signed.test/v.pdf', fileName: 'Aarav - Shah.pdf' });
      return response(page([draftVoucher]));
    }) as typeof fetch);
    URL.createObjectURL = vi.fn(() => 'blob:mock-pdf-url') as unknown as typeof URL.createObjectURL;
    try {
      renderRoutes('/hotel-vouchers');
      await userEvent.click(await screen.findByRole('button', { name: 'Open voucher for Aarav Mehta' }));
      await waitFor(() => expect(replaceSpy).toHaveBeenCalled());
      expect(String(replaceSpy.mock.calls[0]?.[0])).toContain('blob:');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('downloads the voucher PDF with the signed filename', async () => {
    vi.stubGlobal('open', vi.fn(() => null));
    vi.stubGlobal('fetch', (async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      const method = (init as RequestInit | undefined)?.method;
      if (href.includes('/generate-pdf') && method === 'POST')
        return response({ id: 'doc-1', fileName: 'Aarav - Shah.pdf' });
      if (href.includes('/documents/doc-1/download-url'))
        return response({
          url: 'https://signed.test/v.pdf?sig=abc',
          fileName: 'Aarav - Shah.pdf',
        });
      return response(page([draftVoucher]));
    }) as typeof fetch);
    const originalCreateElement = window.document.createElement.bind(window.document);
    const clickSpy = vi.fn();
    let capturedAnchor: HTMLAnchorElement | null = null;
    const createSpy = vi
      .spyOn(window.document, 'createElement')
      .mockImplementation(((tagName: string, ...rest: unknown[]) => {
        if (tagName.toLowerCase() !== 'a')
          return (originalCreateElement as unknown as (...args: unknown[]) => HTMLElement)(
            ...( [tagName, ...rest] as unknown as []),
          );
        const anchor = originalCreateElement('a') as HTMLAnchorElement;
        capturedAnchor = anchor;
        anchor.click = clickSpy;
        return anchor;
      }) as unknown as typeof window.document.createElement);
    try {
      renderRoutes('/hotel-vouchers');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Download voucher for Aarav Mehta' }),
      );
      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      // Read through a cast: the anchor is only assigned inside the
      // createElement mock, which control-flow analysis treats as never run.
      expect((capturedAnchor as HTMLAnchorElement | null)?.download).toBe('Aarav - Shah.pdf');
    } finally {
      createSpy.mockRestore();
    }
  });

  it('orders form sections Hotel first, then Guest, Stay, Rooms, Meals, Guests, Includes, Terms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      }),
    );
    renderRoutes('/hotel-vouchers/new');
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Hotel Details',
      'Guest Details',
      'Stay Details',
      'Rooms',
      'Meal Plans',
      'Guest Information (Optional)',
      'Package Includes (Optional)',
      'Terms & Conditions',
    ]);
    // No. of Rooms lives in Guest Details with a default of 1.
    expect(screen.getByLabelText('No. of Rooms')).toHaveDisplayValue('1');
    expect(screen.queryByLabelText('Rooms', { exact: true })).not.toBeInTheDocument();
  });

  it('populates hotel snapshots when a master hotel is chosen', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/masters/hotels/') && !url.includes('?')) return response(hotelMaster);
      if (url.includes('/masters/hotels')) return response(page([hotelMaster]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    const picker = await screen.findByLabelText('Hotel', { exact: true });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/masters/hotels?'))).toBe(
        true,
      ),
    );
    fireEvent.change(picker, { target: { value: 'Shah Palace Hotel' } });
    // Choosing the master populates every snapshot field from its record.
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Shah Palace Hotel'),
    );
    expect(screen.getByLabelText('Hotel Address')).toHaveValue('Palace Road, Jaipur');
    expect(screen.getByLabelText('Hotel City')).toHaveValue('Jaipur');
    expect(screen.getByLabelText('Hotel Phone')).toHaveValue('+91 14100 00000');
    expect(screen.getByLabelText('Hotel Email')).toHaveValue('stay@shahpalace.test');
  });
  it('shows Edit/Open/Download/Delete in the unified header with no Share section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(draftVoucher)),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue voucher' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Voucher' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
  });

  it('shows unified Open and Download in the header alongside Edit', async () => {
    const withDoc = {
      ...issuedVoucher,
      documents: [
        {
          id: 'd-1',
          fileName: 'hotel-voucher-HV-000001.pdf',
          mimeType: 'application/pdf',
          fileSize: 1234,
          uploadStatus: 'AVAILABLE',
          visibility: 'CUSTOMER_VISIBLE',
          createdAt: '2026-10-07T00:00:00.000Z',
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(withDoc)),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue voucher' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Voucher' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recipient email')).not.toBeInTheDocument();
    expect(screen.queryByText('ISSUED')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('opens and edits a legacy cancelled voucher with no status UI', async () => {
    const cancelled = { ...draftVoucher, status: 'CANCELLED' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(cancelled)),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
    expect(screen.queryByText('CANCELLED')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Voucher' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('opens the edit form for issued vouchers instead of redirecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(issuedVoucher)),
    );
    renderRoutes(`/hotel-vouchers/${issuedVoucher.id}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Guest Name')).toHaveValue('Aarav Mehta'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('Open Voucher fetches a download URL and opens the signed PDF in a new tab', async () => {
    const generatedDoc = {
      id: 'd-1',
      fileName: 'hotel-voucher-HV-000001.pdf',
      mimeType: 'application/pdf',
      fileSize: 11016,
      uploadStatus: 'AVAILABLE',
      visibility: 'CUSTOMER_VISIBLE',
      createdAt: '2026-10-07T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/generate-pdf')) return response(generatedDoc);
      if (url.includes('/download-url'))
        return response({
          url: 'https://signed.test/hotel-voucher-HV-000001.pdf?sig=abc',
          fileName: 'hotel-voucher-HV-000001.pdf',
          expiresInSeconds: 300,
        });
      return response(draftVoucher);
    });
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    const tab = {
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    };
    const originalOpen = window.open;
    window.open = vi.fn(() => tab) as unknown as typeof window.open;
    try {
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open Voucher' }));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          'https://signed.test/hotel-voucher-HV-000001.pdf?sig=abc',
        ),
      );
      // Popup opened synchronously (blocker-safe), then navigated after the APIs.
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
      const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
      expect(calls.some((call) => call.includes('POST') && call.includes('/generate-pdf'))).toBe(
        true,
      );
      expect(calls.some((call) => call.includes('/documents/d-1/download-url'))).toBe(true);
    } finally {
      window.open = originalOpen;
    }
  });

  it('Download fetches a download URL and opens it without regenerating', async () => {
    const withDoc = {
      ...issuedVoucher,
      documents: [
        {
          id: 'd-1',
          fileName: 'hotel-voucher-HV-000001.pdf',
          mimeType: 'application/pdf',
          fileSize: 1234,
          uploadStatus: 'AVAILABLE',
          visibility: 'CUSTOMER_VISIBLE',
          createdAt: '2026-10-07T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/download-url'))
        return response({
          url: 'https://signed.test/hotel-voucher-HV-000001.pdf?sig=abc',
          fileName: 'hotel-voucher-HV-000001.pdf',
          expiresInSeconds: 300,
        });
      return response(withDoc);
    });
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    const tab = {
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    };
    const originalOpen = window.open;
    window.open = vi.fn(() => tab) as unknown as typeof window.open;
    try {
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          'https://signed.test/hotel-voucher-HV-000001.pdf?sig=abc',
        ),
      );
      const calls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(calls.some((url) => url.includes('/generate-pdf'))).toBe(false);
      expect(calls.some((url) => url.includes('/documents/d-1/download-url'))).toBe(true);
    } finally {
      window.open = originalOpen;
    }
  });

  it('Open Voucher shows the existing PDF in a new tab without regenerating', async () => {
    const withDoc = {
      ...issuedVoucher,
      documents: [
        {
          id: 'd-1',
          fileName: 'hotel-voucher-HV-000001.pdf',
          mimeType: 'application/pdf',
          fileSize: 11016,
          uploadStatus: 'AVAILABLE',
          visibility: 'CUSTOMER_VISIBLE',
          createdAt: '2026-10-07T00:00:00.000Z',
        },
      ],
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/download-url'))
        return response({
          url: 'https://signed.test/hotel-voucher-HV-000001.pdf?sig=abc',
          fileName: 'hotel-voucher-HV-000001.pdf',
          expiresInSeconds: 300,
        });
      if (url.startsWith('https://signed.test'))
        return { ok: true, blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) };
      return response(withDoc);
    });
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    const tab = {
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    };
    const originalOpen = window.open;
    window.open = vi.fn(() => tab) as unknown as typeof window.open;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(
      () => 'blob:mock-voucher-pdf',
    ) as unknown as typeof URL.createObjectURL;
    try {
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open Voucher' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('blob:mock-voucher-pdf'));
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
      const calls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(calls.some((url) => url.includes('/generate-pdf'))).toBe(false);
      expect(calls.some((url) => url.includes('/documents/d-1/download-url'))).toBe(true);
      expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument();
    } finally {
      window.open = originalOpen;
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('Open Voucher generates the missing PDF first instead of dead-ending', async () => {
    const withoutDoc = { ...issuedVoucher, documents: [] };
    const generatedDoc = {
      id: 'd-9',
      fileName: 'hotel-voucher-HV-000001.pdf',
      mimeType: 'application/pdf',
      fileSize: 11016,
      uploadStatus: 'AVAILABLE',
      visibility: 'CUSTOMER_VISIBLE',
      createdAt: '2026-10-07T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/generate-pdf')) return response(generatedDoc);
      if (url.includes('/download-url'))
        return response({
          url: 'https://signed.test/hotel-voucher-HV-000001.pdf?sig=fresh',
          fileName: 'Aarav Mehta - Shah Palace Hotel.pdf',
          expiresInSeconds: 300,
        });
      if (url.startsWith('https://signed.test'))
        return { ok: true, blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) };
      return response(withoutDoc);
    });
    vi.stubGlobal('fetch', fetchMock);
    const replace = vi.fn();
    const tab = {
      document: { title: '', body: { innerHTML: '' } },
      location: { replace },
      close: vi.fn(),
    };
    const originalOpen = window.open;
    window.open = vi.fn(() => tab) as unknown as typeof window.open;
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(
      () => 'blob:mock-fresh-pdf',
    ) as unknown as typeof URL.createObjectURL;
    try {
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open Voucher' }));
      // The missing PDF is generated first, then opened — no error banner,
      // and the same voucher/document pair is used throughout.
      await waitFor(() => expect(replace).toHaveBeenCalledWith('blob:mock-fresh-pdf'));
      expect(tab.document.title).toBe('Aarav Mehta - Shah Palace Hotel');
      const calls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(calls.some((url) => url.includes('/generate-pdf'))).toBe(true);
      expect(calls.some((url) => url.includes('/documents/d-9/download-url'))).toBe(true);
      expect(
        screen.queryByText('Hotel voucher PDF has not been generated yet. Generate PDF first.'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Hotel voucher PDF could not be generated. Please try again\.'),
      ).not.toBeInTheDocument();
    } finally {
      window.open = originalOpen;
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('Open Voucher surfaces generation failures without opening a dead tab', async () => {
    const withoutDoc = { ...issuedVoucher, documents: [] };
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/generate-pdf'))
        return { ok: false, status: 500, json: async () => ({ success: false }) } as Response;
      return response(withoutDoc);
    });
    vi.stubGlobal('fetch', fetchMock);
    const originalOpen = window.open;
    window.open = vi.fn() as unknown as typeof window.open;
    try {
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Open Voucher' }));
      // No blank tab is left open; the failure is shown and retry stays available.
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(window.open).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Open Voucher' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    } finally {
      window.open = originalOpen;
    }
  });

  it('creates a voucher with guest rows and no pricing section', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });

    // Pricing left the voucher workflow: no section, no rows, no total.
    expect(screen.queryByText('Pricing (Optional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Pricing Row' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Payable Amount/)).not.toBeInTheDocument();

    // The single default adult row is already present (Adults defaults to 1).
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Dilip Vaid');
    // Age and Sex are gone from Guest Information: no headings, no inputs.
    expect(screen.queryByLabelText('Guest 1 age')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Guest 1 sex')).not.toBeInTheDocument();
    expect(screen.queryByText('Age')).not.toBeInTheDocument();
    expect(screen.queryByText('Sex')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body).not.toHaveProperty('pricing');
    expect(body.guests).toHaveLength(1);
    expect(body.guests[0]).toMatchObject({
      guestName: 'Dilip Vaid',
      paxType: 'ADULT',
    });
  });

  it('shows the saved hotel in its picker when the master is missing from lookups', async () => {
    const linked = {
      ...draftVoucher,
      hotelId: '33333333-3333-4333-8333-333333333333',
      hotelName: 'Shah Palace Hotel',
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(request);
      // Archived/absent master: lookups come back empty.
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(linked);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    // Picker falls back to the saved snapshot instead of rendering blank…
    await waitFor(() => expect(screen.getByLabelText('Hotel')).toHaveValue('Shah Palace Hotel'));
    // …and the saved link survives an unrelated save.
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, options]) =>
          String(url).endsWith(`/hotel-vouchers/${draftVoucher.id}`) &&
          (options as RequestInit)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch?.[1]?.body)).hotelId).toBe(
        '33333333-3333-4333-8333-333333333333',
      );
    });
  });

  it('shows the saved lead in its picker when the lead is missing from lookups', async () => {
    const linked = {
      ...draftVoucher,
      queryId: '44444444-4444-4444-8444-444444444444',
      query: { id: '44444444-4444-4444-8444-444444444444', customerName: 'Saved Lead Name' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(linked);
      }),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    await waitFor(() => expect(screen.getByLabelText('Lead')).toHaveValue('Saved Lead Name'));
  });

  it('keeps customized hotel contact fields instead of overwriting them from the master', async () => {
    const customized = {
      ...draftVoucher,
      hotelId: '33333333-3333-4333-8333-333333333333',
      hotelName: 'Custom Hotel Title',
      hotelPhone: '+91 77777 77777',
    };
    const master = {
      ...hotelMaster,
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Master Hotel Name',
      phone: '+91 14100 00000',
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(request);
      if (url.includes('/masters/hotels/') && !url.includes('?')) return response(master);
      if (url.includes('/masters/hotels')) return response(page([hotelMaster]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(customized);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    // The saved customization wins over the master response on open…
    await waitFor(() => expect(screen.getByLabelText('Hotel Phone')).toHaveValue('+91 77777 77777'));
    expect(screen.getByLabelText('Hotel Name')).toHaveValue('Custom Hotel Title');
    // …and survives a save unchanged.
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, options]) =>
          String(url).endsWith(`/hotel-vouchers/${draftVoucher.id}`) &&
          (options as RequestInit)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch?.[1]?.body));
      expect(body.hotelPhone).toBe('+91 77777 77777');
      expect(body.hotelName).toBe('Custom Hotel Title');
    });
  });

  it('edits a legacy voucher with stored age/sex without showing those fields', async () => {
    const legacyGuests = {
      ...draftVoucher,
      adults: 1,
      children: 1,
      guests: [
        { id: 'g-1', guestName: 'Old Guest', age: 63, sex: 'M', paxType: 'ADULT' },
        { id: 'g-2', guestName: 'Young Guest', age: 8, sex: 'F', paxType: 'CHILD' },
      ],
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(request);
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(legacyGuests);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    // Stored names and categories restore; age/sex values stay stored but hidden.
    expect(await screen.findByDisplayValue('Old Guest')).toBeInTheDocument();
    expect(screen.getByLabelText('Guest 1 name')).toHaveValue('Old Guest');
    expect(screen.getByLabelText('Guest 2 name')).toHaveValue('Young Guest');
    expect(screen.queryByLabelText('Guest 1 age')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Guest 1 sex')).not.toBeInTheDocument();
    expect(screen.queryByText('Age')).not.toBeInTheDocument();
    expect(screen.queryByText('Sex')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith(`/hotel-vouchers/${draftVoucher.id}`) && options?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
    });
  });

  it('restores all seven saved guest names in order when editing', async () => {
    const names = [
      'Mr. Himanshu Rajbhar',
      'Mr. Akash Sahni',
      'Mr. Vivek Lodhi',
      'Mrs. Pinki Patel',
      'Lalu prasad',
      'krish',
      'op rajbhar',
    ];
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
    const sevenGuests = {
      ...draftVoucher,
      adults: 4,
      children: 3,
      hotelId: 'a664a7da-da50-4727-bddc-02ff8eef2cb9',
      hotelName: 'Hotel Boss Singapore',
      guests: names.map((guestName, index) => ({
        id: `g-${index + 1}`,
        guestName,
        age: null,
        sex: index === 3 ? 'F' : 'M',
        paxType: index < 4 ? 'ADULT' : 'CHILD',
      })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels/') && !url.includes('?')) return response(masterHotel);
        if (url.includes('/masters/hotels')) return response(page([masterHotel]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        // Voucher resolves after lookups (slow-network order), as in production.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return response(sevenGuests);
      }),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    // Wait for the full hydrated set so pre-load blank rows are settled.
    await screen.findByDisplayValue('op rajbhar');
    for (const [index, guestName] of names.entries()) {
      expect(screen.getByLabelText(`Guest ${index + 1} name`)).toHaveValue(guestName);
    }
    expect(screen.getByText('Adult 4')).toBeInTheDocument();
    expect(screen.getByText('Child 3')).toBeInTheDocument();
  });

  it('keeps saved guest names when counts change during editing', async () => {
    const sevenGuests = {
      ...draftVoucher,
      adults: 4,
      children: 3,
      guests: [
        { id: 'g-1', guestName: 'Adult One', age: null, sex: 'M', paxType: 'ADULT' },
        { id: 'g-2', guestName: 'Adult Two', age: null, sex: 'M', paxType: 'ADULT' },
        { id: 'g-3', guestName: 'Adult Three', age: null, sex: 'M', paxType: 'ADULT' },
        { id: 'g-4', guestName: 'Adult Four', age: null, sex: 'M', paxType: 'ADULT' },
        { id: 'g-5', guestName: 'Child One', age: null, sex: 'M', paxType: 'CHILD' },
        { id: 'g-6', guestName: 'Child Two', age: null, sex: 'M', paxType: 'CHILD' },
        { id: 'g-7', guestName: 'Child Three', age: null, sex: 'M', paxType: 'CHILD' },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(sevenGuests);
      }),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    await screen.findByDisplayValue('Child Three');
    // Shrinking children drops trailing entries only; kept names survive.
    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '1' } });
    await waitFor(() => expect(screen.queryByLabelText('Guest 7 name')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Guest 1 name')).toHaveValue('Adult One');
    expect(screen.getByLabelText('Guest 5 name')).toHaveValue('Child One');
    // Growing again appends blanks without touching kept names.
    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByLabelText('Guest 6 name')).toBeInTheDocument());
    expect(screen.getByLabelText('Guest 6 name')).toHaveValue('');
    expect(screen.getByLabelText('Guest 1 name')).toHaveValue('Adult One');
  });

  it('creates a voucher with package includes and drops blank items', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });

    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    setEditorHtml('Package include 1 item', '<p>Breakfast</p>');
    // Formatted content is preserved verbatim in its own row.
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    setEditorHtml('Package include 2 item', '<p><strong>Pool</strong> access</p>');
    await userEvent.click(screen.getByRole('button', { name: 'Add Item' }));
    setEditorHtml('Package include 3 item', '<p><br></p>');

    // A markup-only blank row is dropped silently instead of blocking submit.
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.packageIncludes).toEqual(['<p>Breakfast</p>', '<p><strong>Pool</strong> access</p>']);
  });

  it('generates guest rows from adults and children counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      }),
    );
    renderRoutes('/hotel-vouchers/new');
    await screen.findByLabelText('Guest Name');
    // Defaults (1 adult, 0 children) yield a single adult row.
    expect(screen.getByText('Adult 1')).toBeInTheDocument();
    expect(screen.queryByText(/Child 1/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '3' } });
    await waitFor(() => expect(screen.getByLabelText('Guest 7 name')).toBeInTheDocument());
    for (const label of ['Adult 1', 'Adult 2', 'Adult 3', 'Adult 4', 'Child 1', 'Child 2', 'Child 3']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Reducing children drops entries from the end of that category only.
    await userEvent.type(screen.getByLabelText('Guest 7 name'), 'Youngest');
    fireEvent.change(screen.getByLabelText('Children'), { target: { value: '1' } });
    await waitFor(() =>
      expect(screen.queryByLabelText('Guest 6 name')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Guest 5 name')).toBeInTheDocument();
    expect(screen.queryByText('Child 2')).not.toBeInTheDocument();
  });

  it('clears all guest rows when both counts are zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      }),
    );
    renderRoutes('/hotel-vouchers/new');
    await screen.findByLabelText('Guest Name');
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '0' } });
    await waitFor(() =>
      expect(screen.queryByLabelText('Guest 1 name')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('Adult 1')).not.toBeInTheDocument();
  });

  it('preserves typed guest details when counts change', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByLabelText('Guest 2 name')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'First Adult');
    await userEvent.type(screen.getByLabelText('Guest 2 name'), 'Second Adult');
    // Growing the count appends a blank row without touching typed rows.
    fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '3' } });
    await waitFor(() => expect(screen.getByLabelText('Guest 3 name')).toBeInTheDocument());
    expect(screen.getByLabelText('Guest 1 name')).toHaveValue('First Adult');
    expect(screen.getByLabelText('Guest 2 name')).toHaveValue('Second Adult');
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    // Named travellers persist with their category; the blank row is dropped.
    expect(body.guests).toEqual([
      expect.objectContaining({ guestName: 'First Adult', paxType: 'ADULT' }),
      expect.objectContaining({ guestName: 'Second Adult', paxType: 'ADULT' }),
    ]);
  });

  it('saves the booking id alongside the confirmation number', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });
    await userEvent.type(screen.getByLabelText('Confirmation Number'), 'CONF-1');
    await userEvent.type(screen.getByLabelText('Booking ID'), 'BK-AGODA-7788');
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body).toMatchObject({ confirmationNumber: 'CONF-1', bookingId: 'BK-AGODA-7788' });
  });

  it('loads the saved booking id when editing a voucher', async () => {
    const withBookingId = { ...draftVoucher, bookingId: 'BK-AGODA-7788' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(withBookingId);
      }),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    expect(await screen.findByDisplayValue('BK-AGODA-7788')).toBeInTheDocument();
    expect(screen.getByLabelText('Booking ID')).toHaveValue('BK-AGODA-7788');
  });

  it('saves customized reference labels and reloads them on edit', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });
    fireEvent.change(screen.getByLabelText('Confirmation Number label'), {
      target: { value: 'Hotel Confirmation No.' },
    });
    fireEvent.change(screen.getByLabelText('Booking ID label'), {
      target: { value: 'Supplier Booking Reference' },
    });
    await userEvent.type(screen.getByLabelText('Confirmation Number'), 'CONF-1');
    await userEvent.type(screen.getByLabelText('Booking ID'), 'BK-AGODA-7788');
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body).toMatchObject({
      confirmationNumber: 'CONF-1',
      confirmationNumberLabel: 'Hotel Confirmation No.',
      bookingId: 'BK-AGODA-7788',
      bookingIdLabel: 'Supplier Booking Reference',
    });

    // Reloading the saved voucher restores custom labels, not placeholders.
    const withLabels = {
      ...draftVoucher,
      confirmationNumberLabel: 'Hotel Confirmation No.',
      bookingIdLabel: 'Supplier Booking Reference',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(withLabels);
      }),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    expect(await screen.findByDisplayValue('Hotel Confirmation No.')).toBeInTheDocument();
    expect(screen.getByLabelText('Booking ID label')).toHaveValue('Supplier Booking Reference');
  });

  it('saves formatted terms and reloads them when editing the draft', async () => {
    const withTerms = {
      ...draftVoucher,
      termsSnapshot: '<p>Non-refundable after <strong>check-in</strong>.</p>',
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
        return response({ ...draftVoucher, id: 'new-id' });
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes('/hotel-vouchers/new');
    await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });
    setEditorHtml(
      'Terms & Conditions',
      '<p>Non-refundable after <strong>check-in</strong>.</p><ul><li>No smoking</li></ul>',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body)).termsSnapshot).toContain(
      'Non-refundable after <strong>check-in</strong>.',
    );

    // Editing the saved draft reloads the formatted terms into the editor.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(withTerms)),
    );
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    const editor = await screen.findByLabelText('Terms & Conditions');
    await waitFor(() => expect(editor.innerHTML).toContain('<strong>check-in</strong>'));
  });

  it('edits saved package includes and shows them on details', async () => {
    const withIncludes = { ...draftVoucher, packageIncludes: ['Breakfast', 'Pool', 'Wifi'] };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'PATCH') return response(withIncludes);
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(withIncludes);
    });
    vi.stubGlobal('fetch', fetchMock);
    // Details renders the saved includes list.
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
    expect(screen.getByText('Package Includes')).toBeInTheDocument();
    expect(screen.getByText('Wifi')).toBeInTheDocument();
  });

  it('edits and removes saved package items on edit', async () => {
    const withIncludes = { ...draftVoucher, packageIncludes: ['Breakfast', 'Pool', 'Wifi'] };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'PATCH') return response(withIncludes);
      if (url.includes('/masters/hotels/') && !url.includes('?')) return response(hotelMaster);
      if (url.includes('/masters/hotels')) return response(page([hotelMaster]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(withIncludes);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    const poolEditor = await screen.findByLabelText('Package include 2 item');
    await waitFor(() => expect(poolEditor.textContent).toBe('Pool'));
    // Edit one item, remove another.
    setEditorHtml('Package include 1 item', '<p><strong>Lunch</strong></p>');
    await userEvent.click(screen.getByRole('button', { name: 'Remove package item 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    // Untouched rows keep their saved plain-text value; only the edited row
    // carries editor markup.
    expect(JSON.parse(String(patch?.[1]?.body)).packageIncludes).toEqual([
      '<p><strong>Lunch</strong></p>',
      'Pool',
    ]);
  });

  it('edits and removes saved rows, and shows them on details', async () => {
    const withRows = {
      ...draftVoucher,
      pricing: [
        {
          id: 'p-1',
          sequence: 0,
          roomType: 'Single Room',
          unit: 1,
          quantity: 2,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
      ],
      guests: [
        { id: 'g-1', sequence: 0, guestName: 'Dilip Vaid', age: 63, sex: 'M', paxType: 'ADULT' },
      ],
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/masters/hotels')) return response(page([]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(withRows);
    });
    vi.stubGlobal('fetch', fetchMock);
    // Details renders both saved tables with the computed total.
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}`);
    expect(await screen.findByText('Hotel Voucher HV-000001')).toBeInTheDocument();
    expect(screen.getByText('Single Room')).toBeInTheDocument();
    expect(screen.getByText('Dilip Vaid')).toBeInTheDocument();
    expect(screen.getByText(/Total Payable Amount: 19,883/)).toBeInTheDocument();
  });

  it('opens a saved priced voucher for edit without pricing UI and preserves its rows', async () => {
    const withRows = {
      ...draftVoucher,
      pricing: [
        {
          id: 'p-1',
          sequence: 0,
          roomType: 'Single Room',
          unit: 1,
          quantity: 2,
          gst: 18,
          amount: 16850,
          taxablePay: 16850,
          gstService: 19883,
        },
      ],
      guests: [],
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'PATCH') return response(withRows);
      if (url.includes('/masters/hotels/') && !url.includes('?')) return response(hotelMaster);
      if (url.includes('/masters/hotels')) return response(page([hotelMaster]));
      if (url.includes('/customers')) return response(page([]));
      if (url.includes('/queries')) return response(page([]));
      return response(withRows);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Shah Palace Hotel'),
    );
    // Stored pricing stays stored but hidden: no section, no row UI.
    expect(screen.queryByText('Pricing (Optional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Pricing Row' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove pricing row 1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    // The payload carries no pricing key, so the saved rows are retained
    // server-side instead of being wiped.
    expect(JSON.parse(String(patch?.[1]?.body))).not.toHaveProperty('pricing');
  });

  describe('From Quotation', () => {
    const quotationHotelA = {
      id: 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa',
      hotelId: hotelMaster.id,
      hotelName: 'Shah Palace Hotel',
      city: 'Jaipur',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      rooms: 2,
      checkInDate: '2026-11-10T00:00:00.000Z',
      checkOutDate: '2026-11-14T00:00:00.000Z',
    };
    const quotationHotelB = {
      id: 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb',
      hotelId: null,
      hotelName: 'Lakeview Resort',
      city: 'Udaipur',
      roomType: null,
      mealPlan: null,
      rooms: null,
      checkInDate: null,
      checkOutDate: null,
    };
    const quotationOne = {
      id: 'c0ffee00-0000-4000-8000-000000000001',
      quotationNumber: 'QT-000123',
      queryId: 'c0ffee00-0000-4000-8000-000000000011',
      customer: null,
      currentVersionId: 'c0ffee00-0000-4000-8000-000000000021',
      status: 'DRAFT',
      customerName: 'Mohan Kumar',
      customerEmail: 'mohan@example.test',
      customerPhone: '+91 91111 11111',
      destinationSummary: 'Singapore',
      adults: 2,
      childrenWithBed: 1,
      childrenWithoutBed: 0,
      rooms: 2,
      versions: [
        {
          id: 'c0ffee00-0000-4000-8000-000000000021',
          hotels: [quotationHotelA, quotationHotelB],
        },
      ],
    };
    const quotationTwo = {
      ...quotationOne,
      id: 'c0ffee00-0000-4000-8000-000000000002',
      quotationNumber: 'QT-000456',
      customerName: 'Second Traveller',
      customerEmail: 'second@example.test',
      customerPhone: '+91 92222 22222',
      versions: [
        {
          id: 'c0ffee00-0000-4000-8000-000000000022',
          hotels: [
            {
              ...quotationHotelB,
              id: 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbc',
              hotelName: 'Hillside Inn',
              city: 'Munnar',
            },
          ],
        },
      ],
    };
    const quotationEmpty = {
      ...quotationOne,
      id: 'c0ffee00-0000-4000-8000-000000000003',
      quotationNumber: 'QT-000789',
      versions: [{ id: 'c0ffee00-0000-4000-8000-000000000023', hotels: [] }],
    };

    function stubQuotationFlow(
      detailsById: Record<string, unknown>,
      listRows: unknown[] = [quotationOne, quotationTwo],
    ) {
      return vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
        void _init;
        const url = String(request);
        if (url.includes('/masters/hotels/') && !url.includes('?')) return response(hotelMaster);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        const detailsMatch = url.match(/\/quotations\/([0-9a-f-]{36})(?:[?]|$)/);
        if (detailsMatch) return response(detailsById[detailsMatch[1]!] ?? null);
        if (url.includes('/quotations')) return response(page(listRows));
        return response(page([]));
      });
    }

    /** Values of the datalist backing a MasterSelect input. */
    function datalistValues(ariaLabel: string): string[] {
      const input = screen.getByLabelText(ariaLabel);
      const listId = input.getAttribute('list');
      if (!listId) return [];
      const list = document.getElementById(listId);
      if (!list) return [];
      return Array.from(list.querySelectorAll('option')).map(
        (option) => option.getAttribute('value') ?? '',
      );
    }

    function grantQuotationsView() {
      auth.permissions = new Set([...ALL, 'quotations.view']);
    }

    it('hides the quotation section without the quotations view permission', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(page([]))),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Hotel Name');
      expect(screen.queryByLabelText('Quotation ID')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Select Hotel')).not.toBeInTheDocument();
    });

    it('lists quotations with number, customer, and destination, and prefills on select', async () => {
      grantQuotationsView();
      const fetchMock = stubQuotationFlow({ [quotationOne.id]: quotationOne });
      vi.stubGlobal('fetch', fetchMock);
      renderRoutes('/hotel-vouchers/new');
      const picker = await screen.findByLabelText('Quotation ID');
      // Select Hotel stays disabled until a quotation is chosen.
      expect(screen.getByLabelText('Select Hotel')).toBeDisabled();
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes('/quotations?')),
        ).toBe(true),
      );
      // Options identify the quotation by number + customer + destination.
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000123'),
      );
      const quotationList = document.getElementById(
        screen.getByLabelText('Quotation ID').getAttribute('list') ?? '',
      );
      expect(quotationList?.textContent).toContain('Mohan Kumar · Singapore');
      fireEvent.change(picker, { target: { value: 'QT-000123' } });
      // Lead/guest facts come from the quotation's saved customer snapshot.
      await waitFor(() => expect(screen.getByLabelText('Guest Name')).toHaveValue('Mohan Kumar'));
      expect(screen.getByLabelText('Guest Phone')).toHaveValue('+91 91111 11111');
      expect(screen.getByLabelText('Guest Email')).toHaveValue('mohan@example.test');
      expect(screen.getByLabelText('Adults')).toHaveValue(2);
      expect(screen.getByLabelText('Children')).toHaveValue(1);
      expect(screen.getByLabelText('No. of Rooms')).toHaveValue(2);
      // Quotation-prefilled counts generate blank traveller rows (2+1).
      await waitFor(() => expect(screen.getByLabelText('Guest 3 name')).toBeInTheDocument());
      expect(screen.getByText('Adult 1')).toBeInTheDocument();
      expect(screen.getByText('Adult 2')).toBeInTheDocument();
      expect(screen.getByText('Child 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Guest 1 name')).toHaveValue('');
      // Both hotel entries of the version are offered, with stay dates
      // shown as DD-MM-YYYY.
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toEqual(
          expect.arrayContaining(['Shah Palace Hotel', 'Lakeview Resort']),
        ),
      );
      const hotelList = document.getElementById(
        screen.getByLabelText('Select Hotel').getAttribute('list') ?? '',
      );
      expect(hotelList?.textContent).toContain('Jaipur · Deluxe · 10-11-2026');
      expect(hotelList?.textContent).not.toContain('2026-11-10');
      expect(screen.getByLabelText('Select Hotel')).not.toBeDisabled();
    });

    it('populates hotel and stay details from the selected quotation hotel', async () => {
      grantQuotationsView();
      vi.stubGlobal('fetch', stubQuotationFlow({ [quotationOne.id]: quotationOne }));
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000123'),
      );
      fireEvent.change(await screen.findByLabelText('Quotation ID'), {
        target: { value: 'QT-000123' },
      });
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toContain('Shah Palace Hotel'),
      );
      fireEvent.change(screen.getByLabelText('Select Hotel'), {
        target: { value: 'Shah Palace Hotel' },
      });
      await waitFor(() =>
        expect(screen.getByLabelText('Hotel City')).toHaveValue('Jaipur'),
      );
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Shah Palace Hotel');
      // Legacy scalar-only option contributes one stay row and one meal row.
      expect(screen.getByLabelText('Stay room 1 type')).toHaveValue('Deluxe');
      expect(screen.getByLabelText('Stay room 1 rooms')).toHaveValue(2);
      expect(screen.getByLabelText('Stay meal 1 plan')).toHaveValue('Breakfast');
      expect(screen.getByLabelText('Check-in')).toHaveValue('2026-11-10');
      expect(screen.getByLabelText('Check-out')).toHaveValue('2026-11-14');
      expect(screen.getByLabelText('No. of Rooms')).toHaveValue(2);
      // Master-linked contact fields arrive through the hotel snapshot.
      await waitFor(() =>
        expect(screen.getByLabelText('Hotel Address')).toHaveValue('Palace Road, Jaipur'),
      );
      expect(screen.getByLabelText('Hotel Phone')).toHaveValue('+91 14100 00000');
      // No confirmation number is ever invented.
      expect(screen.getByLabelText('Confirmation Number')).toHaveValue('');
    });

    it('leaves voucher dates blank for a quotation hotel option without stay dates', async () => {
      grantQuotationsView();
      vi.stubGlobal('fetch', stubQuotationFlow({ [quotationOne.id]: quotationOne }));
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000123'),
      );
      fireEvent.change(await screen.findByLabelText('Quotation ID'), {
        target: { value: 'QT-000123' },
      });
      // Lakeview Resort is the version entry with null check-in/check-out dates.
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toContain('Lakeview Resort'),
      );
      fireEvent.change(screen.getByLabelText('Select Hotel'), {
        target: { value: 'Lakeview Resort' },
      });
      await waitFor(() =>
        expect(screen.getByLabelText('Hotel City')).toHaveValue('Udaipur'),
      );
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Lakeview Resort');
      // Missing quotation dates stay blank — no fabricated date is inserted —
      // and the user can type them manually afterwards.
      expect(screen.getByLabelText('Check-in')).toHaveValue('');
      expect(screen.getByLabelText('Check-out')).toHaveValue('');
      fireEvent.change(screen.getByLabelText('Check-in'), {
        target: { value: '2026-12-01' },
      });
      expect(screen.getByLabelText('Check-in')).toHaveValue('2026-12-01');
      expect(screen.getByLabelText('Check-out')).toHaveValue('');
    });

    it('imports every room configuration and meal plan from the selected hotel option', async () => {
      const multiRoomHotel = {
        id: 'cccccccc-cccc-4111-8111-cccccccccccc',
        hotelId: null,
        hotelName: 'Grand Plaza Hotel',
        city: 'Singapore',
        roomType: 'Superior Room',
        mealPlan: 'Breakfast only',
        rooms: 6,
        checkInDate: '2026-11-01T00:00:00.000Z',
        checkOutDate: '2026-11-07T00:00:00.000Z',
        roomLines: [
          {
            hotelRoomTypeId: null,
            roomType: 'Superior Room',
            rooms: 2,
            extraBedQuantity: 1,
            childWithoutBedQuantity: 0,
            notes: 'High floor',
          },
          {
            hotelRoomTypeId: null,
            roomType: 'Premier Room',
            rooms: 4,
            extraBedQuantity: 0,
            childWithoutBedQuantity: 1,
            notes: null,
          },
        ],
        mealPlanLines: [{ mealPlan: 'Breakfast only' }, { mealPlan: 'Dinner' }],
      };
      const quotationMulti = {
        ...quotationOne,
        id: 'c0ffee00-0000-4000-8000-000000000031',
        quotationNumber: 'QT-000777',
        versions: [
          {
            id: 'c0ffee00-0000-4000-8000-000000000041',
            hotels: [multiRoomHotel],
          },
        ],
      };
      grantQuotationsView();
      const fetchMock = stubQuotationFlow(
        { [quotationMulti.id]: quotationMulti },
        [quotationMulti],
      );
      vi.stubGlobal('fetch', fetchMock);
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000777'),
      );
      fireEvent.change(await screen.findByLabelText('Quotation ID'), {
        target: { value: 'QT-000777' },
      });
      // Single-hotel quotation: the option is auto-selected and every room
      // configuration plus every meal plan is imported, in saved order. The
      // quotation's extra-bed / child-without-bed counts are ignored, never
      // imported — the voucher keeps type, quantity, and remark only.
      await waitFor(() =>
        expect(screen.getByLabelText('Stay room 1 type')).toHaveValue('Superior Room'),
      );
      expect(screen.getByLabelText('Stay room 1 rooms')).toHaveValue(2);
      expect(screen.getByLabelText('Stay room 1 remark')).toHaveValue('High floor');
      expect(screen.getByLabelText('Stay room 2 type')).toHaveValue('Premier Room');
      expect(screen.getByLabelText('Stay room 2 rooms')).toHaveValue(4);
      expect(screen.getByLabelText('Stay room 2 remark')).toHaveValue('');
      // Extra Bed and Child w/o Bed are gone from the form entirely.
      expect(screen.queryByText('Extra Bed')).not.toBeInTheDocument();
      expect(screen.queryByText('Child w/o Bed')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 1 extra beds')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 1 children without bed')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 2 extra beds')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 2 children without bed')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 3 type')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Stay meal 1 plan')).toHaveValue('Breakfast only');
      expect(screen.getByLabelText('Stay meal 2 plan')).toHaveValue('Dinner');
      expect(screen.queryByLabelText('Stay meal 3 plan')).not.toBeInTheDocument();
      // Total, dates, and nights stay consistent with the quotation option.
      expect(screen.getByLabelText('No. of Rooms')).toHaveValue(6);
      expect(screen.getByLabelText('Check-in')).toHaveValue('2026-11-01');
      expect(screen.getByLabelText('Check-out')).toHaveValue('2026-11-07');
      expect(screen.getByText('Nights: 6')).toBeInTheDocument();
      // Saving persists every entry plus the scalar mirrors.
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
        );
        expect(post).toBeDefined();
      });
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.stayRooms).toHaveLength(2);
      expect(body.stayRooms[0]).toMatchObject({ roomType: 'Superior Room', rooms: 2 });
      expect(body.stayRooms[1]).toMatchObject({ roomType: 'Premier Room', rooms: 4 });
      // The removed fields are never submitted, even though the quotation
      // source rows carried them.
      for (const row of body.stayRooms) {
        expect(row).not.toHaveProperty('extraBedQuantity');
        expect(row).not.toHaveProperty('childWithoutBedQuantity');
      }
      expect(body.stayMeals.map((row: { mealPlan: string }) => row.mealPlan)).toEqual([
        'Breakfast only',
        'Dinner',
      ]);
      expect(body.rooms).toBe(6);
      expect(body.roomTypeName).toBe('Superior Room');
      expect(body.mealPlanName).toBe('Breakfast only');
      expect(body.checkIn).toBe('2026-11-01');
      expect(body.checkOut).toBe('2026-11-07');
    });

    it('lets manual vouchers add stay rows without a quotation', async () => {
      const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
          return response({ ...draftVoucher, id: 'new-id' });
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(page([]));
      });
      vi.stubGlobal('fetch', fetchMock);
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Hotel Name');
      // Empty stay tables offer add actions instead of scalar fields.
      expect(screen.queryByLabelText('Room Type')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Meal Plan')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Add Room' }));
      await userEvent.type(screen.getByLabelText('Stay room 1 type'), 'Suite');
      fireEvent.change(screen.getByLabelText('Stay room 1 rooms'), { target: { value: '2' } });
      // The rooms table is only type / quantity / remark / actions now.
      expect(screen.queryByText('Extra Bed')).not.toBeInTheDocument();
      expect(screen.queryByText('Child w/o Bed')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 1 extra beds')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 1 children without bed')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Add Meal Plan' }));
      await userEvent.type(screen.getByLabelText('Stay meal 1 plan'), 'Half Board');
      await userEvent.type(screen.getByLabelText('Guest Name'), 'Aarav Mehta');
      await userEvent.type(screen.getByLabelText('Hotel Name'), 'Shah Palace Hotel');
      fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-10' } });
      fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-13' } });
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
        );
        expect(post).toBeDefined();
      });
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.stayRooms).toEqual([
        expect.objectContaining({ roomType: 'Suite', rooms: 2 }),
      ]);
      expect(body.stayMeals).toEqual([expect.objectContaining({ mealPlan: 'Half Board' })]);
      expect(body.roomTypeName).toBe('Suite');
      expect(body.mealPlanName).toBe('Half Board');
    });

    it('restores saved stay rows on edit and keeps them on save', async () => {
      // Legacy rows may still carry the removed values; the edit form loads
      // the voucher (type, quantity, remark) and never shows the old fields.
      const withStay = {
        ...draftVoucher,
        rooms: 6,
        roomTypeName: 'Superior Room',
        mealPlanName: 'Breakfast only',
        stayRooms: [
          { id: 'r-1', sequence: 0, roomType: 'Superior Room', rooms: 2, extraBedQuantity: 1, childWithoutBedQuantity: 0, notes: 'High floor' },
          { id: 'r-2', sequence: 1, roomType: 'Premier Room', rooms: 4, extraBedQuantity: 0, childWithoutBedQuantity: 1, notes: null },
        ],
        stayMeals: [
          { id: 'm-1', sequence: 0, mealPlan: 'Breakfast only' },
          { id: 'm-2', sequence: 1, mealPlan: 'Dinner' },
        ],
      };
      const fetchMock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
        void _init;
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        return response(withStay);
      });
      vi.stubGlobal('fetch', fetchMock);
      renderRoutes(`/hotel-vouchers/${draftVoucher.id}/edit`);
      await waitFor(() =>
        expect(screen.getByLabelText('Stay room 2 type')).toHaveValue('Premier Room'),
      );
      expect(screen.getByLabelText('Stay room 1 type')).toHaveValue('Superior Room');
      expect(screen.getByLabelText('Stay room 1 rooms')).toHaveValue(2);
      expect(screen.getByLabelText('Stay room 1 remark')).toHaveValue('High floor');
      expect(screen.queryByLabelText('Stay room 1 extra beds')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay room 2 children without bed')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Stay meal 1 plan')).toHaveValue('Breakfast only');
      expect(screen.getByLabelText('Stay meal 2 plan')).toHaveValue('Dinner');
      await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
        expect(patch).toBeDefined();
      });
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      const body = JSON.parse(String(patch?.[1]?.body));
      expect(body.stayRooms).toHaveLength(2);
      expect(body.stayRooms[0]).toMatchObject({ roomType: 'Superior Room', rooms: 2 });
      expect(body.stayRooms[1]).toMatchObject({ roomType: 'Premier Room', rooms: 4 });
      for (const row of body.stayRooms) {
        expect(row).not.toHaveProperty('extraBedQuantity');
        expect(row).not.toHaveProperty('childWithoutBedQuantity');
      }
      expect(body.stayMeals.map((row: { mealPlan: string }) => row.mealPlan)).toEqual([
        'Breakfast only',
        'Dinner',
      ]);
      expect(body.rooms).toBe(6);
    });

    it('populates exact quotation calendar dates and follows hotel switching', async () => {
      const novemberA = {
        ...quotationHotelA,
        id: 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaab',
        hotelName: 'November Alpha',
        // Midnight-UTC ISO date-times: the voucher must keep these calendar
        // days exactly, never shifted by timezone handling.
        checkInDate: '2026-11-01T00:00:00.000Z',
        checkOutDate: '2026-11-04T00:00:00.000Z',
      };
      const novemberB = {
        ...quotationHotelB,
        id: 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbd',
        hotelName: 'November Beta',
        city: 'Udaipur',
        checkInDate: '2026-11-05T00:00:00.000Z',
        checkOutDate: '2026-11-07T00:00:00.000Z',
      };
      const quotationNovember = {
        ...quotationOne,
        id: 'c0ffee00-0000-4000-8000-000000000011',
        quotationNumber: 'QT-000111',
        versions: [
          {
            id: 'c0ffee00-0000-4000-8000-000000000031',
            hotels: [novemberA, novemberB],
          },
        ],
      };
      grantQuotationsView();
      vi.stubGlobal(
        'fetch',
        stubQuotationFlow({ [quotationNovember.id]: quotationNovember }, [quotationNovember]),
      );
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000111'),
      );
      fireEvent.change(await screen.findByLabelText('Quotation ID'), {
        target: { value: 'QT-000111' },
      });
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toContain('November Alpha'),
      );
      fireEvent.change(screen.getByLabelText('Select Hotel'), {
        target: { value: 'November Alpha' },
      });
      // Exact calendar dates from the selected option; three-night stay.
      await waitFor(() =>
        expect(screen.getByLabelText('Check-in')).toHaveValue('2026-11-01'),
      );
      expect(screen.getByLabelText('Check-out')).toHaveValue('2026-11-04');
      expect(screen.getByText('Nights: 3')).toBeInTheDocument();
      // Switching options re-reads dates from the newly selected entry.
      fireEvent.change(screen.getByLabelText('Select Hotel'), {
        target: { value: 'November Beta' },
      });
      await waitFor(() =>
        expect(screen.getByLabelText('Check-in')).toHaveValue('2026-11-05'),
      );
      expect(screen.getByLabelText('Check-out')).toHaveValue('2026-11-07');
      expect(screen.getByText('Nights: 2')).toBeInTheDocument();
    });

    it('auto-selects the only hotel of a single-hotel quotation without dropdown interaction', async () => {
      grantQuotationsView();
      vi.stubGlobal(
        'fetch',
        stubQuotationFlow({ [quotationTwo.id]: quotationTwo }, [quotationTwo]),
      );
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000456'),
      );
      fireEvent.change(screen.getByLabelText('Quotation ID'), {
        target: { value: 'QT-000456' },
      });
      // Guest facts prefill and the single hotel is selected automatically.
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Second Traveller'),
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Select Hotel')).toHaveValue('Hillside Inn'),
      );
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Hillside Inn');
      expect(screen.getByLabelText('Hotel City')).toHaveValue('Munnar');
      // Master-less entry: contact fields stay blank, never fabricated.
      expect(screen.getByLabelText('Hotel Address')).toHaveValue('');
      expect(screen.getByLabelText('Hotel Phone')).toHaveValue('');
    });

    it('changing the quotation clears the hotel selection, reverts untouched fields, keeps edits', async () => {      grantQuotationsView();
      vi.stubGlobal(
        'fetch',
        stubQuotationFlow({ [quotationOne.id]: quotationOne, [quotationTwo.id]: quotationTwo }),
      );
      renderRoutes('/hotel-vouchers/new');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000123'),
      );
      fireEvent.change(await screen.findByLabelText('Quotation ID'), {
        target: { value: 'QT-000123' },
      });
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toContain('Shah Palace Hotel'),
      );
      fireEvent.change(screen.getByLabelText('Select Hotel'), {
        target: { value: 'Shah Palace Hotel' },
      });
      await waitFor(() => expect(screen.getByLabelText('Stay room 1 type')).toHaveValue('Deluxe'));
      // Manual edit that must survive the quotation change.
      fireEvent.change(screen.getByLabelText('Hotel Name'), { target: { value: 'Custom Name' } });
      fireEvent.change(screen.getByLabelText('Quotation ID'), { target: { value: 'QT-000456' } });
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Second Traveller'),
      );
      // The single hotel of the new quotation is auto-selected (not left
      // cleared); untouched hotel facts now reflect the new hotel. The new
      // entry carries no rooms or meals, so the previous stay rows revert
      // instead of leaking.
      await waitFor(() =>
        expect(screen.getByLabelText('Select Hotel')).toHaveValue('Hillside Inn'),
      );
      expect(screen.getByLabelText('Hotel City')).toHaveValue('Munnar');
      expect(screen.queryByLabelText('Stay room 1 type')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stay meal 1 plan')).not.toBeInTheDocument();
      // The manual edit survives.
      expect(screen.getByLabelText('Hotel Name')).toHaveValue('Custom Name');
      // New quotation's hotel entry is offered instead.
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toContain('Hillside Inn'),
      );
    });

    it('shows an empty state when the quotation has no hotel entries', async () => {
      grantQuotationsView();
      vi.stubGlobal(
        'fetch',
        stubQuotationFlow({ [quotationEmpty.id]: quotationEmpty }, [quotationEmpty]),
      );
      renderRoutes('/hotel-vouchers/new');
      const picker = await screen.findByLabelText('Quotation ID');
      await waitFor(() =>
        expect(datalistValues('Quotation ID')).toContain('QT-000789'),
      );
      fireEvent.change(picker, { target: { value: 'QT-000789' } });
      expect(
        await screen.findByText('This quotation has no hotel entries. Fill the hotel details manually below.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Select Hotel')).toHaveValue('');
    });
  });

  describe('Edit guest hydration (no-refresh)', () => {
    // Mirrors HV-000024: 7 adults + 3 children, 10 saved names in order.
    const adultNames = [
      'Pintu Shah',
      'Rohan Mehta',
      'Kiran Rao',
      'Pinki Patel',
      'Lalu Yadav',
      'Krish Iyer',
      'Raj Bhar',
    ];
    const childNames = ['Asha Nair', 'Dev Kumar', 'Mira Rider'];
    const voucherA = {
      ...draftVoucher,
      id: 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa',
      voucherNumber: 'HV-000024',
      adults: 7,
      children: 3,
      guests: [
        ...adultNames.map((guestName, index) => ({
          id: `a-guest-${index + 1}`,
          guestName,
          age: null,
          sex: 'M',
          paxType: 'ADULT',
        })),
        ...childNames.map((guestName, index) => ({
          id: `a-child-${index + 1}`,
          guestName,
          age: null,
          sex: 'F',
          paxType: 'CHILD',
        })),
      ],
    };
    const voucherB = {
      ...draftVoucher,
      id: 'bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb',
      voucherNumber: 'HV-000025',
      adults: 1,
      children: 1,
      guests: [
        { id: 'b-guest-1', guestName: 'Beta Adult', age: null, sex: 'M', paxType: 'ADULT' },
        { id: 'b-guest-2', guestName: 'Beta Child', age: null, sex: 'F', paxType: 'CHILD' },
      ],
    };
    const voucherById: Record<string, unknown> = {
      [voucherA.id]: voucherA,
      [voucherB.id]: voucherB,
    };

    function stubVoucherFlow() {
      return vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        const match = url.match(/\/hotel-vouchers\/([0-9a-f-]{36})(?:[?]|$)/);
        if (match) return response(voucherById[match[1]!] ?? null);
        return response(page([]));
      });
    }

    function expectGuestNames(names: string[]) {
      names.forEach((name, index) => {
        expect(screen.getByLabelText(`Guest ${index + 1} name`)).toHaveValue(name);
      });
    }

    it('hydrates every saved guest name when navigating to Edit without refresh', async () => {
      vi.stubGlobal('fetch', stubVoucherFlow());
      // Details first: warms the shared voucher query cache, exactly like
      // list → detail → Edit navigation in production.
      renderRoutes(`/hotel-vouchers/${voucherA.id}`);
      expect(await screen.findByText('Hotel Voucher HV-000024')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Edit' }));
      // All 10 names appear immediately — no refresh, no blank rows.
      await waitFor(() => expect(screen.getByLabelText('Guest 10 name')).toBeInTheDocument());
      expectGuestNames([...adultNames, ...childNames]);
      expect(screen.queryByLabelText('Guest 11 name')).not.toBeInTheDocument();
    });

    it('hydrates every saved guest name on direct URL load', async () => {
      vi.stubGlobal('fetch', stubVoucherFlow());
      renderRoutes(`/hotel-vouchers/${voucherA.id}/edit`);
      await waitFor(() => expect(screen.getByLabelText('Guest 10 name')).toBeInTheDocument());
      expectGuestNames([...adultNames, ...childNames]);
      expect(screen.queryByLabelText('Guest 11 name')).not.toBeInTheDocument();
    });

    it('keeps restored names when counts grow after hydration', async () => {
      vi.stubGlobal('fetch', stubVoucherFlow());
      renderRoutes(`/hotel-vouchers/${voucherA.id}/edit`);
      await waitFor(() =>
        expect(screen.getByLabelText('Guest 10 name')).toHaveValue(childNames[2]),
      );
      fireEvent.change(screen.getByLabelText('Adults'), { target: { value: '8' } });
      await waitFor(() => expect(screen.getByLabelText('Guest 11 name')).toBeInTheDocument());
      // Adults stay first: the new blank adult lands at position 8 and the
      // restored children shift down intact — no name is lost or overwritten.
      adultNames.forEach((name, index) => {
        expect(screen.getByLabelText(`Guest ${index + 1} name`)).toHaveValue(name);
      });
      expect(screen.getByLabelText('Guest 8 name')).toHaveValue('');
      childNames.forEach((name, index) => {
        expect(screen.getByLabelText(`Guest ${index + 9} name`)).toHaveValue(name);
      });
    });

    it('switches vouchers without leaking guest rows', async () => {
      vi.stubGlobal('fetch', stubVoucherFlow());
      function SwitchHarness() {
        const navigate = useNavigate();
        return (
          <>
            <button type="button" onClick={() => navigate(`/hotel-vouchers/${voucherA.id}/edit`)}>
              Go voucher A
            </button>
            <button type="button" onClick={() => navigate(`/hotel-vouchers/${voucherB.id}/edit`)}>
              Go voucher B
            </button>
            <Routes>
              <Route path="/hotel-vouchers/:voucherId/edit" element={<HotelVoucherFormPage />} />
            </Routes>
          </>
        );
      }
      renderWithProviders(<SwitchHarness />, { route: `/hotel-vouchers/${voucherA.id}/edit` });
      await waitFor(() =>
        expect(screen.getByLabelText('Guest 10 name')).toHaveValue(childNames[2]),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Go voucher B' }));
      await waitFor(() => expect(screen.getByLabelText('Guest 1 name')).toHaveValue('Beta Adult'));
      expect(screen.getByLabelText('Guest 2 name')).toHaveValue('Beta Child');
      expect(screen.queryByLabelText('Guest 3 name')).not.toBeInTheDocument();
      // Back to A (now served from cache): all 10 names, no blanks, no B rows.
      await userEvent.click(screen.getByRole('button', { name: 'Go voucher A' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Guest 10 name')).toHaveValue(childNames[2]),
      );
      expectGuestNames([...adultNames, ...childNames]);
      expect(screen.queryByLabelText('Guest 11 name')).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('Beta Adult')).not.toBeInTheDocument();
    });
  });

  describe('Quotation autofill revalidation', () => {
    const rubyHotelDated = {
      id: 'dddddddd-dddd-4111-8111-dddddddddddd',
      hotelId: null,
      hotelName: 'Harbour View Resort',
      city: 'Kochi',
      roomType: 'Triple Room',
      mealPlan: null,
      rooms: 1,
      checkInDate: '2027-01-01T00:00:00.000Z',
      checkOutDate: '2027-01-03T00:00:00.000Z',
      roomLines: [{ roomType: 'Triple Room', rooms: 1 }],
      mealPlanLines: [],
    };
    const rubyHotelDateless = {
      id: 'eeeeeeee-eeee-4111-8111-eeeeeeeeeeee',
      hotelId: null,
      hotelName: 'City Inn Budget',
      city: 'Kochi',
      roomType: 'Standard Room',
      mealPlan: null,
      rooms: 1,
      checkInDate: null,
      checkOutDate: null,
      roomLines: [{ roomType: 'Standard Room', rooms: 1 }],
      mealPlanLines: [],
    };
    const quotationRuby = {
      id: 'c0ffee00-0000-4000-8000-000000000071',
      quotationNumber: 'QT-000555',
      queryId: 'c0ffee00-0000-4000-8000-000000000071',
      customer: null,
      currentVersionId: 'c0ffee00-0000-4000-8000-000000000081',
      status: 'DRAFT',
      customerName: 'Ruby jins',
      customerEmail: null,
      customerPhone: '9810202893',
      destinationSummary: 'Kerala',
      adults: 3,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      rooms: 1,
      versions: [
        {
          id: 'c0ffee00-0000-4000-8000-000000000081',
          hotels: [rubyHotelDated, rubyHotelDateless],
        },
      ],
    };
    const quotationShort = {
      ...quotationRuby,
      id: 'c0ffee00-0000-4000-8000-000000000072',
      quotationNumber: 'QT-000556',
      customerName: 'X',
      currentVersionId: 'c0ffee00-0000-4000-8000-000000000082',
      versions: [
        {
          id: 'c0ffee00-0000-4000-8000-000000000082',
          hotels: [{ ...rubyHotelDated, id: 'dddddddd-dddd-4111-8111-ddddddddddde' }],
        },
      ],
    };
    const quotationAlt = {
      ...quotationRuby,
      id: 'c0ffee00-0000-4000-8000-000000000073',
      quotationNumber: 'QT-000557',
      customerName: 'Arjun Nair',
      currentVersionId: 'c0ffee00-0000-4000-8000-000000000083',
      versions: [
        {
          id: 'c0ffee00-0000-4000-8000-000000000083',
          hotels: [
            {
              ...rubyHotelDated,
              id: 'dddddddd-dddd-4111-8111-dddddddddddf',
              checkInDate: '2027-02-10T00:00:00.000Z',
              checkOutDate: '2027-02-12T00:00:00.000Z',
            },
          ],
        },
      ],
    };

    function stubAutofillFlow(
      detailsById: Record<string, unknown>,
      listRows: unknown[],
    ) {
      return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (init?.method === 'POST' && url.endsWith('/hotel-vouchers'))
          return response({ id: 'new-voucher-id' });
        if (url.includes('/masters/hotels')) return response(page([]));
        if (url.includes('/customers')) return response(page([]));
        if (url.includes('/queries')) return response(page([]));
        const detailsMatch = url.match(/\/quotations\/([0-9a-f-]{36})(?:[?]|$)/);
        if (detailsMatch) return response(detailsById[detailsMatch[1]!] ?? null);
        if (url.includes('/quotations')) return response(page(listRows));
        return response(page([]));
      });
    }

    function hotelDatalist(): string[] {
      const input = screen.getByLabelText('Select Hotel');
      const list = document.getElementById(input.getAttribute('list') ?? '');
      if (!list) return [];
      return Array.from(list.querySelectorAll('option')).map(
        (option) => option.getAttribute('value') ?? '',
      );
    }

    async function pickQuotation(number: string) {
      const picker = await screen.findByLabelText('Quotation ID');
      await waitFor(() =>
        expect(
          Array.from(
            document
              .getElementById(picker.getAttribute('list') ?? '')
              ?.querySelectorAll('option') ?? [],
          ).map((option) => option.getAttribute('value')),
        ).toContain(number),
      );
      fireEvent.change(picker, { target: { value: number } });
    }

    async function pickHotel(name: string) {
      await waitFor(() => expect(hotelDatalist()).toContain(name));
      fireEvent.change(screen.getByLabelText('Select Hotel'), { target: { value: name } });
    }

    beforeEach(() => {
      auth.permissions = new Set([...ALL, 'quotations.view']);
    });

    it('shows required errors on empty submit, then clears them for valid autofilled values', async () => {
      vi.stubGlobal(
        'fetch',
        stubAutofillFlow({ [quotationRuby.id]: quotationRuby }, [quotationRuby]),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      // Empty submit surfaces the required errors; nothing is posted.
      // (Guest Name and Hotel Name share the min-length message.)
      const guestErrors = await screen.findAllByText('String must contain at least 2 character(s)');
      expect(guestErrors).toHaveLength(2);
      expect(screen.getAllByText('Use a YYYY-MM-DD date.')).toHaveLength(2);

      await pickQuotation('QT-000555');
      await pickHotel('Harbour View Resort');
      // Prefilled values land in YYYY-MM-DD form and their stale errors clear.
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Ruby jins'),
      );
      expect(screen.getByLabelText('Check-in')).toHaveValue('2027-01-01');
      expect(screen.getByLabelText('Check-out')).toHaveValue('2027-01-03');
      expect(screen.queryAllByText('String must contain at least 2 character(s)')).toHaveLength(0);
      expect(screen.queryByText('Use a YYYY-MM-DD date.')).not.toBeInTheDocument();
    });

    it('keeps errors for fields that stay invalid after autofill', async () => {
      vi.stubGlobal(
        'fetch',
        stubAutofillFlow({ [quotationRuby.id]: quotationRuby }, [quotationRuby]),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      expect(
        await screen.findAllByText('String must contain at least 2 character(s)'),
      ).toHaveLength(2);

      await pickQuotation('QT-000555');
      // The dateless option fills the guest name but leaves both dates blank.
      await pickHotel('City Inn Budget');
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Ruby jins'),
      );
      expect(screen.queryByText('String must contain at least 2 character(s)')).not.toBeInTheDocument();
      // Blank dates remain genuinely invalid, so their errors stay.
      expect(screen.getAllByText('Use a YYYY-MM-DD date.')).toHaveLength(2);
    });

    it('retains a genuine error for an invalid autofilled guest name', async () => {
      vi.stubGlobal(
        'fetch',
        stubAutofillFlow({ [quotationShort.id]: quotationShort }, [quotationShort]),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      expect(
        await screen.findAllByText('String must contain at least 2 character(s)'),
      ).toHaveLength(2);

      await pickQuotation('QT-000556');
      await pickHotel('Harbour View Resort');
      // One-character names fail the shared min-length rule even from autofill.
      await waitFor(() => expect(screen.getByLabelText('Guest Name')).toHaveValue('X'));
      expect(screen.getByText('String must contain at least 2 character(s)')).toBeInTheDocument();
      // The valid prefilled dates clear their own errors regardless.
      expect(screen.queryByText('Use a YYYY-MM-DD date.')).not.toBeInTheDocument();
    });

    it('reflects the newly selected quotation after a change', async () => {
      vi.stubGlobal(
        'fetch',
        stubAutofillFlow(
          { [quotationRuby.id]: quotationRuby, [quotationAlt.id]: quotationAlt },
          [quotationRuby, quotationAlt],
        ),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      expect(
        await screen.findAllByText('String must contain at least 2 character(s)'),
      ).toHaveLength(2);

      await pickQuotation('QT-000555');
      await pickHotel('Harbour View Resort');
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Ruby jins'),
      );
      expect(screen.queryAllByText('String must contain at least 2 character(s)')).toHaveLength(0);

      await pickQuotation('QT-000557');
      await pickHotel('Harbour View Resort');
      // Guest tracks the new record; dates follow the new option.
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Arjun Nair'),
      );
      expect(screen.getByLabelText('Check-in')).toHaveValue('2027-02-10');
      expect(screen.queryByText('String must contain at least 2 character(s)')).not.toBeInTheDocument();
    });

    it('manual edits continue to revalidate without submitting', async () => {
      vi.stubGlobal(
        'fetch',
        stubAutofillFlow({ [quotationRuby.id]: quotationRuby }, [quotationRuby]),
      );
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      // Enter the submitted state first so edits revalidate on change.
      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      expect(
        await screen.findAllByText('String must contain at least 2 character(s)'),
      ).toHaveLength(2);
      await pickQuotation('QT-000555');
      await pickHotel('Harbour View Resort');
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Ruby jins'),
      );
      expect(screen.queryAllByText('String must contain at least 2 character(s)')).toHaveLength(0);

      // Clearing reintroduces the error; typing a valid name clears it again.
      fireEvent.change(screen.getByLabelText('Guest Name'), { target: { value: '' } });
      expect(await screen.findByText('String must contain at least 2 character(s)')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Guest Name'), 'Ruby jins');
      await waitFor(() =>
        expect(
          screen.queryByText('String must contain at least 2 character(s)'),
        ).not.toBeInTheDocument(),
      );
    });

    it('submits the prefilled form through the existing API validation', async () => {
      const fetchMock = stubAutofillFlow({ [quotationRuby.id]: quotationRuby }, [quotationRuby]);
      vi.stubGlobal('fetch', fetchMock);
      renderRoutes('/hotel-vouchers/new');
      await screen.findByLabelText('Guest Name');
      await pickQuotation('QT-000555');
      await pickHotel('Harbour View Resort');
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Ruby jins'),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Create Voucher' }));
      await waitFor(() => {
        const post = fetchMock.mock.calls.find(
          ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
        );
        expect(post).toBeDefined();
      });
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/hotel-vouchers') && options?.method === 'POST',
      );
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body).toMatchObject({
        guestName: 'Ruby jins',
        checkIn: '2027-01-01',
        checkOut: '2027-01-03',
        hotelName: 'Harbour View Resort',
      });
    });
  });
});
