import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { APP_NAME } from '@interscale/shared';
import { SidebarHeader } from './SidebarHeader';

const auth = vi.hoisted(() => ({
  user: null as {
    company?: {
      name: string;
      logoUrl?: string | null;
      customDomain?: { hostname: string } | null;
    };
  } | null,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: auth.user }),
}));

const originalLocation = window.location;
const setHost = (host: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: host },
  });
};

afterAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

const props = {
  onToggleCollapse: () => undefined,
  onCloseMobile: () => undefined,
};

describe('SidebarHeader custom-domain branding', () => {
  beforeEach(() => {
    auth.user = null;
  });

  it('shows only the full product logo on the default platform domain', () => {
    setHost('app.travelagencycrm.in');
    auth.user = {
      company: { name: 'Easy Tour and Travels', customDomain: { hostname: 'crm.easytour.com' } },
    };
    renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    const logo = document.querySelector('img[src="/logo-Full.png"]');
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute('alt', 'Travel Agency CRM');
    expect(screen.queryByText(APP_NAME)).not.toBeInTheDocument();
    expect(screen.queryByText('Easy Tour and Travels')).not.toBeInTheDocument();
  });

  it('shows the Company name on its ACTIVE custom domain', () => {
    setHost('crm.easytour.com');
    auth.user = {
      company: { name: 'Easy Tour and Travels', customDomain: { hostname: 'crm.easytour.com' } },
    };
    renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    expect(screen.getByText('Easy Tour and Travels')).toBeInTheDocument();
    expect(screen.queryByText(APP_NAME)).not.toBeInTheDocument();
  });

  it('shows the Company logo when present on the custom domain', () => {
    setHost('crm.easytour.com');
    auth.user = {
      company: {
        name: 'Easy Tour',
        logoUrl: 'https://example.com/logo.png',
        customDomain: { hostname: 'crm.easytour.com' },
      },
    };
    renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('falls back to the platform logo when the Company has no logo', () => {
    setHost('crm.easytour.com');
    auth.user = {
      company: { name: 'Easy Tour', logoUrl: null, customDomain: { hostname: 'crm.easytour.com' } },
    };
    renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', '/logo.png');
    expect(screen.getByText('Easy Tour')).toBeInTheDocument();
  });

    it('truncates a long Company name without breaking the sidebar', () => {    setHost('crm.easytour.com');
    const longName =
      'Easy Tour and Travels Limited a very long company name that must truncate cleanly';
    auth.user = { company: { name: longName, customDomain: { hostname: 'crm.easytour.com' } } };
    renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    const name = screen.getByText(longName);
    expect(name.className).toContain('truncate');
    expect(name).toHaveAttribute('title', longName);
  });

  it('shows the compact mark (not the full logo) on the collapsed rail', () => {
    setHost('app.travelagencycrm.in');
    auth.user = null;
    renderWithProviders(<SidebarHeader collapsed {...props} />);
    expect(document.querySelector('img[src="/logo.png"]')).not.toBeNull();
    expect(document.querySelector('img[src="/logo-Full.png"]')).toBeNull();
    expect(screen.queryByText(APP_NAME)).not.toBeInTheDocument();
  });

  it('keeps the brand unit on one shared center line without layout shift', () => {
    setHost('app.travelagencycrm.in');
    auth.user = null;
    const { container } = renderWithProviders(<SidebarHeader collapsed={false} {...props} />);
    // Header row: single flex row, vertically centered, fixed height.
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain('flex');
    expect(row.className).toContain('items-center');
    expect(row.className).toContain('h-14');
    // Full logo: block-level, fills the available header width at a readable
    // height, aspect preserved, left-anchored, no wrapper box.
    const logo = container.querySelector('img[src="/logo-Full.png"]') as HTMLElement;
    expect(logo).not.toBeNull();
    expect(logo.className).toContain('block');
    expect(logo.className).toContain('w-full');
    expect(logo.className).toContain('flex-1');
    expect(logo.className).toContain('h-12');
    expect(logo.className).toContain('object-contain');
    expect(logo.className).toContain('object-left');
  });
});
