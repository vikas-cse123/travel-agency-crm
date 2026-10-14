import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { SightseeingFormPage } from './SightseeingFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const destA = '22222222-2222-4222-8222-222222222222';
const cityA = '11111111-1111-4111-8111-111111111111';

const destinationA = {
  id: destA,
  name: 'Singapore',
  countryCode: 'SG',
  countryName: 'Singapore',
  destinationType: 'INTERNATIONAL',
  status: 'ACTIVE',
  cities: [
    { id: 'link-a', cityId: cityA, sequence: 0, city: { id: cityA, name: 'Singapore City', airportCode: 'SIN' } },
  ],
};

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const ALL = [
  'masters.sightseeing.view',
  'masters.sightseeing.create',
  'masters.sightseeing.update',
  'masters.sightseeing.manage_media',
];

/**
 * Regression: creating a Sightseeing master must send the sequence value
 * entered in the form — including 1 — instead of letting the backend replace
 * it with MAX(sequence)+1.
 */
describe('Sightseeing create sequence (regression)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  function stubApi() {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        if (url.includes(`/masters/destinations/${destA}`)) return response(destinationA);
        if (url.includes('/masters/destinations')) return response(page([destinationA]));
        if (url.endsWith('/masters/sightseeing') && method === 'POST') {
          const payload = body as Record<string, unknown>;
          return response({ id: 'new-sightseeing-id', sequence: payload.sequence });
        }
        if (url.includes('/masters/sightseeing')) return response(page([]));
        return response(page([]));
      }),
    );
    return calls;
  }

  function renderCreate() {
    return renderWithProviders(
      <Routes>
        <Route path="/masters/sightseeing/new" element={<SightseeingFormPage />} />
        <Route path="/masters/sightseeing/:sightseeingId" element={<div>Saved sightseeing</div>} />
      </Routes>,
      { route: '/masters/sightseeing/new' },
    );
  }

  async function fillRequired(user: ReturnType<typeof userEvent.setup>, title: string, sequence: string) {
    const destSelect = (await screen.findByLabelText(/destination/i)) as HTMLSelectElement;
    await waitFor(() => expect(destSelect.options.length).toBeGreaterThan(1), { timeout: 8000 });
    await user.selectOptions(destSelect, destA);
    const citySelect = screen.getByLabelText(/city/i) as HTMLSelectElement;
    await waitFor(() => expect(citySelect).toHaveTextContent('Singapore City'), { timeout: 8000 });
    await user.selectOptions(citySelect, cityA);
    await user.type(screen.getByLabelText(/^title/i), title);
    const sequenceInput = screen.getByLabelText(/sequence/i) as HTMLInputElement;
    await user.clear(sequenceInput);
    await user.type(sequenceInput, sequence);
  }

  function postedBody(calls: Array<{ method: string; url: string; body?: unknown }>) {
    const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/masters/sightseeing'));
    expect(post, 'expected a POST to /masters/sightseeing').toBeDefined();
    return post!.body as Record<string, unknown>;
  }

  it('sends sequence 1 exactly as entered', async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderCreate();
    await fillRequired(user, 'Explicit First', '1');
    await user.click(screen.getByRole('button', { name: /create sightseeing/i }));
    await waitFor(() => expect(postedBody(calls).sequence).toBe(1), { timeout: 8000 });
    expect(typeof postedBody(calls).sequence).toBe('number');
    // Success navigates to the detail page.
    expect(await screen.findByText('Saved sightseeing')).toBeInTheDocument();
  });

  it('sends another explicit sequence value exactly as entered', async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderCreate();
    await fillRequired(user, 'Seventh Spot', '7');
    await user.click(screen.getByRole('button', { name: /create sightseeing/i }));
    await waitFor(() => expect(postedBody(calls).sequence).toBe(7), { timeout: 8000 });
    expect(await screen.findByText('Saved sightseeing')).toBeInTheDocument();
  });
});
