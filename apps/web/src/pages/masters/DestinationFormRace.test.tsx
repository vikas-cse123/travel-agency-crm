import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { DestinationFormPage } from './DestinationFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const cityId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const city = {
  id: cityId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Jaipur',
  airportCode: 'JAI',
  status: 'ACTIVE',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'user-1', fullName: 'Aditi Rao' },
  _count: { destinationLinks: 1 },
};
const destination = {
  id: destinationId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Rajasthan Highlights',
  privateName: null,
  destinationType: 'DOMESTIC',
  status: 'ACTIVE',
  inclusions: '<p>Breakfast and <strong>transfers</strong></p>',
  exclusions: '<p>Flights</p>',
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: '<p>Passport required</p>',
  childPolicy: null,
  imageStorageProvider: null,
  imageFileName: null,
  imageMimeType: null,
  imageFileSize: null,
  imageConfirmedAt: null,
  hasImage: false,
  cities: [{ id: 'link-1', cityId, sequence: 0, city }],
  _count: { cities: 1 },
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'user-1', fullName: 'Aditi Rao' },
};
const lookups = {
  countries: [{ code: 'IN', name: 'India' }],
  cities: [{ id: cityId, name: 'Jaipur', airportCode: 'JAI', countryCode: 'IN' }],
};

function typeIntoEditor(label: string, html: string) {
  const editor = screen.getByRole('textbox', { name: label });
  editor.focus();
  // jsdom has no real typing into contentEditable: setting innerHTML and
  // firing input models one committed typing burst through the same handler.
  editor.innerHTML = html;
  fireEvent.input(editor);
  return editor as HTMLElement;
}

function renderEdit() {
  renderWithProviders(
    <Routes>
      <Route path="/masters/destinations/:destinationId/edit" element={<DestinationFormPage />} />
      <Route path="/masters/destinations/:destinationId" element={<div>Saved destination</div>} />
    </Routes>,
    { route: `/masters/destinations/${destinationId}/edit` },
  );
}

describe('Destination form editor race conditions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions.delete('masters.destinations.manage_images');
  });

  it('preserves user-typed inclusions when the server data arrives afterwards', async () => {
    let resolveDetail!: (value: unknown) => void;
    const detailGate = new Promise<unknown>((resolve) => {
      resolveDetail = resolve;
    });
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (url.endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH')
        return response({ ...destination, ...(JSON.parse(String(init?.body)) as object) });
      if (url.endsWith(`/api/masters/destinations/${destinationId}`))
        return detailGate.then(() => response(destination));
      return response(destination);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit Destination' });

    // Slow load (Computer A): the user starts typing before the GET resolves.
    const editor = typeIntoEditor('Inclusions', '<p>Typed before load</p>');
    expect(editor.textContent).toContain('Typed before load');

    resolveDetail(null);
    // Late server hydration must not discard what the user already typed.
    // Poll for the final state (allows intermediate commits to settle).
    await waitFor(
      () =>
        expect(screen.getByRole('textbox', { name: 'Inclusions' }).textContent).toContain(
          'Typed before load',
        ),
      { timeout: 3000 },
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update Destination' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update Destination' }));
    await screen.findByText('Saved destination');
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/masters/destinations/${destinationId}`) &&
        init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body)).inclusions).toContain('Typed before load');
  });

  it('saves the latest typed value when the user types rapidly then saves immediately', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (url.endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH')
        return response({ ...destination, ...(JSON.parse(String(init?.body)) as object) });
      return response(destination);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderEdit();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Inclusions' }).textContent).toContain(
        'Breakfast',
      ),
    );

    // Three rapid bursts with no awaits between them, then an immediate save.
    const editor = screen.getByRole('textbox', { name: 'Inclusions' });
    editor.focus();
    editor.innerHTML = '<p>First</p>';
    fireEvent.input(editor);
    editor.innerHTML = '<p>First second</p>';
    fireEvent.input(editor);
    editor.innerHTML = '<p>First second third</p>';
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Update Destination' }));

    await screen.findByText('Saved destination');
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/masters/destinations/${destinationId}`) &&
        init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body)).inclusions).toContain('First second third');
  });
});
