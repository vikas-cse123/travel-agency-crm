import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/utils';
import { DestinationFormPage } from './DestinationFormPage';
import { DestinationDetailsPage } from './DestinationDetailsPage';

let capturedClient: QueryClient | null = null;
function CaptureClient() {
  capturedClient = useQueryClient();
  return null;
}

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
const oldChildPolicy = '<ul><li>Age 1–2: Free (no bed)</li></ul>';
const seed = {
  id: destinationId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Rajasthan Highlights',
  privateName: null,
  destinationType: 'DOMESTIC',
  status: 'ACTIVE',
  inclusions: '<p>Old inclusions</p>',
  exclusions: '<p>Old exclusions</p>',
  paymentPolicies: '<p>Old payment policies</p>',
  cancellationPolicies: '<p>Old cancellation policies</p>',
  bookingTerms: '<p>Old booking terms</p>',
  childPolicy: oldChildPolicy,
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

// Full incident content: age slabs plus the Important Notes block.
const newChildPolicy =
  '<ul><li>Age 1–2: Free (no bed)</li><li>Age 3–4: 30% of adult price (no bed)</li>' +
  '<li>Age 5–8: 50% of adult price (no bed)</li>' +
  '<li>Age 9–11: 75% of adult price (no bed); 85% of adult price with bed</li>' +
  '<li>Age 12 and above: Adult price (with bed)</li></ul><h3>Important Notes</h3>' +
  '<ul><li>Vehicle usage will remain strictly according to the confirmed itinerary.</li>' +
  '<li>All scheduled pickups will take place from the designated hotel pickup point or hotel lobby.</li>' +
  '<li>No amendments will be permitted after the tour has commenced.</li></ul>';
const newPolicies: Record<string, string> = {
  inclusions: '<ul><li>New inclusions</li></ul>',
  exclusions: '<ul><li>New exclusions</li></ul>',
  childPolicy: newChildPolicy,
  paymentPolicies: '<p>New payment policies</p>',
  cancellationPolicies: '<p>New cancellation policies</p>',
  bookingTerms: '<p>New booking terms</p>',
};
const editorLabel: Record<string, string> = {
  inclusions: 'Inclusions',
  exclusions: 'Exclusions',
  childPolicy: 'Child Policy',
  paymentPolicies: 'Payment Policies',
  cancellationPolicies: 'Cancellation Policies',
  bookingTerms: 'Booking Terms & Conditions',
};
const tabLabel: Record<string, string> = {
  inclusions: 'Inclusions',
  exclusions: 'Exclusions',
  childPolicy: 'Child Policy',
  paymentPolicies: 'Payment Policies',
  cancellationPolicies: 'Cancellation Policies',
  bookingTerms: 'Terms & Conditions',
};

function typeIntoEditor(label: string, html: string) {
  const editor = screen.getByRole('textbox', { name: label });
  editor.focus();
  editor.innerHTML = html;
  fireEvent.input(editor);
}

describe('Destination policy edit-save-details-refresh sync', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions.delete('masters.destinations.manage_images');
  });

  it('sends every edited policy in PATCH and shows it on details across refresh', async () => {
    let stored: Record<string, unknown> = { ...seed };
    let patched = false;
    let releaseRefetch!: () => void;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (url.endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH') {
        stored = { ...stored, ...(JSON.parse(String(init?.body)) as object) };
        patched = true;
        return response(stored);
      }
      if (url.endsWith(`/api/masters/destinations/${destinationId}`)) {
        // Hold the post-save server re-read: the details page must already
        // show the saved policies from the seeded mutation response.
        if (patched) await refetchGate;
        return response(stored);
      }
      return response(stored);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/masters/destinations/:destinationId/edit" element={<DestinationFormPage />} />
        <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
      </Routes>,
      { route: `/masters/destinations/${destinationId}/edit` },
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Child Policy' }).textContent).toContain('Age 1–2'),
    );

    for (const [field, html] of Object.entries(newPolicies)) typeIntoEditor(editorLabel[field]!, html);
    fireEvent.click(screen.getByRole('button', { name: 'Update Destination' }));

    // Save lands on the details page; every new policy value is displayed.
    await screen.findByText('Destination Details');
    for (const [field, label] of Object.entries(tabLabel)) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      const panel = screen.getByRole('tabpanel');
      if (field === 'childPolicy') {
        expect(panel.textContent).toContain('Important Notes');
        expect(panel.textContent).toContain(
          'No amendments will be permitted after the tour has commenced.',
        );
      } else {
        expect(panel.textContent).toContain(
          (stored[field] as string).replace(/<[^>]+>/g, '').slice(0, 20),
        );
      }
    }

    // The PATCH carried every new policy value.
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/masters/destinations/${destinationId}`) &&
        init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as Record<string, unknown>;
    for (const [field, html] of Object.entries(newPolicies)) expect(body[field]).toBe(html);

    // Release the held server re-read: the seeded content must remain.
    releaseRefetch();
    fireEvent.click(screen.getByRole('tab', { name: 'Child Policy' }));
    await waitFor(() =>
      expect(screen.getByRole('tabpanel').textContent).toContain('Important Notes'),
    );

    // Refresh: a fresh details mount still shows the saved content.
    cleanup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
      </Routes>,
      { route: `/masters/destinations/${destinationId}` },
    );
    await screen.findByText('Destination Details');
    fireEvent.click(screen.getByRole('tab', { name: 'Child Policy' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('Important Notes');
  });

  it('keeps typed policies when unrelated server data changes mid-edit', async () => {
    let stored: Record<string, unknown> = { ...seed };
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (url.endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH') {
        stored = { ...stored, ...(JSON.parse(String(init?.body)) as object) };
        return response(stored);
      }
      if (url.endsWith(`/api/masters/destinations/${destinationId}`)) return response(stored);
      return response(stored);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <>
        <CaptureClient />
        <Routes>
          <Route path="/masters/destinations/:destinationId/edit" element={<DestinationFormPage />} />
          <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
        </Routes>
      </>,
      { route: `/masters/destinations/${destinationId}/edit` },
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Child Policy' }).textContent).toContain('Age 1–2'),
    );

    // User appends the Important Notes block to the child policy.
    typeIntoEditor('Child Policy', newChildPolicy);
    expect(screen.getByRole('textbox', { name: 'Child Policy' }).textContent).toContain(
      'Important Notes',
    );

    // Meanwhile the server record changes underneath (another field + timestamp, as on a
    // tab-switch focus refetch): hydration must preserve the dirty child policy.
    stored = { ...stored, name: 'Rajasthan Highlights (renamed)', updatedAt: '2026-10-05T00:00:00.000Z' };
    const getsBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/api/masters/destinations/${destinationId}`),
    ).length;
    await act(async () => {
      await capturedClient?.refetchQueries({
        queryKey: ['masters', 'destinations', destinationId],
      });
    });
    const getsAfter = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/api/masters/destinations/${destinationId}`),
    ).length;
    expect(getsAfter).toBeGreaterThan(getsBefore);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Child Policy' }).textContent).toContain(
        'Important Notes',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update Destination' }));
    await screen.findByText('Destination Details');
    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/masters/destinations/${destinationId}`) &&
        init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as Record<string, unknown>;
    expect(body.childPolicy).toBe(newChildPolicy);
  });
});
