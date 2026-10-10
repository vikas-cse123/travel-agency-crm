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

  it('hides removal and disables the test email when nothing is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No email configuration exists.' },
        }),
      }) as Response),
    );
    renderPage();
    await screen.findByText('Email Configuration');
    await waitFor(() =>
      expect(screen.getByLabelText('SMTP host') as HTMLInputElement).toHaveValue(''),
    );
    expect(screen.queryByRole('button', { name: 'Remove Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Test Email' })).toBeDisabled();
  });

  it('confirms before removing and resets the form on success', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'DELETE' && url.endsWith('/email-settings'))
        return response({ removed: true });
      return response(savedSettings);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByDisplayValue('smtp.example.com');

    // Opening the dialog sends nothing yet.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Configuration' }));
    expect(
      await screen.findByText(
        'Remove the configured sending email account? The CRM will no longer be able to send emails using these settings.',
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/email-settings') && options?.method === 'DELETE',
      ),
    ).toBe(false);

    // Cancel keeps the configuration.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith('/email-settings') && options?.method === 'DELETE',
      ),
    ).toBe(false);

    // Confirming removes and resets to the unconfigured state.
    await userEvent.click(screen.getByRole('button', { name: 'Remove Configuration' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Remove Configuration' })).find((button) =>
        dialog.contains(button),
      )!,
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/email-settings') && options?.method === 'DELETE',
        ),
      ).toBe(true);
    });
    expect(await screen.findByText('Email configuration removed.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('SMTP host') as HTMLInputElement).toHaveValue('');
    expect(screen.getByLabelText('SMTP username') as HTMLInputElement).toHaveValue('');
    expect(screen.getByLabelText('From email') as HTMLInputElement).toHaveValue('');
    // Password indicator cleared and test email disabled until reconfigured.
    expect(screen.getByLabelText('SMTP password').getAttribute('placeholder')).toBe('••••••••');
    expect(screen.queryByRole('button', { name: 'Remove Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Test Email' })).toBeDisabled();
    expect(document.body.textContent).not.toContain('s3cret');
  });

  it('shows an error and keeps the configuration when removal fails', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (init?.method === 'DELETE' && url.endsWith('/email-settings')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'database exploded' },
          }),
        } as Response;
      }
      return response(savedSettings);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await screen.findByDisplayValue('smtp.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Configuration' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Remove Configuration' })).find((button) =>
        dialog.contains(button),
      )!,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Configuration retained: values still filled, dialog stays open for retry.
    expect(screen.getByLabelText('SMTP host') as HTMLInputElement).toHaveValue('smtp.example.com');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
