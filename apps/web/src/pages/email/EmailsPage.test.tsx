import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

  it('lists sent emails with status and no module selectors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(historyPage([sentRow]))),
    );
    const { container } = renderPage();
    expect(await screen.findByText('Hotel Booking Confirmation')).toBeInTheDocument();
    expect(screen.getByText('hotel@example.com')).toBeInTheDocument();
    expect(screen.getByText('bookings@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThanOrEqual(1);
    // Standalone composer: no CRM entity selectors anywhere.
    for (const forbidden of [
      'Select Customer',
      'Select Vendor',
      'Select Hotel',
      'Select Booking',
      'Select Quotation',
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
