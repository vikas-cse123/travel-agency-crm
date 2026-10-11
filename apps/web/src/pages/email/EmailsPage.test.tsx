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

describe('Email sending status banner', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  function stubWithStatus(status: unknown) {
    return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith('/email-settings/status')) return response(status);
      if (init?.method === 'POST' && url.endsWith('/emails')) return response(sentRow);
      return response(historyPage([]));
    });
  }

  async function fillValidComposer() {
    await userEvent.type(screen.getByLabelText('Email recipients'), 'hotel@example.com');
    await userEvent.type(screen.getByLabelText('Email subject'), 'Hello');
    const editor = screen.getByLabelText('Email message');
    editor.innerHTML = '<p>Hello</p>';
    fireEvent.input(editor);
  }

  it('keeps SMTP management out of /emails, linking to settings instead', async () => {
    vi.stubGlobal(
      'fetch',
      stubWithStatus({
        connected: true,
        fromName: 'ABC Travels',
        fromEmail: 'contact@interscalemarketing.in',
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    expect(screen.queryByLabelText('SMTP host')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('SMTP password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Configuration' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Email Settings' });
    expect(link).toHaveAttribute('href', '/settings/email');
  });

  it('shows the connected sending account', async () => {
    vi.stubGlobal(
      'fetch',
      stubWithStatus({
        connected: true,
        fromName: 'ABC Travels',
        fromEmail: 'contact@interscalemarketing.in',
      }),
    );
    renderPage();
    expect(await screen.findByText(/Sending from:/)).toBeInTheDocument();
    expect(screen.getByText(/contact@interscalemarketing\.in/)).toBeInTheDocument();
    expect(screen.queryByText('Email is not connected.')).not.toBeInTheDocument();
  });

  it('shows not-connected with a settings link and disables Send', async () => {
    vi.stubGlobal('fetch', stubWithStatus({ connected: false, fromName: null, fromEmail: null }));
    renderPage();
    expect(await screen.findByText('Email is not connected.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Go to Email Settings' });
    expect(link).toHaveAttribute('href', '/settings/email');
    await fillValidComposer();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send Email' })).toBeDisabled(),
    );
  });

  it('treats a failed status check as unknown instead of not-connected', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (String(url).endsWith('/email-settings/status')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' },
          }),
        } as Response;
      }
      return response(historyPage([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(
      await screen.findByText('Could not verify the email connection status.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Email is not connected.')).not.toBeInTheDocument();
    // Unknown status must not block sending on its own.
    await fillValidComposer();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send Email' })).toBeEnabled());
  });

  it('renders Send as an enabled primary button when everything is valid', async () => {
    vi.stubGlobal(
      'fetch',
      stubWithStatus({
        connected: true,
        fromName: 'ABC Travels',
        fromEmail: 'contact@interscalemarketing.in',
      }),
    );
    renderPage();
    await fillValidComposer();
    const send = await screen.findByRole('button', { name: 'Send Email' });
    await waitFor(() => expect(send).toBeEnabled());
    expect(send.className).toMatch(/bg-primary/);
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

  const leadDetailId = '11111111-1111-4222-8222-111111111111';
  const quotationNamed = {
    ...quotationOne,
    id: 'c0ffee00-0000-4000-8000-000000000004',
    quotationNumber: 'QT-000124',
    queryId: leadDetailId,
    adultNames: ['Rahul Sharma', 'Priya Sharma'],
    childWithBedNames: ['Aarav Sharma'],
    childWithoutBedNames: ['', 'Anaya Sharma'],
    infantNames: ['Ira Sharma'],
  };
  const quotationBare = {
    ...quotationOne,
    id: 'c0ffee00-0000-4000-8000-000000000005',
    quotationNumber: 'QT-000125',
    queryId: leadDetailId,
  };
  const leadNamed = {
    id: leadDetailId,
    adultNames: ['Lead Adult'],
    childWithBedNames: [],
    childWithoutBedNames: [],
    infantNames: [],
  };
  const leadBare = { id: leadDetailId };

  function stubHotelFlow({
    list = [quotationOne],
    details = { [quotationOne.id]: quotationOne },
    master = hotelMaster,
    sent = sentRow,
    lead = null as Record<string, unknown> | null,
  }: {
    list?: unknown[];
    details?: Record<string, unknown>;
    master?: unknown;
    sent?: unknown;
    lead?: Record<string, unknown> | null;
  } = {}) {
    return vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/emails')) return response(sent);
      if (/\/masters\/hotels\/[^/?]+$/.test(url)) return response(master);
      const leadMatch = url.match(/\/queries\/([^/?]+)(?:[?]|$)/);
      if (leadMatch && !url.includes('/queries?'))
        return response(lead?.[leadMatch[1]!] ?? null);
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
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10 November 2026 to 14 November 2026',
    );
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).toContain('Dear Reservations Team');
    expect(message).toContain('Mohan Kumar');
    expect(message).toContain('+91 91111 11111');
    expect(message).toContain('Palace Road, Jaipur');
    expect(message).toContain('Check-in date: 10 November 2026');
    expect(message).toContain('Check-out date: 14 November 2026');
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
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10 November 2026 to 14 November 2026',
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
      subject:
        'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10 November 2026 to 14 November 2026',
    });
    expect(await screen.findByText(/Email sent to reservations@shahpalace.test/)).toBeInTheDocument();
  });

  it('includes quotation traveller names in the hotel draft', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({
        list: [quotationNamed],
        details: { [quotationNamed.id]: quotationNamed },
        lead: { [leadDetailId]: leadNamed },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000124');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');

    const message = () => screen.getByLabelText('Email message').textContent ?? '';
    await waitFor(() => expect(message()).toContain('Traveller Details'));
    // Quotation's own names win over the lead fallback.
    expect(message()).toContain('Adult 1: Rahul Sharma');
    expect(message()).toContain('Adult 2: Priya Sharma');
    expect(message()).toContain('Child With Bed 1: Aarav Sharma');
    expect(message()).toContain('Child Without Bed 2: Anaya Sharma');
    expect(message()).toContain('Infant 1: Ira Sharma');
    // The blank first Child Without Bed slot is skipped, never invented.
    expect(message()).not.toContain('Child Without Bed 1:');
    expect(message()).not.toContain('Lead Adult');
  });

  it('falls back to lead names when the quotation has none', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({
        list: [quotationBare],
        details: { [quotationBare.id]: quotationBare },
        lead: { [leadDetailId]: leadNamed },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000125');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');

    const message = () => screen.getByLabelText('Email message').textContent ?? '';
    await waitFor(() => expect(message()).toContain('Traveller Details'));
    expect(message()).toContain('Adult 1: Lead Adult');
  });

  it('omits Traveller Details when no names exist anywhere', async () => {
    vi.stubGlobal(
      'fetch',
      stubHotelFlow({
        list: [quotationBare],
        details: { [quotationBare.id]: quotationBare },
        lead: { [leadDetailId]: leadBare },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await searchAndPickQuotation('QT-000125');
    await screen.findByLabelText('Select Hotel');
    pickHotel('Shah Palace Hotel');

    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue(
        'reservations@shahpalace.test',
      ),
    );
    expect(screen.getByLabelText('Email message').textContent ?? '').not.toContain(
      'Traveller Details',
    );
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
    const {
      buildHotelBookingBody,
      buildHotelBookingSubject,
      escapeHtml,
      formatStayDate,
      formatStayDateLong,
    } = await import('./HotelBookingEmail');
    expect(escapeHtml('<b>&"evil"</b>')).toBe('&lt;b&gt;&amp;&quot;evil&quot;&lt;/b&gt;');
    expect(formatStayDate('2026-11-10T00:00:00.000Z')).toBe('10-11-2026');
    expect(formatStayDate(null)).toBeNull();
    expect(formatStayDate('garbage')).toBeNull();
    // Month-name format for generated subjects and bodies: no timezone
    // shift (the UTC instant keeps its calendar day) and no placeholders.
    expect(formatStayDateLong('2026-11-10T00:00:00.000Z')).toBe('10 November 2026');
    expect(formatStayDateLong('2026-11-01')).toBe('1 November 2026');
    expect(formatStayDateLong('2026-10-18T00:00:00.000Z')).toBe('18 October 2026');
    expect(formatStayDateLong(null)).toBeNull();
    expect(formatStayDateLong('garbage')).toBeNull();
    expect(formatStayDateLong('2026-13-01')).toBeNull();
    expect(
      buildHotelBookingSubject({
        customerName: 'Mohan Kumar',
        hotelName: 'Shah Palace Hotel',
        checkInDate: '2026-11-10T00:00:00.000Z',
        checkOutDate: '2026-11-14T00:00:00.000Z',
      }),
    ).toBe(
      'Hotel Booking Request – Mohan Kumar – Shah Palace Hotel – 10 November 2026 to 14 November 2026',
    );
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

describe('Traveller name resolution helpers', () => {
  it('orders entries by category, numbers per category, and skips blanks', async () => {
    const { travellerNameEntries, resolveTravellerNames, travellerNameItems } = await import(
      './travellerNames'
    );
    expect(
      travellerNameEntries({
        adultNames: ['Rahul Sharma', '  '],
        childWithBedNames: ['Aarav Sharma'],
        childWithoutBedNames: ['', 'Anaya Sharma'],
        infantNames: [null, 'Ira Sharma'],
      }),
    ).toEqual([
      { label: 'Adult 1', name: 'Rahul Sharma' },
      { label: 'Child With Bed 1', name: 'Aarav Sharma' },
      { label: 'Child Without Bed 2', name: 'Anaya Sharma' },
      { label: 'Infant 2', name: 'Ira Sharma' },
    ]);
    expect(travellerNameEntries(null)).toEqual([]);
    expect(travellerNameEntries({})).toEqual([]);

    // Quotation wins; an all-blank quotation falls back to the lead; empty is empty.
    const quotation = { adultNames: ['Q Adult'] };
    const lead = { adultNames: ['Lead Adult'] };
    expect(resolveTravellerNames(quotation, lead).source).toBe('quotation');
    expect(resolveTravellerNames({ adultNames: ['  '] }, lead).source).toBe('lead');
    expect(resolveTravellerNames(null, null)).toEqual({ source: null, entries: [] });

    const items = travellerNameItems([{ label: 'Adult 1', name: '<Rahul>&' }]).join('');
    expect(items).toContain('&lt;Rahul&gt;&amp;');
    expect(items).not.toContain('<Rahul>');
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

  const quotationItinNamed = {
    ...quotationItin,
    id: 'c0ffee00-0000-4000-8000-000000000064',
    quotationNumber: 'QT-000322',
    queryId: '22222222-2222-4222-8222-222222222222',
    adultNames: ['Rahul Sharma', 'Priya Sharma'],
    childWithBedNames: ['Aarav Sharma'],
    childWithoutBedNames: [],
    infantNames: [],
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
    const { buildWhatsAppSummary, whatsappMarkdownToHtml } = await import(
      '@/features/quotations/whatsappSummary'
    );
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
      'Itinerary Details – Mohan Kumar – Singapore – 1 November 2026 to 2 November 2026',
    );
    // The body is the shared WhatsApp template over the whole version —
    // identical for every destination of the quotation.
    const expectedHtml = whatsappMarkdownToHtml(
      buildWhatsAppSummary({
        quotation: quotationItin as never,
        version: versionMulti as never,
        weblinkUrl: null,
        companyName: 'Travel Agency CRM',
        preparedByName: null,
      }),
      { wrap: false },
    );
    const probe = document.createElement('div');
    probe.innerHTML = expectedHtml;
    const message = screen.getByLabelText('Email message').textContent ?? '';
    expect(message).toBe(probe.textContent);
    expect(message).toContain('Greetings from');
    expect(message).toContain('Travel Date:');
    expect(message).toContain('Travelers:');
    expect(message).toContain('2 Adults, 1 Child');
    expect(message).toContain('Destinations:');
    expect(message).toContain('Singapore · Kuala Lumpur');
    expect(message).toContain('ITINERARY');
    expect(message).toContain('City highlights');
    expect(message).toContain('Gardens by the Bay');
    // Whole-version content: the other destination's sightseeing is included,
    // and the old email-only sections are gone.
    expect(message).toContain('Other city day');
    expect(message).toContain('Far away tour');
    expect(message).not.toContain('Trip Overview');
    expect(message).not.toContain('Traveller Details');
    expect(message).not.toContain('Day-by-Day Itinerary');
    // Pricing internals never leak into the vendor draft.
    expect(message).not.toContain('15000');
    expect(message).not.toContain('Travel insurance');
    expect(message).not.toContain('Hotel stay charge');
    // A request, never a confirmation.
    expect(message).not.toMatch(/confirm(ed|ation of your booking)|booking is confirmed/i);
    // Selecting never sends automatically.
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/emails') && options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('excludes per-guest names like the WhatsApp message does', async () => {
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({
        list: [quotationItinNamed],
        details: { [quotationItinNamed.id]: quotationItinNamed },
      }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000322');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');

    const message = () => screen.getByLabelText('Email message').textContent ?? '';
    await waitFor(() =>
      expect(screen.getByLabelText('Email recipients')).toHaveValue('vendor-sg@example.test'),
    );
    // Quotation traveller names exist but the shared template carries only
    // counts — never individual names.
    expect(message()).toContain('2 Adults, 1 Child');
    expect(message()).not.toContain('Traveller Details');
    expect(message()).not.toContain('Rahul Sharma');
    expect(message()).not.toContain('Priya Sharma');
    expect(message()).not.toContain('Aarav Sharma');
  });

  it('keeps the same shared body when the destination changes', async () => {
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
    const singaporeBody = screen.getByLabelText('Email message').textContent ?? '';

    // Recipient and subject follow the new selection; the shared body does not.
    pickDestination('Kuala Lumpur');
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    expect(screen.getByLabelText('Email subject')).toHaveValue(
      'Itinerary Details – Mohan Kumar – Kuala Lumpur – 3 November 2026 to 4 November 2026',
    );
    expect(screen.getByLabelText('Email message').textContent ?? '').toBe(singaporeBody);
  });

  it('omits Traveller Details from the itinerary draft when no names exist', async () => {
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
    expect(screen.getByLabelText('Email message').textContent ?? '').not.toContain(
      'Traveller Details',
    );
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
      'Itinerary Details – Mohan Kumar – Kuala Lumpur – 3 November 2026 to 4 November 2026',
    );
    const message = screen.getByLabelText('Email message').textContent ?? '';
    // The shared body covers the whole version regardless of destination.
    expect(message).toContain('ITINERARY');
    expect(message).toContain('City highlights');
    expect(message).toContain('Other city day');
  });

  it('lists a lone destination without a master email and keeps To empty', async () => {
    const klOnly = {
      ...quotationItin,
      id: 'c0ffee00-0000-4000-8000-000000000065',
      quotationNumber: 'QT-000655',
      currentVersionId: 'c0ffee00-0000-4000-8000-000000000055',
      versions: [
        {
          ...versionMulti,
          id: 'c0ffee00-0000-4000-8000-000000000055',
          itinerary: [itineraryRows[2]],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      stubItineraryFlow({ list: [klOnly], details: { [klOnly.id]: klOnly } }),
    );
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000655');
    await screen.findByLabelText('Select Destination');
    // Exactly one eligible option — the quotation's single destination group.
    const select = screen.getByLabelText('Select Destination') as HTMLSelectElement;
    expect(select.querySelectorAll('option')).toHaveLength(2);
    pickDestination('Kuala Lumpur');
    // No master email: warning explains what is missing, and the To value
    // stays empty — placeholder example text is never treated as a contact.
    expect(await screen.findByText(/has no email address/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Email recipients')).toHaveValue(''));
    expect(screen.getByLabelText('Email recipients').getAttribute('value')).toBe('');
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
      subject: 'Itinerary Details – Mohan Kumar – Singapore – 1 November 2026 to 2 November 2026',
    });
    // Posted body is the shared WhatsApp template, not the old format.
    expect(body.bodyHtml).toContain('ITINERARY');
    expect(body.bodyHtml).toContain('City highlights');
    expect(body.bodyHtml).not.toContain('Trip Overview');
    expect(body.bodyHtml).not.toContain('Hotel stay charge');
    expect(await screen.findByText(/Email sent to vendor-sg@example.test/)).toBeInTheDocument();
  });

  it('provisions the quotation Weblink and sends it as a clickable anchor in the email', async () => {
    const weblink = 'https://weblink.example.test/q/qt-000321';
    const base = stubItineraryFlow();
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.includes('/public-link')) {
        return response({ url: weblink });
      }
      return base(request, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByText('Compose Email');
    await pickPurposeItinerary();
    await searchAndPickQuotation('QT-000321');
    await screen.findByLabelText('Select Destination');
    pickDestination('Singapore');
    // The flow provisions the public link for the applicable version.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).includes('/public-link') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
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
    // Same section and URL as the WhatsApp share, clickable in the email.
    expect(body.bodyHtml).toContain('Click on Weblink for Pricing &amp; more details:');
    expect(body.bodyHtml).toContain(`<a href="${weblink}"`);
    expect(body.bodyHtml).toContain(`>${weblink}</a>`);
  });
});

describe('Itinerary vendor email content builders', () => {
  it('groups days, matches masters exactly, and omits absent data', async () => {
    const {
      associationNames,
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
      '1 November 2026 to 2 November 2026',
    );
    // Double-digit days order chronologically, not alphabetically.
    expect(
      destinationDateRange([{ date: '2026-11-10' }, { date: '2026-11-02' }], null, null),
    ).toBe('2 November 2026 to 10 November 2026');
    expect(destinationDateRange([], '2026-11-01', '2026-11-05')).toBe(
      '1 November 2026 to 5 November 2026',
    );
    expect(destinationDateRange([], null, null)).toBeNull();
    expect(
      buildItinerarySubject({ customerName: 'Mohan', destination: 'Goa', dateRange: null }),
    ).toBe('Itinerary Details – Mohan – Goa');
  });

  it('builds the email body from the shared WhatsApp generator without its own format', async () => {
    const { buildItineraryEmailBody } = await import('./ItineraryBookingEmail');
    const { buildWhatsAppSummary, whatsappMarkdownToHtml } = await import(
      '@/features/quotations/whatsappSummary'
    );
    const quotation = {
      customerName: 'Mohan Kumar',
      customerPhone: '+91 91111 11111',
      customerEmail: 'mohan@example.test',
      destinationSummary: 'Singapore · Kuala Lumpur',
      adults: 2,
      childrenWithBed: 1,
      childrenWithoutBed: 0,
      infants: 0,
    };
    const version = {
      travelStartDate: '2026-11-01',
      travelEndDate: '2026-11-05',
      destinationSummary: 'Singapore · Kuala Lumpur',
      hotels: [{ hotelName: 'Paid <tour>', category: '5-Star', sequence: 1 }],
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: 'City highlights',
            city: 'Singapore',
            date: '2026-11-01',
            dailyTransfer: 'PRIVATE',
            activities: [{ name: 'Gardens by the Bay', startTime: '09:00', description: null }],
          },
        ],
      },
      itinerary: [],
      services: [
        {
          serviceType: 'SIGHTSEEING',
          name: 'KL tower visit',
          description: null,
          dayNumber: 3,
          city: 'Kuala Lumpur',
          quantity: '2',
          sellingPrice: '4000',
          internalCost: '2500',
        },
      ],
      flightDetails: {
        include: true,
        entryMode: 'MANUAL',
        journeyType: 'ONEWAY_RETURN',
        outbound: { segments: [] },
        returnJourney: {
          segments: [
            {
              airlineName: 'Air India',
              flightNumber: 'AI 380',
              from: 'SIN',
              to: 'DEL',
              departureTime: '18:00',
              arrivalTime: '21:00',
              departureDate: '2026-11-05',
            },
          ],
        },
      },
    };

    const input = {
      quotation: quotation as never,
      version: version as never,
      companyName: 'ABC Travels',
      preparedByName: 'Priya Nair',
    };
    // Byte parity with a direct composition of the shared pieces (same
    // unwrapped variant the email composer renders).
    expect(buildItineraryEmailBody(input)).toBe(
      whatsappMarkdownToHtml(
        buildWhatsAppSummary({
          quotation: quotation as never,
          version: version as never,
          weblinkUrl: null,
          companyName: 'ABC Travels',
          preparedByName: 'Priya Nair',
        }),
        { wrap: false },
      ),
    );

    const body = buildItineraryEmailBody(input);
    // Same wording, sections, hotels, sightseeing, dates, travellers.
    expect(body).toContain('Greetings from');
    expect(body).toContain('ABC Travels');
    expect(body).toContain('Travel Date:');
    expect(body).toContain('Travelers:');
    expect(body).toContain('2 Adults, 1 Child');
    expect(body).toContain('HOTELS');
    expect(body).toContain('Paid &lt;tour&gt;');
    expect(body).toContain('ITINERARY');
    expect(body).toContain('City highlights');
    expect(body).toContain('Gardens by the Bay');
    expect(body).toContain('Prepared by:');
    expect(body).toContain('Priya Nair');
    expect(body).not.toContain('<tour>');
    // Optional flight/cruise/vehicle sections stay off; service pricing and
    // non-cruise/vehicle services never leak into the vendor draft.
    expect(body).not.toContain('FLIGHT DETAILS');
    expect(body).not.toContain('Air India');
    expect(body).not.toContain('KL tower visit');
    expect(body).not.toContain('4000');
    expect(body).not.toContain('2500');
    expect(body).not.toContain('undefined');

    // Missing dates and empty sections are omitted gracefully.
    const bare = buildItineraryEmailBody({
      quotation: { ...quotation, adults: 0, childrenWithBed: 0 } as never,
      version: { travelStartDate: null, itinerary: [], sightseeingDetails: null, services: [] } as never,
      companyName: null,
      preparedByName: null,
    });
    expect(bare).not.toContain('Travel Date:');
    expect(bare).not.toContain('Travelers:');
    expect(bare).not.toContain('ITINERARY');
    expect(bare).toContain('Travel Agency CRM');
  });

  it('includes the quotation Weblink in the email body as a clickable anchor', async () => {
    const { buildItineraryEmailBody } = await import('./ItineraryBookingEmail');
    const { buildWhatsAppSummary } = await import(
      '@/features/quotations/whatsappSummary'
    );
    const quotation = {
      customerName: 'Mohan Kumar',
      customerPhone: '+91 91111 11111',
      customerEmail: 'mohan@example.test',
      destinationSummary: 'Singapore',
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
    };
    const version = {
      travelStartDate: '2026-11-01',
      travelEndDate: '2026-11-05',
      destinationSummary: 'Singapore',
      hotels: [],
      itinerary: [],
      services: [],
    };
    const input = {
      quotation: quotation as never,
      version: version as never,
      companyName: 'ABC Travels',
      preparedByName: 'Priya Nair',
    };
    // Without a provisioned URL the section stays omitted, as before.
    expect(buildItineraryEmailBody(input)).not.toContain('Click on Weblink');
    // With a URL the email carries the same section as the WhatsApp share.
    const url = 'https://crm.example.test/q/abc123';
    const body = buildItineraryEmailBody({ ...input, weblinkUrl: url });
    const markdown = buildWhatsAppSummary({
      quotation: quotation as never,
      version: version as never,
      weblinkUrl: url,
      companyName: 'ABC Travels',
      preparedByName: 'Priya Nair',
    });
    expect(markdown).toContain('Click on Weblink for Pricing & more details:');
    expect(markdown).toContain(url);
    expect(body).toContain('Click on Weblink for Pricing &amp; more details:');
    expect(body).toContain(`<a href="${url}"`);
    expect(body).toContain(`>${url}</a>`);
    // Query-string ampersands are HTML-escaped in both href and label.
    const tricky = buildItineraryEmailBody({
      ...input,
      weblinkUrl: 'https://crm.example.test/q/abc123?x=1&y=2',
    });
    expect(tricky).toContain('href="https://crm.example.test/q/abc123?x=1&amp;y=2"');
    expect(tricky).toContain('>https://crm.example.test/q/abc123?x=1&amp;y=2</a>');
    expect(tricky).not.toContain('?x=1&y=2</a>');
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
