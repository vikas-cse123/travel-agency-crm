import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { QueryProvider } from '@/providers/QueryProvider';
import { AppShell, QUOTATION_BUILDER_EDIT_PATTERN } from './AppShell';
import { SIDEBAR_COLLAPSED_KEY } from '@/components/layout/sidebar/sidebar-state';

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    isSystemAdmin: false,
    isOwner: true,
    hasPermission: () => true,
  }),
}));

const EDIT_V1 = '/quotations/q1/versions/v1/edit';
const EDIT_V2 = '/quotations/q1/versions/v2/edit';

function BuilderStub() {
  const [panelOpen, setPanelOpen] = useState(true);
  return (
    <div>
      <h1>Quotation builder stub</h1>
      <Link to="/quotations">Back to list</Link> <Link to={EDIT_V2}>Version 2</Link>
      <button type="button" onClick={() => setPanelOpen((value) => !value)}>
        {panelOpen ? 'Hide internal panel' : 'Show internal panel'}
      </button>
      {panelOpen && <div>Internal editor panel</div>}
    </div>
  );
}

function shellRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="/quotations"
          element={
            <div>
              <h1>Quotations list</h1>
              <Link to={EDIT_V1}>Edit quotation</Link>
            </div>
          }
        />
        <Route path={QUOTATION_BUILDER_EDIT_PATTERN} element={<BuilderStub />} />
        <Route path="/dashboard" element={<div><h1>Dashboard</h1></div>} />
      </Route>
    </Routes>
  );
}

const expandButton = () => screen.getByRole('button', { name: 'Expand sidebar' });
const collapseButton = () => screen.getByRole('button', { name: 'Collapse sidebar' });
const mainNav = () => screen.getByRole('complementary', { name: 'Main navigation' });
const storedPreference = () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);

/**
 * Local harness (same providers as renderWithProviders) that also exposes a
 * rerender of the identical tree — needed to prove rerenders never toggle.
 */
function renderShell(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{shellRoutes()}</MemoryRouter>
    </QueryProvider>
  );
  const view = render(tree);
  return Object.assign(view, { rerenderShell: () => view.rerender(tree) });
}

/**
 * The quotation builder route auto-collapses the main application sidebar on
 * entry (render-derived, explicit, session-scoped) while the control stays
 * manually operable and the saved preference is never overwritten by the
 * route-forced value.
 */
describe('AppShell quotation-builder sidebar collapse', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('uses the real quotation-builder edit route pattern', () => {
    expect(QUOTATION_BUILDER_EDIT_PATTERN).toBe('/quotations/:quotationId/versions/:versionId/edit');
  });

  it('collapses when navigating from the list to Edit without touching the saved preference', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    renderShell('/quotations');
    expect(collapseButton()).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Edit quotation' }));
    expect(await screen.findByText('Quotation builder stub')).toBeInTheDocument();
    expect(expandButton()).toBeInTheDocument();
    expect(mainNav().className).toContain('lg:w-[var(--sidebar-width-collapsed)]');
    // The route-forced collapse is session-only: the saved preference is intact.
    expect(storedPreference()).toBe('false');
  });

  it('starts collapsed on direct entry and stays collapsed across versions', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    renderShell(EDIT_V1);
    // Synchronous query: the first paint is already collapsed (no flicker).
    expect(expandButton()).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Version 2' }));
    expect(await screen.findByText('Quotation builder stub')).toBeInTheDocument();
    expect(expandButton()).toBeInTheDocument();
  });

  it('does not reopen on refresh (fresh mount on the edit URL)', async () => {
    const user = userEvent.setup();
    const first = renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();
    // The user manually reopened before the refresh.
    await user.click(expandButton());
    expect(collapseButton()).toBeInTheDocument();
    first.unmount();

    renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();
  });

  it('does not toggle on rerenders and never persists the forced value', async () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    const view = renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();
    view.rerenderShell();
    expect(expandButton()).toBeInTheDocument();
    expect(storedPreference()).toBe('false');
  });

  it('lets the user manually reopen while editing and respects it afterwards', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    const view = renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();

    await user.click(expandButton());
    expect(collapseButton()).toBeInTheDocument();
    expect(mainNav().className).toContain('lg:w-[var(--sidebar-width-expanded)]');
    // A manual toggle writes the preference (existing app behavior), and a
    // rerender must not force it closed again.
    expect(storedPreference()).toBe('false');
    view.rerenderShell();
    expect(collapseButton()).toBeInTheDocument();
  });

  it('restores normal behavior when leaving the editor', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to list' }));
    expect(await screen.findByText('Quotations list')).toBeInTheDocument();
    expect(collapseButton()).toBeInTheDocument();
    expect(storedPreference()).toBe('false');
  });

  it('leaves the list and other pages on the saved preference', () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    const list = renderShell('/quotations');
    expect(collapseButton()).toBeInTheDocument();
    list.unmount();

    const dash = renderShell('/dashboard');
    expect(collapseButton()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    dash.unmount();

    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    renderShell('/quotations');
    expect(expandButton()).toBeInTheDocument();
  });

  it('keeps internal editor panels and page content functional while collapsed', async () => {
    const user = userEvent.setup();
    renderShell(EDIT_V1);
    expect(expandButton()).toBeInTheDocument();
    expect(screen.getByText('Internal editor panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide internal panel' }));
    expect(screen.queryByText('Internal editor panel')).not.toBeInTheDocument();
    expect(expandButton()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show internal panel' }));
    expect(screen.getByText('Internal editor panel')).toBeInTheDocument();
    expect(expandButton()).toBeInTheDocument();
  });
});
