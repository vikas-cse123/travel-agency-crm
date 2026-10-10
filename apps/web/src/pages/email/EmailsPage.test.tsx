import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { NAV_ITEMS } from '@/components/layout/navigation';
import { EmailsPage } from './EmailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const ALL = ['emails.view', 'emails.send', 'emails.manage_settings'];

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const sentRow = {
  id: 'mail-1',
  fromName: 'ABC Travels',
  fromEmail: 'bookings@example.com',
  to: ['hotel@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hotel Booking Confirmation',
  status: 'SENT',
  errorMessage: null,
  sentAt: '2026-10-09T03:10:00.000Z',
  createdAt: '2026-10-09T03:10:00.000Z',
  updatedAt: '2026-10-09T03:10:00.000Z',
};

const historyPage = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 10, total: rows.length, totalPages: 1 },
});

const detailsRow = {
  ...sentRow,
  bodyHtml: '<p>Dear Hotel Team,</p><p>Please find the details below.</p>',
  bodyText: 'Dear Hotel Team,\n\nPlease find the details below.',
};

function renderPage(route = '/emails') {
  return renderWithProviders(
    <Routes>
      <Route path="/emails" element={<EmailsPage />} />
    </Routes>,
    { route },
  );
}

describe('Emails page (standalone)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('adds a Sales-section Email nav item gated by the view permission', () => {
    const item = NAV_ITEMS.find((entry) => entry.label === 'Email');
    expect(item).toMatchObject({
      to: '/emails',
      permission: 'emails.view',
      section: 'SALES',
      available: true,
    });
  });

  it('lists sent emails with status and keeps unrelated entity pickers out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(historyPage([sentRow]))),
    );
    const { container } = renderPage();
    expect(await screen.findByText('Hotel Booking Confirmation')).toBeInTheDocument();
    expect(screen.getByText('hotel@example.com')).toBeInTheDocument();
    expect(screen.getByText('bookings@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThanOrEqual(1);
    // Standalone composer: no unrelated CRM entity selectors anywhere.
    for (const forbidden of [
      'Select Customer',
      'Select Vendor',
      'Select Booking',
      'Select Payment',
      'Select Voucher',
    ]) {
      expect(container.textContent).not.toContain(forbidden);
    }
  });

  it('shows an empty state when nothing was sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(historyPage([]))),
    );
    renderPage();
    expect(await screen.findByText('No emails yet')).toBeInTheDocument();
  });

  it('expands a row to show recipients, message and delivery info', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.endsWith('/emails/mail-1')) return response(detailsRow);
      return response(historyPage([sentRow]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Hotel Booking Confirmation');
    await userEvent.click(screen.getByRole('button', { name: /details$/ }));
    expect(await screen.findByText('Dear Hotel Team,')).toBeInTheDocument();
    expect(screen.getAllByText(/Oct 2026/).length).toBeGreaterThanOrEqual(2);
  });

  it('sends an email and clears the composer on success', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/emails')) return response(sentRow);
      return response(historyPage([sentRow]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Hotel Booking Confirmation');
    await userEvent.type(screen.getByLabelText('Email recipients'), 'hotel@example.com');
    await userEvent.type(screen.getByLabelText('Email subject'), 'Hotel Booking Confirmation');
    const editor = screen.getByLabelText('Email message');
    editor.innerHTML = '<p>Hello hotel team</p>';
    fireEvent.input(editor);
    const send = screen.getByRole('button', { name: 'Send Email' });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      to: ['hotel@example.com'],
      subject: 'Hotel Booking Confirmation',
    });
    await waitFor(() =>
      expect(screen.getByText(/Email sent to hotel@example.com/)).toBeInTheDocument(),
    );
  });

  it('keeps Send disabled until recipients, subject and body are present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(historyPage([]))),
    );
    renderPage();
    await screen.findByText('No emails yet');
    expect(screen.getByRole('button', { name: 'Send Email' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email recipients'), 'hotel@example.com');
    expect(screen.getByRole('button', { name: 'Send Email' })).toBeDisabled();
  });

  it('shows a useful error when sending fails', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/emails')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            success: false,
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication failed.' },
          }),
        } as Response;
      }
      return response(historyPage([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('No emails yet');
    await userEvent.type(screen.getByLabelText('Email recipients'), 'hotel@example.com');
    await userEvent.type(screen.getByLabelText('Email subject'), 'Hi');
    const editor = screen.getByLabelText('Email message');
    editor.innerHTML = '<p>Hello</p>';
    fireEvent.input(editor);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Send Email' }));
    expect(await screen.findByText('Authentication failed.')).toBeInTheDocument();
  });

  it('hides the composer without the send permission', async () => {
    auth.permissions = new Set(['emails.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(historyPage([sentRow]))),
    );
    renderPage();
    await screen.findByText('Hotel Booking Confirmation');
    expect(screen.queryByLabelText('Email recipients')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send Email' })).not.toBeInTheDocument();
  });
});

describe('Hotel booking emails (Phase 1)', () => {
  const hotelMaster = {
    id: 'aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa',
    name: 'Shah Palace Hotel',
    email: 'reservations@shahpalace.test',
    phone: '+91 14100 00000',
    address: 'Palace Road, Jaipur',
    city: { id: 'c-1', name: 'Jaipur' },
  };
  const hotelMasterNoEmail = { ...hotelMaster, email: null };

  const hotelA = {
    id: 'aaaaaaaa-aaaa-4222-8222-aaaaaaaaaaaa',
    hotelId: hotelMaster.id,
    hotelName: 'Shah Palace Hotel',
    city: 'Jaipur',
    roomType: 'Deluxe',
    mealPlan: 'Breakfast',
    rooms: 4,
    nights: 4,
    checkInDate: '2026-11-10T00:00:00.000Z',
    checkOutDate: '2026-11-14T00:00:00.000Z',
    roomLines: [
      { roomType: 'Deluxe Room', rooms: 3, extraBedQuantity: 1, childWithoutBedQuantity: 0, notes: 'High floor' },
      { roomType: 'Executive Suite', rooms: 1, extraBedQuantity: 0, childWithoutBedQuantity: 1, notes: null },
    ],
    mealPlanLines: [{ mealPlan: 'Breakfast' }, { mealPlan: 'Half Board' }],
  };
  const hotelB = {
    id: 'bbbbbbbb-bbbb-4222-8222-bbbbbbbbbbbb',
    hotelId: null,
    hotelName: 'Lakeview Resort',
    city: 'Udaipur',
    roomType: 'Standard Room',
    mealPlan: null,
    rooms: 1,
    nights: null,
    checkInDate: null,
    checkOutDate: null,
    roomLines: [],
    mealPlanLines: [],
  };

  const quotationOne = {
    id: 'c0ffee00-0000-4000-8000-000000000001',
    quotationNumber: 'QT-000123',
    customerName: 'Mohan Kumar',
    customerPhone: '+91 91111 11111',
    customerEmail: 'mohan@example.test',
    destinationSummary: 'Singapore',
    currentVersionId: 'c0ffee00-0000-4000-8000-000000000021',
    versions: [
      {
        id: 'c0ffee00-0000-4000-8000-000000000021',
        hotels: [hotelA, hotelB],
      },
    ],
  };
  const quotationSingle = {
    ...quotationOne,
    id: 'c0ffee00-0000-4000-8000-000000000002',
    quotationNumber: 'QT-000456',
    currentVersionId: 'c0ffee00-0000-4000-8000-000000000022',
    versions: [{ id: 'c0ffee00-0000-4000-8000-000000000022', hotels: [hotelA] }],
  };
  const quotationEmpty = {
    ...quotationOne,
    id: 'c0ffee00-0000-4000-8000-000000000003',
    quotationNumber: 'QT-000789',
    currentVersionId: 'c0ffee00-0000-4000-8000-000000000023',
    versions: [{ id: 'c0ffee00-0000-4000-8000-000000000023', hotels: [] }],
  };

  function stubHotelFlow({
    list = [quotationOne],
    details = { [quotationOne.id]: quotationOne },
    master = hotelMaster,
    sent = sentRow,
  }: {
    list?: unknown[];
    details?: Record<string, unknown>;
    master?: unknown;
    sent?: unknown;
  } = {}) {
    return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/emails')) return response(sent);
      if (/\/masters\/hotels\/[^/?]+$/.test(url)) return response(master);
      const detailMatch = url.match(/\/quotations\/([^/?]+)(?:[?]|$)/);
      if (detailMatch && !url.includes('/quotations?'))
        return response(details[detailMatch[1]!] ?? null);
      if (url.includes('/quotations')) return response(historyPage(list));
      return response(historyPage([]));
    });
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([...ALL, 'quotations.view']);
  });

  async function searchAndPickQuotation(number: string) {
    await userEvent.type(screen.getByLabelText('Search quotations'), number);
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(number) }));
  }

  function pickHotel(name: string) {
    fireEvent.change(screen.getByLabelText('Select Hotel'), {
      target: { value: [hotelA, hotelB].find((row) => row.hotelName === name)!.id },
    });
  }

  it('separates Hotel and Itinerary purposes, both fully selectable', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    expect(screen.getByRole('radio', { name: 'Hotel' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Itinerary' })).not.toBeChecked();
    expect(screen.getByLabelText('Search quotations')).toBeInTheDocument();
    expect(screen.queryByText(/coming in Phase 2/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Itinerary' }));
    expect(screen.getByRole('radio', { name: 'Itinerary' })).toBeChecked();
    // Itinerary is functional: its own quotation workflow appears.
    expect(screen.getByLabelText('Search quotations')).toBeInTheDocument();
    expect(screen.queryByText(/coming in Phase 2/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Hotel' }));
    expect(screen.getByRole('radio', { name: 'Hotel' })).toBeChecked();
    expect(screen.getByLabelText('Search quotations')).toBeInTheDocument();
    // The normal composer stays usable under either purpose.
    expect(screen.getByLabelText('Email recipients')).toBeInTheDocument();
  });

  it('hides the hotel workflow without the quotations view permission', async () => {
    auth.permissions = new Set(ALL);
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    expect(screen.queryByLabelText('Search quotations')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email recipients')).toBeInTheDocument();
  });

  it('searches quotations and lists every associated hotel', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    expect(await screen.findByText('QT-000123 · Mohan Kumar')).toBeInTheDocument();
    const hotelSelect = await screen.findByLabelText('Select Hotel');
    const options = Array.from(hotelSelect.querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    expect(options.some((text) => text?.includes('Shah Palace Hotel'))).toBe(true);
    expect(options.some((text) => text?.includes('Lakeview Resort'))).toBe(true);
  });

  it('explains when a quotation has no hotels', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({ list: [quotationEmpty], details: { [quotationEmpty.id]: quotationEmpty } }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000789');
    expect(await screen.findByText(/No hotel options were found/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Hotel')).not.toBeInTheDocument();
  });

  it('resolves the master email and prepares subject and body without sending', async () => {
    const fetchMock = stubHotelFlow();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');

    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10-11-2026 to 14-11-2026',
    );
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).toContain('Dear Reservations Team');
    expect(message).toContain('Mohan Kumar');
    expect(message).toContain('+91 91111 11111');
    expect(message).toContain('Palace Road, Jaipur');
    expect(message).toContain('10-11-2026');
    expect(message).toContain('Number of nights: 4');
    // Every room configuration and every meal plan, not just the first.
    expect(message).toContain('Deluxe Room × 3');
    expect(message).toContain('1 extra bed(s)');
    expect(message).toContain('High floor');
    expect(message).toContain('Executive Suite × 1');
    expect(message).toContain('1 child without bed');
    expect(message).toContain('Breakfast');
    expect(message).toContain('Half Board');
    // A request, never a confirmation.
    expect(message).not.toMatch(/confirm(ed|ation of your booking)|booking is confirmed/i);
    // Selecting never sends automatically.
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('auto-selects the single available hotel choice', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({ list: [quotationSingle], details: { [quotationSingle.id]: quotationSingle } }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000456');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    expect(screen.getByLabelText('Select Hotel')).toHaveValue(hotelA.id);
  });

  it('warns honestly when the master has no email and fabricates nothing', async () => {
    vi.stubGlobal('fetch', stubHotelFlow({ master: hotelMasterNoEmail }));
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');
    expect(await screen.findByText(/has no email address/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email recipients')).toHaveValue('');
    // The draft still prepares subject and body for manual addressing.
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10-11-2026 to 14-11-2026',
    );
  });

  it('warns when the stay is not linked to any hotel master', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Lakeview Resort');
    expect(await screen.findByText(/not linked to a hotel master/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email recipients')).toHaveValue('');
  });

  it('omits missing dates gracefully instead of placeholders', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Lakeview Resort');
    await waitFor(() =>
      expect(screen.getByLabelText('Email subject')).toHaveValue(
        'Hotel Booking Request – Mohan Kumar – Lakeview Resort',
      ),
    );
    const subjectValue = (screen.getByLabelText('Email subject') as HTMLInputElement).value;
    expect(subjectValue).not.toContain('undefined');
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).not.toContain('undefined');
    expect(message).not.toContain('Invalid Date');
    expect(message).toContain('Standard Room × 1');
  });

  it('updates the draft when a different hotel is selected', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    pickHotel('Lakeview Resort');
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Hotel Booking Request – Mohan Kumar – Lakeview Resort',
    );
    expect(screen.getByLabelText('Email message').textContent ?? '').toContain('Lakeview Resort');
  });

  it('keeps manual edits when the hotel selection changes', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    fireEvent.change(screen.getByLabelText('Email subject'), {
      target: {
        value: 'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – please expedite',
      },
    });
    pickHotel('Lakeview Resort');
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    // The edited subject survives; untouched fields regenerate.
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – please expedite',
    );
  });

  it('clears the hotel selection and generated draft when switching quotations', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({
        list: [quotationOne, quotationSingle],
        details: { [quotationOne.id]: quotationOne, [quotationSingle.id]: quotationSingle },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await searchAndPickQuotation('QT-000456');
    // Previous stay and draft are gone; the new single stay populates afresh.
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    expect(screen.getByLabelText('Select Hotel')).toHaveValue(hotelA.id);
  });

  it('sends the prepared draft through the existing email workflow', async () => {
    const fetchMock = stubHotelFlow({
      sent: { ...sentRow, to: ['reservations@shahpalace.test'] },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000123');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');
    const send = screen.getByRole('button', { name: 'Send Email' });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      to: ['reservations@shahpalace.test'],
      subject: 'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10-11-2026 to 14-11-2026',
    });
    expect(await screen.findByText(/Email sent to reservations@shahpalace.test/)).toBeInTheDocument();
  });

  it('still composes standalone email without touching the hotel workflow', async () => {
    vi.stubGlobal('fetch', stubHotelFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await userEvent.type(screen.getByLabelText('Email recipients'), 'hotel@example.com');
    await userEvent.type(screen.getByLabelText('Email subject'), 'Hello');
    const editor = screen.getByLabelText('Email message');
    editor.innerHTML = '<p>Hello hotel team</p>';
    fireEvent.input(editor);
    const send = screen.getByRole('button', { name: 'Send Email' });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    expect(await screen.findByText(/Email sent to hotel@example.com/)).toBeInTheDocument();
  });
});

describe('Hotel booking email content builders', () => {
  it('escapes interpolated values and formats stay dates without shifts', async () => {
    const { buildHotelBookingBody, buildHotelBookingSubject, escapeHtml, formatStayDate } =
      await import('./HotelBookingEmail');
    expect(escapeHtml('<b>&"evil"</b>')).toBe('&lt;b&gt;&amp;&quot;evil&quot;&lt;/b&gt;');
    expect(formatStayDate('2026-11-10T00:00:00.000Z')).toBe('10-11-2026');
    expect(formatStayDate(null)).toBeNull();
    expect(formatStayDate('garbage')).toBeNull();
    expect(
      buildHotelBookingSubject({
        customerName: 'Mohan Kumar',
        hotelName: 'Shah Palace Hotel',
        checkInDate: '2026-11-10T00:00:00.000Z',
        checkOutDate: '2026-11-14T00:00:00.000Z',
      }),
    ).toBe('Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10-11-2026 to 14-11-2026');
    expect(
      buildHotelBookingSubject({ customerName: null, hotelName: 'Lakeview Resort' }),
    ).toBe('Hotel Booking Request – Lakeview Resort');
    const body = buildHotelBookingBody({
      quotation: { customerName: '<Mohan>', customerPhone: null, customerEmail: null },
      hotel: {
        hotelName: '<Mohan> Inn',
        city: 'Goa',
        checkInDate: null,
        checkOutDate: null,
        nights: null,
        roomLines: [],
        mealPlanLines: [],
        notes: null,
      } as never,
      master: null,
    });
    expect(body).not.toContain('<Mohan>');
    expect(body).toContain('&lt;Mohan&gt;');
    expect(body).not.toContain('undefined');
  });
});

describe('Itinerary vendor emails (Phase 2)', () => {
  const sgMaster = {
    id: 'dddddddd-dddd-4111-8111-dddddddddddd',
    name: 'Singapore',
    status: 'ACTIVE',
    email: 'vendor-sg@example.test',
    cities: [{ city: { name: 'Singapore' } }, { city: { name: 'Sentosa' } }],
  };
  const klMaster = {
    id: 'eeeeeeee-eeee-4111-8111-eeeeeeeeeeee',
    name: 'Kuala Lumpur',
    status: 'ACTIVE',
    email: null,
    cities: [{ city: { name: 'Kuala Lumpur' } }],
  };

  const itineraryRows = [
    {
      dayNumber: 1,
      date: '2026-11-01',
      title: 'Arrival in Singapore',
      destination: 'Singapore',
      description: 'Airport pickup and check-in.',
      meals: null,
      overnightLocation: 'Singapore',
      activities: 'Marina Bay evening',
      transfers: 'Private airport transfer',
      notes: null,
      sequence: 1,
    },
    {
      dayNumber: 2,
      date: '2026-11-02',
      title: 'Sentosa day',
      destination: 'Singapore',
      description: null,
      meals: null,
      overnightLocation: null,
      activities: null,
      transfers: null,
      notes: null,
      sequence: 2,
    },
    {
      dayNumber: 3,
      date: '2026-11-03',
      title: 'Travel to KL',
      destination: 'Kuala Lumpur',
      description: 'Bus to Kuala Lumpur.',
      meals: null,
      overnightLocation: 'Kuala Lumpur',
      activities: null,
      transfers: 'Shared coach',
      notes: null,
      sequence: 3,
    },
    {
      dayNumber: 4,
      date: '2026-11-04',
      title: 'KL city tour',
      destination: 'kuala lumpur',
      description: null,
      meals: null,
      overnightLocation: null,
      activities: null,
      transfers: null,
      notes: null,
      sequence: 4,
    },
    {
      dayNumber: 5,
      date: null,
      title: 'Buffer day',
      destination: '',
      description: null,
      meals: null,
      overnightLocation: null,
      activities: null,
      transfers: null,
      notes: null,
      sequence: 5,
    },
  ];

  const versionMulti = {
    id: 'c0ffee00-0000-4000-8000-000000000051',
    travelStartDate: '2026-11-01',
    travelEndDate: '2026-11-05',
    itinerary: itineraryRows,
    sightseeingDetails: {
      include: true,
      days: [
        {
          dayNumber: 1,
          title: 'City highlights',
          city: 'Singapore',
          date: '2026-11-01',
          meals: { breakfast: false, lunch: false, dinner: false },
          mealMode: 'NO_TRANSFER',
          dailyTransfer: 'PRIVATE',
          activities: [
            { name: 'Gardens by the Bay', startTime: '09:00', description: 'Morning visit.' },
          ],
        },
        {
          dayNumber: 2,
          title: 'Other city day',
          city: 'Bangkok',
          date: '2026-11-02',
          meals: { breakfast: false, lunch: false, dinner: false },
          mealMode: 'NO_TRANSFER',
          dailyTransfer: 'SHARED',
          activities: [{ name: 'Far away tour', startTime: null, description: null }],
        },
      ],
    },
    services: [
      {
        id: 's-1',
        serviceType: 'VEHICLE_TRANSFER',
        name: 'Airport pickup',
        description: 'Meet and greet.',
        dayNumber: 1,
        city: 'Singapore',
        quantity: '1',
        sellingPrice: '5000',
        internalCost: '3000',
      },
      {
        id: 's-2',
        serviceType: 'HOTEL',
        name: 'Hotel stay charge',
        description: 'Must never appear in itinerary mail.',
        dayNumber: 1,
        city: 'Singapore',
        quantity: '1',
        sellingPrice: '20000',
        internalCost: '15000',
      },
      {
        id: 's-3',
        serviceType: 'SIGHTSEEING',
        name: 'KL tower visit',
        description: null,
        dayNumber: 3,
        city: 'Kuala Lumpur',
        quantity: '2',
        sellingPrice: '4000',
        internalCost: '2500',
      },
      {
        id: 's-4',
        serviceType: 'OTHER_ADD_ON',
        name: 'Travel insurance',
        description: null,
        dayNumber: null,
        city: null,
        quantity: '1',
        sellingPrice: '1000',
        internalCost: '600',
      },
    ],
  };

  const quotationItin = {
    id: 'c0ffee00-0000-4000-8000-000000000061',
    quotationNumber: 'QT-000321',
    customerName: 'Mohan Kumar',
    customerPhone: '+91 91111 11111',
    customerEmail: 'mohan@example.test',
    destinationSummary: 'Singapore · Kuala Lumpur',
    adults: 2,
    childrenWithBed: 1,
    childrenWithoutBed: 0,
    infants: 0,
    currentVersionId: versionMulti.id,
    versions: [versionMulti],
  };
  const quotationSingleDest = {
    ...quotationItin,
    id: 'c0ffee00-0000-4000-8000-000000000062',
    quotationNumber: 'QT-000654',
    currentVersionId: 'c0ffee00-0000-4000-8000-000000000052',
    versions: [
      {
        ...versionMulti,
        id: 'c0ffee00-0000-4000-8000-000000000052',
        itinerary: [itineraryRows[0]],
        sightseeingDetails: { include: true, days: [] },
        services: [],
      },
    ],
  };
  const quotationNoItin = {
    ...quotationItin,
    id: 'c0ffee00-0000-4000-8000-000000000063',
    quotationNumber: 'QT-000987',
    currentVersionId: 'c0ffee00-0000-4000-8000-000000000053',
    versions: [
      { ...versionMulti, id: 'c0ffee00-0000-4000-8000-000000000053', itinerary: [] },
    ],
  };

  function stubItineraryFlow({
    list = [quotationItin],
    details = { [quotationItin.id]: quotationItin },
    masters = [sgMaster, klMaster],
    sent = sentRow,
    emails = historyPage([]),
  }: {
    list?: unknown[];
    details?: Record<string, unknown>;
    masters?: Array<{ id: string; name: string; status: string; email: string | null }>;
    sent?: unknown;
    emails?: unknown;
  } = {}) {
    return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/emails')) {
        try {
          const posted = JSON.parse(String(init.body)) as { to?: unknown };
          if (
            Array.isArray(posted.to) &&
            posted.to.some(
              (address) => typeof address === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
            )
          ) {
            return {
              ok: false,
              status: 400,
              json: async () => ({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Enter a valid recipient email.' },
              }),
            } as Response;
          }
        } catch {
          // Fall through to the success response below.
        }
        return response(sent);
      }
      if (url.includes('/masters/destinations')) {
        const search = new URL(url, 'http://localhost').searchParams.get('search') ?? '';
        const rows = search
          ? masters.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
          : [];
        return response(historyPage(rows));
      }
      const detailMatch = url.match(/\/quotations\/([^/?]+)(?:[?]|$)/);
      if (detailMatch && !url.includes('/quotations?'))
        return response(details[detailMatch[1]!] ?? null);
      if (url.includes('/quotations')) return response(historyPage(list));
      return response(emails);
    });
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([...ALL, 'quotations.view']);
  });

  async function pickPurposeItinerary() {
    await userEvent.click(screen.getByRole('radio', { name: 'Itinerary' }));
  }

  async function searchAndPickQuotation(number: string) {
    await userEvent.type(screen.getByLabelText('Search quotations'), number);
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(number) }));
  }

  function pickDestination(name: string) {
    const select = screen.getByLabelText('Select Destination') as HTMLSelectElement;
    const option = Array.from(select.querySelectorAll('option')).find((entry) =>
      (entry.textContent ?? '').startsWith(name),
    )!;
    fireEvent.change(select, { target: { value: option.value } });
  }

  it('loads every eligible itinerary destination for the selected quotation', async () => {
    vi.stubGlobal('fetch', stubItineraryFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    const select = (await screen.findByLabelText('Select Destination')) as HTMLSelectElement;
    const labels = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    // Both destinations listed; the blank row never becomes an option.
    expect(labels.some((text) => text?.startsWith('Singapore'))).toBe(true);
    expect(labels.some((text) => text?.startsWith('Kuala Lumpur'))).toBe(true);
    expect(labels).toHaveLength(3); // placeholder + two destinations
  });

  it('explains when a quotation has no itinerary destinations', async () => {
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({
        list: [quotationNoItin],
        details: { [quotationNoItin.id]: quotationNoItin },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000987');
    expect(await screen.findByText(/No itinerary destinations were found/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Select Destination')).not.toBeInTheDocument();
  });

  it('auto-selects the single eligible destination', async () => {
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({
        list: [quotationSingleDest],
        details: { [quotationSingleDest.id]: quotationSingleDest },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000654');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    expect((screen.getByLabelText('Select Destination') as HTMLSelectElement).value).toBe(
      'singapore',
    );
  });

  it('resolves the destination email and prepares a destination-specific draft', async () => {
    const fetchMock = stubItineraryFlow();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');

    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Itinerary Details – Mohan Kumar – Singapore – 01-11-2026 to 02-11-2026',
    );
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).toContain('Dear Team');
    expect(message).toContain('QT-000321');
    expect(message).toContain('Arrival in Singapore');
    expect(message).toContain('Sentosa day');
    expect(message).toContain('Gardens by the Bay');
    expect(message).toContain('09:00');
    expect(message).toContain('Airport pickup');
    expect(message).toContain('2 adults, 1 child with bed');
    // Excluded: other destinations, unrelated cities, hotel content, internals.
    expect(message).not.toContain('Travel to KL');
    expect(message).not.toContain('Far away tour');
    expect(message).not.toContain('Hotel stay charge');
    expect(message).not.toContain('15000');
    expect(message).not.toContain('Travel insurance');
    expect(message).not.toMatch(/confirm(ed|ation of your booking)/i);
    // Selecting never sends automatically.
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('never reuses another destination email and warns when none is configured', async () => {
    vi.stubGlobal('fetch', stubItineraryFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    pickDestination('Kuala Lumpur');
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    expect(await screen.findByText(/has no email address/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Itinerary Details – Mohan Kumar – Kuala Lumpur – 03-11-2026 to 04-11-2026',
    );
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).toContain('Travel to KL');
    expect(message).toContain('KL tower visit');
    expect(message).not.toContain('Arrival in Singapore');
  });

  it('warns when the destination has no configured master record', async () => {
    vi.stubGlobal('fetch', stubItineraryFlow({ masters: [] }));
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    expect(await screen.findByText(/not linked to a configured destination master/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email recipients')).toHaveValue('');
  });

  it('keeps manual edits when the destination changes', async () => {
    vi.stubGlobal('fetch', stubItineraryFlow());
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    fireEvent.change(screen.getByLabelText('Email subject'), {
      target: { value: 'Itinerary Details – Mohan Kumar – Singapore – please expedite' },
    });
    pickDestination('Kuala Lumpur');
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Itinerary Details – Mohan Kumar – Singapore – please expedite',
    );
  });

  it('clears destination and draft when switching quotations', async () => {
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({
        list: [quotationItin, quotationSingleDest],
        details: { [quotationItin.id]: quotationItin, [quotationSingleDest.id]: quotationSingleDest },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await searchAndPickQuotation('QT-000654');
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    expect((screen.getByLabelText('Select Destination') as HTMLSelectElement).value).toBe(
      'singapore',
    );
  });

  it('surfaces existing email validation for a bad manual recipient', async () => {
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({ sent: { ...sentRow, to: ['vendor@example.com'] } }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Kuala Lumpur');
    await waitFor(() =>
      expect((screen.getByLabelText('Email subject') as HTMLInputElement).value).not.toBe(''),
    );
    await userEvent.type(screen.getByLabelText('Email recipients'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Send Email' }));
    expect(await screen.findByText('Enter a valid recipient email.')).toBeInTheDocument();
    // Standalone sending still works after the failed attempt.
    await userEvent.clear(screen.getByLabelText('Email recipients'));
    await userEvent.type(screen.getByLabelText('Email recipients'), 'vendor@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send Email' }));
    expect(await screen.findByText(/Email sent to vendor@example.com/)).toBeInTheDocument();
  });

  it('sends the itinerary draft through the existing workflow without hotel content', async () => {
    const fetchMock = stubItineraryFlow({
      sent: { ...sentRow, to: ['vendor-sg@example.test'] },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    const send = screen.getByRole('button', { name: 'Send Email' });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      );
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body).toMatchObject({
      to: ['vendor-sg@example.test'],
      subject: 'Itinerary Details – Mohan Kumar – Singapore – 01-11-2026 to 02-11-2026',
    });
    expect(body.bodyHtml).toContain('Arrival in Singapore');
    expect(body.bodyHtml).not.toContain('Hotel stay charge');
    expect(await screen.findByText(/Email sent to vendor-sg@example.test/)).toBeInTheDocument();
  });
});

describe('Itinerary vendor email content builders', () => {
  it('groups days, matches masters exactly, and omits absent data', async () => {
    const {
      associationNames,
      buildItineraryBody,
      buildItinerarySubject,
      destinationDateRange,
      itineraryDestinationOptions,
      resolveDestinationMaster,
      servicesFor,
    } = await import('./ItineraryBookingEmail');

    const version = {
      itinerary: [
        { dayNumber: 2, destination: 'Kuala Lumpur' },
        { dayNumber: 1, destination: 'Singapore' },
        { dayNumber: 3, destination: ' singapore ' },
        { dayNumber: 4, destination: '' },
      ],
    } as never;
    const options = itineraryDestinationOptions(version);
    expect(options.map((row) => row.name)).toEqual(['Kuala Lumpur', 'Singapore']);
    expect(options[1]?.days.map((row) => (row as { dayNumber: number }).dayNumber)).toEqual([1, 3]);

    const masters = [
      { id: 'm-sg', name: 'Singapore', status: 'ACTIVE' },
      { id: 'm-kl', name: 'Kuala Lumpur', status: 'INACTIVE' },
      { id: 'm-kl2', name: 'Kuala Lumpur District', status: 'ACTIVE' },
    ];
    // Exact match wins; ACTIVE preferred; fuzzy names never substitute.
    expect(resolveDestinationMaster('Singapore', masters)?.id).toBe('m-sg');
    expect(resolveDestinationMaster('kuala lumpur', masters)?.id).toBe('m-kl');
    expect(resolveDestinationMaster('Kuala', masters)).toBeNull();
    expect(resolveDestinationMaster('', masters)).toBeNull();

    const names = associationNames('Singapore', {
      cities: [{ city: { name: 'Sentosa' } }, { city: null }],
    });
    expect(names.has('singapore')).toBe(true);
    expect(names.has('sentosa')).toBe(true);

    expect(
      servicesFor(
        [
          { serviceType: 'HOTEL', city: 'Singapore' },
          { serviceType: 'VEHICLE_TRANSFER', city: 'Singapore' },
          { serviceType: 'SIGHTSEEING', city: 'Nowhere' },
        ] as never,
        names,
      ).map((row) => (row as { serviceType: string }).serviceType),
    ).toEqual(['VEHICLE_TRANSFER']);

    expect(destinationDateRange([{ date: '2026-11-02' }, { date: '2026-11-01' }], null, null)).toBe(
      '01-11-2026 to 02-11-2026',
    );
    expect(destinationDateRange([], '2026-11-01', '2026-11-05')).toBe('01-11-2026 to 05-11-2026');
    expect(destinationDateRange([], null, null)).toBeNull();
    expect(
      buildItinerarySubject({ customerName: 'Mohan', destination: 'Goa', dateRange: null }),
    ).toBe('Itinerary Details – Mohan – Goa');

    const body = buildItineraryBody({
      quotation: {
        customerName: '<Mohan>',
        customerPhone: null,
        customerEmail: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
      },
      destinationName: 'Goa',
      dateRange: null,
      days: [
        {
          id: 'd-1',
          dayNumber: 1,
          date: null,
          title: 'Arrival',
          destination: 'Goa',
          description: '',
          meals: null,
          overnightLocation: null,
          activities: null,
          transfers: null,
          notes: null,
          sequence: 1,
        },
      ],
      sightseeingDays: [],
      services: [
        {
          serviceType: 'SIGHTSEEING',
          name: 'Paid <tour>',
          description: null,
          dayNumber: null,
          city: 'Goa',
          quantity: '1',
          sellingPrice: '9999',
          internalCost: '1111',
        },
      ] as never,
    });
    expect(body).not.toContain('<Mohan>');
    expect(body).toContain('&lt;Mohan&gt;');
    expect(body).toContain('Paid &lt;tour&gt;');
    expect(body).not.toContain('9999');
    expect(body).not.toContain('1111');
    expect(body).not.toContain('undefined');
  });
});

describe('Quotation selector dropdown', () => {
  const quotationA = {
    id: 'c0ffee00-0000-4000-8000-000000000071',
    quotationNumber: 'QT-000111',
    customerName: 'Mohan Kumar',
    destinationSummary: 'Singapore',
  };
  const quotationB = {
    id: 'c0ffee00-0000-4000-8000-000000000072',
    quotationNumber: 'QT-000222',
    customerName: 'Sara Khan',
    destinationSummary: 'Dubai',
  };
  const detailsA = {
    ...quotationA,
    customerPhone: '+91 91111 11111',
    customerEmail: 'mohan@example.test',
    currentVersionId: 'v-a',
    versions: [{ id: 'v-a', hotels: [] }],
  };

  function stubSelector({
    list = [quotationA, quotationB],
    details = { [quotationA.id]: detailsA },
    failQuotations = false,
  }: {
    list?: unknown[];
    details?: Record<string, unknown>;
    failQuotations?: boolean;
  } = {}) {
    const calls: string[] = [];
    const mock = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = String(request);
      calls.push(url);
      if (url.includes('/quotations')) {
        if (failQuotations) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Quotation search failed.' },
            }),
          } as Response;
        }
        const detailMatch = url.match(/\/quotations\/([^/?]+)(?:[?]|$)/);
        if (detailMatch && !url.includes('/quotations?'))
          return response(details[detailMatch[1]!] ?? null);
        const search = new URL(url, 'http://localhost').searchParams.get('search') ?? '';
        const rows = search
          ? list.filter((row) =>
              JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
            )
          : list;
        return response(historyPage(rows));
      }
      return response(historyPage([]));
    });
    return { mock, calls };
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([...ALL, 'quotations.view']);
  });

  it('opens the dropdown on focus with authorized options, without typing', async () => {
    const { mock } = stubSelector();
    vi.stubGlobal('fetch', mock);
    renderPage();
    await screen.findByText('Compose Email');

    // Nothing typed yet: focusing alone offers the first page.
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    const first = await screen.findByRole('button', { name: /QT-000111/ });
    expect(first).toBeVisible();
    expect(screen.getByRole('button', { name: /QT-000222/ })).toBeVisible();
    // First-page fetch carries no search term.
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          ([url]) =>
            String(url).includes('/quotations?') && !String(url).includes('search='),
        ),
      ).toBe(true),
    );
  });

  it('filters results while typing', async () => {
    const { mock } = stubSelector();
    vi.stubGlobal('fetch', mock);
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await screen.findByRole('button', { name: /QT-000111/ });

    await userEvent.type(screen.getByLabelText('Search quotations'), 'Sara');
    // The filtered fetch resolves asynchronously; wait for the match to
    // arrive (rather than asserting during the loading gap).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /QT-000222/ })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /QT-000111/ })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => String(url).includes('search=Sara')),
      ).toBe(true),
    );
  });

  it('selects a result, loads the quotation, and closes the dropdown', async () => {
    vi.stubGlobal('fetch', stubSelector().mock);
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await userEvent.click(await screen.findByRole('button', { name: /QT-000111/ }));
    // Selected quotation is displayed; the dropdown is gone.
    expect(await screen.findByText('QT-000111 · Mohan Kumar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /QT-000222/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search quotations')).not.toBeInTheDocument();
  });

  it('clears the selection and allows picking another quotation', async () => {
    vi.stubGlobal(
      'fetch',
      stubSelector({
        details: {
          [quotationA.id]: detailsA,
          [quotationB.id]: {
            ...detailsA,
            id: quotationB.id,
            quotationNumber: quotationB.quotationNumber,
            customerName: quotationB.customerName,
          },
        },
      }).mock,
    );
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await userEvent.click(await screen.findByRole('button', { name: /QT-000111/ }));
    expect(await screen.findByText('QT-000111 · Mohan Kumar')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await userEvent.click(await screen.findByRole('button', { name: /QT-000222/ }));
    expect(await screen.findByText('QT-000222 · Sara Khan')).toBeInTheDocument();
  });

  it('closes the dropdown on Escape and on outside pointer press', async () => {
    vi.stubGlobal('fetch', stubSelector().mock);
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await screen.findByRole('button', { name: /QT-000111/ });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /QT-000111/ })).not.toBeInTheDocument(),
    );

    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await screen.findByRole('button', { name: /QT-000111/ });
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /QT-000111/ })).not.toBeInTheDocument(),
    );
  });

  it('shows loading, empty, and error-with-retry states', async () => {
    // Loading: never-resolving fetch keeps the pending state visible.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    expect(await screen.findByText('Loading quotations…')).toBeInTheDocument();
    cleanup();

    // Empty: available list is blank.
    const empty = stubSelector({ list: [] });
    vi.stubGlobal('fetch', empty.mock);
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    expect(await screen.findByText('No quotations available.')).toBeInTheDocument();
    cleanup();

    // Error with retry: failing fetch shows an alert and a retry control.
    const failing = stubSelector({ failQuotations: true });
    vi.stubGlobal('fetch', failing.mock);
    renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    expect(await screen.findByText(/Quotation search failed/)).toBeInTheDocument();
    const before = failing.mock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(failing.mock.mock.calls.length).toBeGreaterThan(before));
  });

  it('renders the dropdown inside the composer flow, unclipped', async () => {
    vi.stubGlobal('fetch', stubSelector().mock);
    const { container } = renderPage();
    await screen.findByText('Compose Email');
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    const option = await screen.findByRole('button', { name: /QT-000111/ });
    // The list lives inside the compose section (in normal flow, not portalled).
    expect(
      container.querySelector('section[aria-label="Compose email"]'),
    ).toContainElement(option);
    expect(option).toBeVisible();
    // No clipping ancestors anywhere above the dropdown.
    let node: HTMLElement | null = option;
    while (node && node !== container) {
      const overflow = window.getComputedStyle(node).overflow;
      expect(overflow).not.toMatch(/hidden|auto|scroll/);
      node = node.parentElement;
    }
  });

  it('offers the same working selector in the Itinerary workflow', async () => {
    vi.stubGlobal('fetch', stubSelector().mock);
    renderPage();
    await screen.findByText('Compose Email');
    await userEvent.click(screen.getByRole('radio', { name: 'Itinerary' }));
    fireEvent.focus(screen.getByLabelText('Search quotations'));
    await userEvent.click(await screen.findByRole('button', { name: /QT-000111/ }));
    expect(await screen.findByText('QT-000111 · Mohan Kumar')).toBeInTheDocument();
  });
});
