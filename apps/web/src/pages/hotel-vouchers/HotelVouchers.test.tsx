import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
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
    expect(await screen.findByText('HV-000001')).toBeInTheDocument();
    expect(screen.getByText('Aarav Mehta · Shah Palace Hotel')).toBeInTheDocument();
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
    const edit = await screen.findByRole('link', { name: 'Edit' });
    expect(edit).toHaveAttribute('href', `/hotel-vouchers/${draftVoucher.id}/edit`);
  });

  it('orders form sections Hotel first, then Guest, Stay, Pricing, Guests, Includes, Terms', async () => {
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
      'Pricing (Optional)',
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
  it('shows Edit/Generate/Delete on legacy drafts with no status UI or Issue action', async () => {
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
    expect(screen.getByRole('button', { name: 'Generate PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'WhatsApp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
  });

  it('shows only Open and Download in Share alongside Edit', async () => {
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
    expect(screen.getByRole('button', { name: 'Open Hotel Voucher' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Generate PDF' })).toBeInTheDocument();
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

  it('Generate PDF fetches a download URL and opens the signed PDF in a new tab', async () => {
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
      await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
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

  it('Open Hotel Voucher shows the existing PDF in a new tab without regenerating', async () => {
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
      await userEvent.click(screen.getByRole('button', { name: 'Open Hotel Voucher' }));
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

  it('Open Hotel Voucher generates the missing PDF first instead of dead-ending', async () => {
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
      await userEvent.click(screen.getByRole('button', { name: 'Open Hotel Voucher' }));
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
        screen.queryByText('Hotel voucher PDF could not be generated. Try Generate PDF to retry.'),
      ).not.toBeInTheDocument();
    } finally {
      window.open = originalOpen;
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('Open Hotel Voucher surfaces generation failures without opening a dead tab', async () => {
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
      await userEvent.click(screen.getByRole('button', { name: 'Open Hotel Voucher' }));
      // No blank tab is left open; the failure is shown and retry stays available.
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(window.open).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Open Hotel Voucher' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate PDF' })).toBeInTheDocument();
    } finally {
      window.open = originalOpen;
    }
  });

  it('creates a voucher with pricing and guest rows and shows the computed total', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'Add Pricing Row' }));
    await userEvent.type(screen.getByLabelText('Pricing row 1 room type'), 'Single Room');
    fireEvent.change(screen.getByLabelText('Pricing row 1 GST plus service'), {
      target: { value: '19883' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Add Pricing Row' }));
    await userEvent.type(screen.getByLabelText('Pricing row 2 room type'), 'Double Room');
    fireEvent.change(screen.getByLabelText('Pricing row 2 GST plus service'), {
      target: { value: '12980' },
    });
    expect(await screen.findByText('Total Payable Amount: 32,863')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add Guest' }));
    await userEvent.type(screen.getByLabelText('Guest 1 name'), 'Dilip Vaid');
    fireEvent.change(screen.getByLabelText('Guest 1 age'), { target: { value: '63' } });

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
    expect(body.pricing).toHaveLength(2);
    expect(body.pricing[0]).toMatchObject({ roomType: 'Single Room', gstService: 19883 });
    expect(body.pricing[1]).toMatchObject({ roomType: 'Double Room', gstService: 12980 });
    expect(body.guests).toHaveLength(1);
    expect(body.guests[0]).toMatchObject({
      guestName: 'Dilip Vaid',
      age: 63,
      sex: 'M',
      paxType: 'ADULT',
    });
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

  it('removes a saved pricing row on edit', async () => {
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
    expect(await screen.findByDisplayValue('Single Room')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove pricing row 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body)).pricing).toEqual([]);
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
      return vi.fn(async (request: RequestInfo | URL) => {
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
      // Both hotel entries of the version are offered.
      await waitFor(() =>
        expect(datalistValues('Select Hotel')).toEqual(
          expect.arrayContaining(['Shah Palace Hotel', 'Lakeview Resort']),
        ),
      );
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
      expect(screen.getByLabelText('Room Type')).toHaveValue('Deluxe');
      expect(screen.getByLabelText('Meal Plan')).toHaveValue('Breakfast');
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
      await waitFor(() => expect(screen.getByLabelText('Room Type')).toHaveValue('Deluxe'));
      // Manual edit that must survive the quotation change.
      fireEvent.change(screen.getByLabelText('Hotel Name'), { target: { value: 'Custom Name' } });
      fireEvent.change(screen.getByLabelText('Quotation ID'), { target: { value: 'QT-000456' } });
      await waitFor(() =>
        expect(screen.getByLabelText('Guest Name')).toHaveValue('Second Traveller'),
      );
      // The single hotel of the new quotation is auto-selected (not left
      // cleared); untouched hotel facts now reflect the new hotel.
      await waitFor(() =>
        expect(screen.getByLabelText('Select Hotel')).toHaveValue('Hillside Inn'),
      );
      expect(screen.getByLabelText('Hotel City')).toHaveValue('Munnar');
      expect(screen.getByLabelText('Room Type')).toHaveValue('');
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
});
