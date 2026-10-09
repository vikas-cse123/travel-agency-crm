import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { Topbar } from './Topbar';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      fullName: 'Aditi Rao',
      email: 'aditi@example.com',
      company: { name: 'Acme Travels' },
      role: { name: 'Owner' },
    },
    hasPermission: (key: string) => auth.permissions.has(key),
  }),
}));

vi.mock('@/features/auth/auth.api', () => ({
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderTopbar() {
  return renderWithProviders(
    <Topbar onOpenMobile={() => undefined} breadcrumbs={['Home', 'Dashboard']} />,
  );
}

describe('Topbar dead features', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'reminders.view',
      'booking_reminders.view',
      'notifications.view',
      'notifications.settings',
    ]);
  });

  it('does not render a notification bell even with notification permissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response),
    );
    renderTopbar();
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
    // No clickable notification entry point remains in the header.
    expect(screen.queryByRole('link', { name: /unread notifications/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /notification/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/reminders/notifications"]')).toBeNull();
  });

  it('keeps the header essentials (navigation toggle, breadcrumbs, user menu)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response),
    );
    renderTopbar();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Aditi Rao')).toBeInTheDocument();
  });
});
