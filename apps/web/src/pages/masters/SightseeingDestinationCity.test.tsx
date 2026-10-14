import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { SightseeingFormPage } from './SightseeingFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const destGoa = 'afe1d2c8-abe3-40df-8b14-a3820dfe5d66';
const destSouth = 'd843a8df-201c-4802-9814-a136241edee1';
const cityTypo = '43e7bad1-ce2a-46d5-92f4-515ab5067812';
const cityBaga = '9f818c71-5aa2-40d5-a3f3-47503eb4b2fd';
const sightId = '09fc1e0a-13c3-4747-a2cd-dcc2f5147047';

const cityLink = (id: string, cityId: string, name: string) => ({
  id, cityId, sequence: 1, city: { id: cityId, name, airportCode: null },
});

const goaDetail = (cities = [cityLink('l1', cityTypo, 'Calanguate'), cityLink('l2', cityBaga, 'Baga')]) => ({
  id: destGoa, name: 'GOA', countryCode: 'IN', status: 'ACTIVE', cities,
});
const southDetail = {
  id: destSouth, name: 'South Goa', countryCode: 'IN', status: 'ACTIVE',
  cities: [cityLink('l3', 'margaon', 'Margaon')],
};

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: sightId, title: 'NORTH GOA SIGHTSEEING', sequence: 1,
  estimatedHours: null, suggestedStartTime: null, description: null, remarks: null,
  pricing: null, mealDefaults: null, status: 'ACTIVE',
  destination: { id: destGoa, name: 'GOA' },
  city: { id: cityTypo, name: 'Calanguate' },
  ...overrides,
});

const page = (data: unknown[]) => ({
  data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const ALL = [
  'masters.sightseeing.view',
  'masters.sightseeing.create',
  'masters.sightseeing.update',
  'masters.sightseeing.manage_media',
];

type Call = { method: string; url: string; body?: unknown };

/**
 * Regression: the Sightseeing edit form must hydrate and submit stable
 * destination/city IDs — never swapping them by name, never silently
 * reattaching a stale city after a destination change — while the backend
 * keeps rejecting genuinely unlinked pairs. Records whose saved pairing has
 * no link get an explicit correction warning instead of a bare rejection.
 */
describe('Sightseeing edit destination/city IDs (regression)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  function stubApi(opts: {
    destinations?: unknown[];
    goaDetail?: unknown;
    goaDetailDelayMs?: number;
    record?: unknown;
  } = {}) {
    const calls: Call[] = [];
    const destinations = opts.destinations ?? [
      { id: destGoa, name: 'GOA' },
      { id: destSouth, name: 'South Goa' },
    ];
    const record = opts.record ?? makeRecord();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        if (url.includes(`/masters/destinations/${destGoa}`)) {
          if (opts.goaDetailDelayMs) await new Promise((r) => setTimeout(r, opts.goaDetailDelayMs));
          return response(opts.goaDetail ?? goaDetail());
        }
        if (url.includes(`/masters/destinations/${destSouth}`)) return response(southDetail);
        if (url.includes('/masters/destinations')) return response(page(destinations));
        if (url.includes(`/masters/sightseeing/${sightId}`) && method === 'PATCH') {
          return response({ ...(record as Record<string, unknown>), ...(body as Record<string, unknown>) });
        }
        if (url.includes(`/masters/sightseeing/${sightId}`)) return response(record);
        if (url.includes('/masters/sightseeing')) return response(page([]));
        return response(page([]));
      }),
    );
    return calls;
  }

  function renderEdit(route = `/masters/sightseeing/${sightId}/edit`) {
    return renderWithProviders(
      <Routes>
        <Route path="/masters/sightseeing/:sightseeingId/edit" element={<SightseeingFormPage />} />
        <Route path="/masters/sightseeing/:sightseeingId" element={<div>Saved sightseeing</div>} />
      </Routes>,
      { route },
    );
  }

  const patches = (calls: Call[]) => calls.filter((c) => c.method === 'PATCH');

  async function openHydrated() {
    renderEdit();
    const destSelect = (await screen.findByLabelText(/destination/i)) as HTMLSelectElement;
    await waitFor(() => expect(destSelect.value).toBe(destGoa), { timeout: 8000 });
    const citySelect = screen.getByLabelText(/city/i) as HTMLSelectElement;
    await waitFor(() => expect(citySelect.value).toBe(cityTypo), { timeout: 8000 });
    return { destSelect, citySelect };
  }

  it('submits the saved IDs untouched and shows no warning for a consistent record', async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    await openHydrated();
    expect(screen.queryByText(/not linked to destination/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await screen.findByText('Saved sightseeing');
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: destGoa, cityId: cityTypo });
  });

  it('keeps duplicate destination names distinct by ID', async () => {
    const user = userEvent.setup();
    const goaTwo = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const cityTwo = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const record = makeRecord({
      destination: { id: goaTwo, name: 'GOA' },
      city: { id: cityTwo, name: 'Baga' },
    });
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        if (url.includes(`/masters/destinations/${goaTwo}`)) {
          return response({
            id: goaTwo, name: 'GOA', cities: [cityLink('l9', cityTwo, 'Baga')],
          });
        }
        if (url.includes('/masters/destinations')) {
          return response(
            page([
              { id: destGoa, name: 'GOA' },
              { id: goaTwo, name: 'GOA' },
            ]),
          );
        }
        if (url.includes(`/masters/sightseeing/${sightId}`) && method === 'PATCH') {
          return response({ ...record, ...(body as Record<string, unknown>) });
        }
        if (url.includes(`/masters/sightseeing/${sightId}`)) return response(record);
        return response(page([]));
      }),
    );
    renderEdit();
    const destSelect = (await screen.findByLabelText(/destination/i)) as HTMLSelectElement;
    // Two identically labelled options, stable ID preserved through hydration.
    await waitFor(
      () => expect(screen.getAllByRole('option', { name: 'GOA' })).toHaveLength(2),
      { timeout: 8000 },
    );
    await waitFor(() => expect(destSelect.value).toBe(goaTwo), { timeout: 8000 });

    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await screen.findByText('Saved sightseeing');
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: goaTwo, cityId: cityTwo });
  });

  it('keeps the saved city while its destination detail loads slowly', async () => {
    const user = userEvent.setup();
    const calls = stubApi({ goaDetailDelayMs: 400 });
    renderEdit();
    const destSelect = (await screen.findByLabelText(/destination/i)) as HTMLSelectElement;
    await waitFor(() => expect(destSelect.value).toBe(destGoa), { timeout: 8000 });
    // The saved-city fallback holds the selection before the detail arrives.
    const citySelect = screen.getByLabelText(/city/i) as HTMLSelectElement;
    await waitFor(() => expect(citySelect.value).toBe(cityTypo), { timeout: 8000 });

    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await screen.findByText('Saved sightseeing');
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: destGoa, cityId: cityTypo });
  });

  it('blocks submit without a city after the destination is changed', async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    const { destSelect, citySelect } = await openHydrated();

    await user.selectOptions(destSelect, destSouth);
    expect(citySelect.value).toBe('');
    await waitFor(() => expect(citySelect).toHaveTextContent('Margaon'), { timeout: 8000 });

    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    expect(await screen.findByText('Select a city.')).toBeInTheDocument();
    expect(patches(calls)).toHaveLength(0);
  });

  it('submits the newly picked pair after a destination change', async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    const { destSelect, citySelect } = await openHydrated();

    await user.selectOptions(destSelect, destSouth);
    await waitFor(() => expect(citySelect).toHaveTextContent('Margaon'), { timeout: 8000 });
    await user.selectOptions(citySelect, 'margaon');

    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await screen.findByText('Saved sightseeing');
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: destSouth, cityId: 'margaon' });
  });

  it('warns on an unlinked saved pair and saves once corrected', async () => {
    const user = userEvent.setup();
    const calls = stubApi({
      goaDetail: {
        id: destGoa, name: 'GOA', cities: [cityLink('l2', cityBaga, 'Baga')],
      },
    });
    const { citySelect } = await openHydrated();
    // The saved city is absent from the freshly loaded detail: explicit
    // correction path naming both sides, and no write merely from opening.
    const warning = await screen.findByText(/not linked to destination/);
    expect(warning.textContent).toContain('Calanguate');
    expect(warning.textContent).toContain('GOA');
    expect(patches(calls)).toHaveLength(0);

    await user.selectOptions(citySelect, cityBaga);
    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await screen.findByText('Saved sightseeing');
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: destGoa, cityId: cityBaga });
  });

  it('blocks submit while a different record is still loading', async () => {
    const user = userEvent.setup();
    const otherId = '11111111-2222-4333-8444-555555555555';
    let resolveOther: ((value: unknown) => void) | null = null;
    const calls: Call[] = [];
    const otherRecord = makeRecord({
      id: otherId, title: 'OTHER ATTRACTION',
      destination: { id: destSouth, name: 'South Goa' },
      city: { id: 'margaon', name: 'Margaon' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        const method = (init?.method ?? 'GET').toUpperCase();
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        if (url.includes(`/masters/destinations/${destGoa}`)) return response(goaDetail());
        if (url.includes(`/masters/destinations/${destSouth}`)) return response(southDetail);
        if (url.includes('/masters/destinations')) {
          return response(page([{ id: destGoa, name: 'GOA' }, { id: destSouth, name: 'South Goa' }]));
        }
        if (url.includes(`/masters/sightseeing/${otherId}`) && method === 'PATCH') {
          return response({ ...otherRecord, ...(body as Record<string, unknown>) });
        }
        if (url.includes(`/masters/sightseeing/${otherId}`)) {
          return new Promise((resolveResponse) => {
            resolveOther = resolveResponse;
          }) as Promise<Response>;
        }
        if (url.includes(`/masters/sightseeing/${sightId}`) && method === 'PATCH') {
          return response({});
        }
        if (url.includes(`/masters/sightseeing/${sightId}`)) return response(makeRecord());
        return response(page([]));
      }),
    );
    renderWithProviders(
      <Routes>
        {/* Same element across params: navigating keeps the form mounted, so
            the previous record's values are still in place while the next
            record loads — exactly the stale window under test. */}
        <Route
          path="/masters/sightseeing/:sightseeingId/edit"
          element={
            <>
              <Link to={`/masters/sightseeing/${otherId}/edit`}>Go other</Link>
              <SightseeingFormPage />
            </>
          }
        />
        <Route
          path="/masters/sightseeing/:sightseeingId"
          element={<div>Saved sightseeing</div>}
        />
      </Routes>,
      { route: `/masters/sightseeing/${sightId}/edit` },
    );
    const destSelect = (await screen.findByLabelText(/destination/i)) as HTMLSelectElement;
    await waitFor(() => expect(destSelect.value).toBe(destGoa), { timeout: 8000 });

    // Navigate to the other record while its detail is still in flight, then
    // submit immediately: the stale form must not PATCH the new id.
    await user.click(screen.getByRole('link', { name: 'Go other' }));
    await user.click(await screen.findByRole('button', { name: /update sightseeing/i }));
    expect(await screen.findByText(/still loading/)).toBeInTheDocument();
    expect(patches(calls)).toHaveLength(0);

    resolveOther!(response(otherRecord));
    const destAfter = await screen.findByLabelText(/destination/i);
    await waitFor(() => expect((destAfter as HTMLSelectElement).value).toBe(destSouth), {
      timeout: 8000,
    });
    await user.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await waitFor(() => expect(patches(calls)).toHaveLength(1), { timeout: 8000 });
    expect(patches(calls)[0]!.url).toContain(otherId);
    expect(patches(calls)[0]!.body).toMatchObject({ destinationId: destSouth, cityId: 'margaon' });
  });
});
