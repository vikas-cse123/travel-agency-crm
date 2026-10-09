import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { NAV_ITEMS } from '@/components/layout/navigation';
import { PaymentsPage } from './PaymentsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const ALL = [
  'payments.view',
  'payments.create',
  'payments.edit',
  'payments.reverse',
  'payments.view_receipts',
  'payments.generate_receipts',
];

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const trip = {
  id: 'case-1',
  customerId: null,
  queryId: null,
  customerName: 'Mohan',
  customerPhone: '+91 98989 89898',
  customerEmail: null,
  title: 'Singapore Family Trip',
  tripAmount: '300000.00',
  currency: 'INR',
  collected: '60000.00',
  outstanding: '240000.00',
  paymentCount: 2,
  status: 'PARTIALLY_PAID',
};

const paymentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  paymentNumber: 'PAY-000001',
  amount: '10000.00',
  currency: 'INR',
  paymentMethod: 'UPI',
  paymentStatus: 'RECEIVED',
  receivedAt: '2026-10-09T00:00:00.000Z',
  referenceNumber: 'UPI123',
  bankName: null,
  notes: 'Advance',
  createdAt: '2026-10-09T00:00:00.000Z',
  reversedAt: null,
  reversedById: null,
  reversalReason: null,
  recordedBy: { id: 'u-1', fullName: 'Owner User' },
  reversedBy: null,
  receipt: null,
  paymentCase: {
    id: 'case-1',
    customerName: 'Mohan',
    title: 'Singapore Family Trip',
    tripAmount: '300000.00',
    currency: 'INR',
  },
  ...overrides,
});

const ledger = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 10, total: rows.length, totalPages: 1 },
  summary: {
    totalCollected: '60000.00',
    paymentCount: rows.length,
    receivedToday: '0.00',
    receivedThisMonth: '10000.00',
  },
});

function renderPage(route = '/payments') {
  return renderWithProviders(
    <Routes>
      <Route path="/payments" element={<PaymentsPage />} />
    </Routes>,
    { route },
  );
}

describe('Payments page (standalone, no booking)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('gates the nav item on the standalone view permission', () => {
    const item = NAV_ITEMS.find((entry) => entry.label === 'Payments');
    expect(item).toMatchObject({
      to: '/payments',
      permission: 'payments.view',
      section: 'SALES',
      available: true,
    });
  });

  it('lists payments with customer and trip context and no booking references', async () => {
    const rows = [
      paymentRow(),
      paymentRow({
        id: 'pay-2',
        paymentNumber: 'PAY-000002',
        amount: '50000.00',
        paymentMethod: 'BANK_TRANSFER',
        receivedAt: '2026-11-01T00:00:00.000Z',
        referenceNumber: 'NEFT123',
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(ledger(rows))),
    );
    const { container } = renderPage();
    expect(await screen.findByText('NEFT123')).toBeInTheDocument();
    expect(screen.getAllByText('Mohan').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Singapore Family Trip').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Total Collected')).toBeInTheDocument();
    // Standalone: no booking column, number or wording anywhere.
    expect(container.textContent).not.toMatch(/BK-\d{6}/);
    expect(container.textContent).not.toMatch(/booking/i);
  });

  it('shows an empty state when no payments match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ...ledger([]),
          summary: {
            totalCollected: '0.00',
            paymentCount: 0,
            receivedToday: '0.00',
            receivedThisMonth: '0.00',
          },
        }),
      ),
    );
    renderPage();
    expect(await screen.findByText('No payments found')).toBeInTheDocument();
  });

  it('sends search and filters server-side via query params', async () => {
    const fetchMock = vi.fn(async () => response(ledger([])));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('No payments found');
    await userEvent.type(screen.getByLabelText('Search payments'), 'Mohan');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=Mohan'))).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('Filter by payment method'), {
      target: { value: 'UPI' },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('paymentMethod=UPI'))).toBe(
        true,
      ),
    );
  });

  it('expands a payment to show details, trip history and reversal context', async () => {
    const rows = [
      paymentRow({
        reversedAt: '2026-10-10T00:00:00.000Z',
        reversalReason: 'Duplicate entry',
        reversedBy: { id: 'u-1', fullName: 'Owner User' },
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/payments/cases/case-1')) {
          return response({ ...trip, payments: rows });
        }
        return response(ledger(rows));
      }),
    );
    renderPage();
    expect(await screen.findByText('UPI123')).toBeInTheDocument();
    const reversedMarks = screen.getAllByText('Reversed');
    expect(reversedMarks.some((el) => el.tagName === 'TD')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    expect(screen.getByText('Duplicate entry', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('PAY-000001')).toBeInTheDocument();
    expect(screen.getByText('Owner User')).toBeInTheDocument();
    // Trip totals come from the case, never a booking.
    expect(await screen.findByText('Trip payment history')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse Payment' })).not.toBeInTheDocument();
  });

  it('records a payment against a selected trip and shows trip totals', async () => {
    const tripsPage = {
      data: [
        {
          id: 'case-1',
          customerName: 'Mohan',
          title: 'Singapore Family Trip',
          outstanding: '240000.00',
          currency: 'INR',
        },
      ],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/payments'))
        return response({ ...paymentRow(), id: 'pay-9', paymentNumber: 'PAY-000009' });
      if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
      if (url.includes('/payments/cases')) return response(tripsPage);
      if (url.includes('/payments?') || url.endsWith('/payments'))
        return response(ledger([paymentRow()]));
      return response(tripsPage);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: '+ Record Payment' }));
    await userEvent.type(screen.getByLabelText('Search customer trips'), 'Mohan');
    const option = await screen.findByRole('button', { name: /Mohan · Singapore Family Trip/ });
    await userEvent.click(option);
    expect(await screen.findByText(/Trip Amount:/)).toBeInTheDocument();
    expect(screen.getByText(/Already Paid:/)).toBeInTheDocument();
    expect(screen.getByText(/Outstanding:/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment amount'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-09' } });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'UPI' } });
    await userEvent.type(screen.getByLabelText('Payment reference number'), 'UPI123');
    await userEvent.type(screen.getByLabelText('Payment notes'), 'Advance');
    expect(await screen.findByText(/Outstanding after payment:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/payments') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/payments') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      caseId: 'case-1',
      amount: 10000,
      currency: 'INR',
      paymentMethod: 'UPI',
      paymentStatus: 'RECEIVED',
      receivedAt: '2026-10-09',
      referenceNumber: 'UPI123',
    });
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('bookingId');
  });

  it('requires an explicitly selected trip before submitting', async () => {
    const tripsPage = {
      data: [{ id: 'case-1', customerName: 'Mohan', title: 'Singapore Family Trip' }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/payments/cases')) return response(tripsPage);
        return response(ledger([paymentRow()]));
      }),
    );
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: '+ Record Payment' }));
    await userEvent.type(screen.getByLabelText('Search customer trips'), 'Mohan');
    expect(await screen.findByText('Select a trip from the search results.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  });

  it('clears a stale trip selection when the search text is edited', async () => {
    const tripsPage = {
      data: [{ id: 'case-1', customerName: 'Mohan', title: 'Singapore Family Trip' }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/payments'))
        return response({ id: 'pay-9', paymentNumber: 'PAY-000009' });
      if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
      if (url.includes('/payments/cases')) return response(tripsPage);
      return response(ledger([paymentRow()]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: '+ Record Payment' }));
    await userEvent.click(await screen.findByRole('button', { name: /Mohan · Singapore/ }));
    expect(await screen.findByText(/Trip Amount:/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Payment amount'), { target: { value: '10000' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record payment' })).toBeEnabled(),
    );
    await userEvent.type(screen.getByLabelText('Search customer trips'), 'X');
    expect(await screen.findByText('Select a trip from the search results.')).toBeInTheDocument();
    expect(screen.queryByText(/Trip Amount:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/payments') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('creates a new trip inline when none matches', async () => {
    const emptyPage = {
      data: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/payments/cases'))
        return response({ id: 'case-9', customerName: 'Mohan', title: 'Singapore Family Trip' });
      if (url.includes('/payments/cases/case-9')) return response({ ...trip, id: 'case-9' });
      if (url.includes('/payments/cases')) return response(emptyPage);
      if (url.includes('/customers')) return response(emptyPage);
      if (url.includes('/queries')) return response(emptyPage);
      return response(ledger([paymentRow()]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: '+ Record Payment' }));
    await userEvent.type(screen.getByLabelText('Search customer trips'), 'Mohan');
    expect(await screen.findByText(/No trips found/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New trip' }));
    await userEvent.type(screen.getByLabelText('Trip customer name'), 'Mohan');
    await userEvent.type(screen.getByLabelText('Trip title'), 'Singapore Family Trip');
    fireEvent.change(screen.getByLabelText('Trip amount'), { target: { value: '300000' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/payments/cases') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/payments/cases') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      customerName: 'Mohan',
      title: 'Singapore Family Trip',
      tripAmount: 300000,
      currency: 'INR',
    });
  });

  it('hides record and reverse actions without the standalone permissions', async () => {
    auth.permissions = new Set(['payments.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(ledger([paymentRow()]))),
    );
    renderPage();
    await screen.findByText('UPI123');
    expect(screen.queryByRole('button', { name: '+ Record Payment' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    expect(screen.queryByRole('button', { name: 'Reverse Payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Voucher' })).not.toBeInTheDocument();
  });

  it('reverses a payment with a reason from the details panel', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.includes('/reverse')) return response({ id: 'pay-1' });
      if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
      return response(ledger([paymentRow()]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reverse Payment' }));
    await userEvent.type(screen.getByLabelText('Reversal reason for PAY-000001'), 'Duplicate');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith('/payments/pay-1/reverse')),
      ).toBe(true),
    );
    const reverse = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/payments/pay-1/reverse'),
    );
    expect(JSON.parse(String(reverse?.[1]?.body))).toMatchObject({ reason: 'Duplicate' });
  });

  it('generates a voucher from the details panel and shows its number', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/receipt'))
        return response({ id: 'rcp-1', receiptNumber: 'RCP-000001' });
      if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
      return response(ledger([paymentRow()]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    expect(screen.getByText('Not Generated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate Voucher' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/payments/pay-1/receipt') && options?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('views and downloads an existing voucher through signed URLs', async () => {
    const withVoucher = paymentRow({
      receipt: { id: 'rcp-1', receiptNumber: 'RCP-000001', uploadStatus: 'AVAILABLE' },
    });
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/receipt/download-url'))
        return response({
          url: 'https://signed.test/payment-voucher-RCP-000001.pdf?sig=abc',
          fileName: 'payment-voucher-RCP-000001.pdf',
          expiresInSeconds: 300,
        });
      if (url.startsWith('https://signed.test'))
        return { ok: true, blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }) };
      if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
      return response(ledger([withVoucher]));
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
      renderPage();
      await screen.findByText('UPI123');
      await userEvent.click(screen.getByRole('button', { name: 'Open voucher RCP-000001' }));
      expect(screen.getAllByText('RCP-000001').length).toBeGreaterThanOrEqual(2);
      await userEvent.click(screen.getByRole('button', { name: 'View' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('blob:mock-voucher-pdf'));
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
      await userEvent.click(screen.getByRole('button', { name: 'Download' }));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith(
          'https://signed.test/payment-voucher-RCP-000001.pdf?sig=abc',
        ),
      );
    } finally {
      window.open = originalOpen;
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('offers no voucher generation on reversed payments', async () => {
    const rows = [paymentRow({ reversedAt: '2026-10-10T00:00:00.000Z' })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/payments/cases/case-1')) return response({ ...trip, payments: [] });
        return response(ledger(rows));
      }),
    );
    renderPage();
    await screen.findByText('UPI123');
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    expect(screen.getByText('Not Generated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Voucher' })).not.toBeInTheDocument();
  });
});
