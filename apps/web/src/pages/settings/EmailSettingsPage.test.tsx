import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { EmailSettingsPage } from './EmailSettingsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const savedSettings = {
  id: 'cfg-1',
  provider: 'CUSTOM_SMTP',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  security: 'STARTTLS',
  smtpUsername: 'bookings@example.com',
  passwordConfigured: true,
  passwordSetAt: '2026-10-09T00:00:00.000Z',
  fromName: 'ABC Travels',
  fromEmail: 'bookings@example.com',
  replyTo: 'bookings@example.com',
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/settings/email" element={<EmailSettingsPage />} />
    </Routes>,
    { route: '/settings/email' },
  );
}

describe('Email settings page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['emails.manage_settings']);
  });

  it('loads saved configuration with the password masked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(savedSettings)),
    );
    renderPage();
    expect(await screen.findByDisplayValue('smtp.example.com')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('bookings@example.com')).toHaveLength(3);
    // Password field is empty with a masked placeholder — never the secret.
    const password = screen.getByLabelText('SMTP password') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(password.placeholder).toContain('leave blank to keep');
    expect(document.body.textContent).not.toContain('s3cret');
  });

  it('saves without a password when one is already configured', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'PUT' && url.endsWith('/email-settings')) return response(savedSettings);
      return response(savedSettings);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, options]) => String(url).endsWith('/email-settings') && options?.method === 'PUT',
      );
      expect(put).toBeDefined();
    });
    const put = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/email-settings') && options?.method === 'PUT',
    );
    const body = JSON.parse(String(put?.[1]?.body));
    expect(body).not.toHaveProperty('smtpPassword');
    expect(body.smtpHost).toBe('smtp.example.com');
  });

  it('sends a test email and shows the result', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/email-settings/test'))
        return response({ sent: true });
      return response(savedSettings);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.type(screen.getByLabelText('Test email recipient'), 'check@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send Test Email' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/email-settings/test') && options?.method === 'POST',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('Test email sent successfully.')).toBeInTheDocument();
  });

  it('shows a safe error when the test email fails', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'POST' && url.endsWith('/email-settings/test')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            success: false,
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication failed.' },
          }),
        } as Response;
      }
      return response(savedSettings);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.type(screen.getByLabelText('Test email recipient'), 'check@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send Test Email' }));
    expect(await screen.findByText('Authentication failed.')).toBeInTheDocument();
  });
});
