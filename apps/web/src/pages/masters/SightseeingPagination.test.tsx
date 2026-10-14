import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { fetchAllMasterPages } from '@/features/masters/masters.api';
import { SightseeingPage } from './SightseeingPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const ALL = [
  'masters.sightseeing.view',
  'masters.sightseeing.create',
  'masters.sightseeing.update',
  'masters.sightseeing.delete',
  'masters.sightseeing.manage_media',
];

const apiOk = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const apiFail = (status = 500) =>
  ({
    ok: false,
    status,
    json: async () => ({
      success: false,
      error: { message: 'Boom', code: 'INTERNAL_ERROR' },
    }),
  }) as Response;

// ---------------------------------------------------------------------------
// Deterministic fixtures. Two destinations share the visible name "Kashmir"
// (different stable ids) and two cities share "Srinagar", so grouping must be
// id-keyed to stay correct.
// ---------------------------------------------------------------------------

const DEST_A = 'dest-a';
const DEST_B = 'dest-b';
const CITY_A1 = 'city-a1';
const CITY_A2 = 'city-a2';
const CITY_B1 = 'city-b1';

const DESTINATIONS = [
  { id: DEST_A, name: 'Kashmir', status: 'ACTIVE' },
  { id: DEST_B, name: 'Kashmir', status: 'ACTIVE' },
];
const CITIES = [
  { id: CITY_A1, name: 'Srinagar', status: 'ACTIVE' },
  { id: CITY_A2, name: 'Gulmarg', status: 'ACTIVE' },
  { id: CITY_B1, name: 'Srinagar', status: 'ACTIVE' },
];

const DEST_NAME: Record<string, string> = { [DEST_A]: 'Kashmir', [DEST_B]: 'Kashmir' };
const CITY_NAME: Record<string, string> = {
  [CITY_A1]: 'Srinagar',
  [CITY_A2]: 'Gulmarg',
  [CITY_B1]: 'Srinagar',
};

interface Row {
  id: string;
  title: string;
  sequence: number;
  estimatedHours: number | null;
  suggestedStartTime: string | null;
  description: string | null;
  remarks: string | null;
  status: string;
  hasImage: boolean;
  images: never[];
  imageFileName: string | null;
  imageMimeType: string | null;
  imageConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  destination: { id: string; name: string };
  city: { id: string; name: string };
  createdBy: { id: string; fullName: string };
}

const SPOTS: Array<[string, string]> = [
  [DEST_A, CITY_A1],
  [DEST_A, CITY_A2],
  [DEST_B, CITY_B1],
];

function makeRow(index: number, overrides: Partial<Row> = {}): Row {
  const [destinationId, cityId] = SPOTS[index % SPOTS.length]!;
  return {
    id: `sight-${String(index).padStart(4, '0')}`,
    title: `Attraction ${index}`,
    sequence: (index % 50) + 1,
    estimatedHours: 2,
    suggestedStartTime: null,
    description: null,
    remarks: null,
    status: index % 10 === 9 ? 'INACTIVE' : 'ACTIVE',
    hasImage: index % 25 === 0,
    images: [],
    imageFileName: null,
    imageMimeType: null,
    imageConfirmedAt: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    destination: { id: destinationId, name: DEST_NAME[destinationId]! },
    city: { id: cityId, name: CITY_NAME[cityId]! },
    createdBy: { id: 'u1', fullName: 'Aditi Rao' },
    ...overrides,
  };
}

/** 150 rows with page-2-only markers; array order is the server order. */
function makeDataset(): Row[] {
  const rows = Array.from({ length: 150 }, (_, i) => makeRow(i + 1));
  // Distinct records sharing one title (dedup must be id-based, not name-based).
  rows[19] = makeRow(20, { id: 'sight-0020', title: 'Twin Lake View' });
  rows[20] = makeRow(21, {
    id: 'sight-0021',
    title: 'Twin Lake View',
    destination: { id: DEST_B, name: 'Kashmir' },
    city: { id: CITY_B1, name: 'Srinagar' },
  });
  // Search marker placed beyond the first 100 rows of the unfiltered order.
  rows[120] = makeRow(999, {
    id: 'sight-zebra',
    title: 'Zanzibar Zebra Encounter',
    status: 'ACTIVE',
  });
  return rows;
}

interface MockOptions {
  rows?: Row[];
  failPages?: Set<number>;
  /** Page 2 repeats 10 ids from page 1 before continuing with new rows. */
  overlap?: boolean;
  destinations?: Array<{ id: string; name: string; status: string }>;
  cities?: Array<{ id: string; name: string; status: string }>;
}

function pageEnvelope<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    data: items,
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

/** Paginating fetch mock that mirrors the backend filter semantics. */
function stubApi(opts: MockOptions = {}) {
  const rows = opts.rows ?? makeDataset();
  const calls: string[] = [];
  const filterRows = (url: URL) => {
    const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
    const destinationId = url.searchParams.get('destinationId');
    const cityId = url.searchParams.get('cityId');
    const status = url.searchParams.get('status');
    return rows.filter((row) => {
      if (destinationId && row.destination.id !== destinationId) return false;
      if (cityId && row.city.id !== cityId) return false;
      if (status && row.status !== status) return false;
      if (search) {
        const hay = `${row.title} ${row.city.name} ${row.destination.name}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: RequestInfo | URL) => {
      const url = new URL(String(request), 'http://localhost');
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/masters/sightseeing/summary')) {
        const filtered = filterRows(url);
        return apiOk({
          totalAttractions: filtered.length,
          destinations: new Set(filtered.map((r) => r.destination.id)).size,
          citiesCovered: new Set(filtered.map((r) => r.city.id)).size,
          withImages: filtered.filter((r) => r.hasImage).length,
        });
      }
      if (url.pathname.endsWith('/masters/sightseeing')) {
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
        if (opts.failPages?.has(page)) return apiFail();
        const filtered = filterRows(url);
        if (opts.overlap && page === 2) {
          const slice = [
            ...filtered.slice(0, 10),
            ...filtered.slice(pageSize, pageSize + (pageSize - 10)),
          ];
          return apiOk(pageEnvelope(slice, page, pageSize, filtered.length));
        }
        return apiOk(
          pageEnvelope(filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, filtered.length),
        );
      }
      if (url.pathname.endsWith('/masters/destinations')) {
        const status = url.searchParams.get('status');
        const items = (opts.destinations ?? DESTINATIONS).filter(
          (d) => !status || d.status === status,
        );
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
        return apiOk(
          pageEnvelope(items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, items.length),
        );
      }
      if (url.pathname.endsWith('/masters/cities')) {
        const status = url.searchParams.get('status');
        const items = (opts.cities ?? CITIES).filter((c) => !status || c.status === status);
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
        return apiOk(
          pageEnvelope(items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, items.length),
        );
      }
      return apiOk(pageEnvelope([], 1, 10, 0));
    }),
  );
  return calls;
}

const manyDestinations = () => [
  ...DESTINATIONS,
  ...Array.from({ length: 148 }, (_, i) => ({
    id: `dest-x${String(i + 1).padStart(3, '0')}`,
    name: `Destination ${String(i + 1).padStart(3, '0')}`,
    status: 'ACTIVE',
  })),
];
const manyCities = () => [
  ...CITIES,
  ...Array.from({ length: 147 }, (_, i) => ({
    id: `city-x${String(i + 1).padStart(3, '0')}`,
    name: `City ${String(i + 1).padStart(3, '0')}`,
    status: 'ACTIVE',
  })),
];

describe('Sightseeing full-dataset retrieval (no total-record cap)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('unit: merges 150 records across pages in server order', async () => {
    stubApi();
    const result = await fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams());
    expect(result.data).toHaveLength(150);
    expect(result.pagination.total).toBe(150);
    expect(new Set(result.data.map((r) => r.id)).size).toBe(150);
    expect(result.data[0]!.id).toBe('sight-0001');
    expect(result.data.map((r) => r.id)).toContain('sight-zebra');
  });

  it('unit: retrieves 1,000 records across 10 pages without stopping', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i + 1, { id: `big-${i + 1}` }));
    const calls = stubApi({ rows });
    const result = await fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams());
    expect(result.data).toHaveLength(1000);
    expect(new Set(result.data.map((r) => r.id)).size).toBe(1000);
    expect(calls.some((c) => c.includes('page=10'))).toBe(true);
  });

  it('unit: does not stop at a fixed page count (650 records, 7 pages)', async () => {
    const rows = Array.from({ length: 650 }, (_, i) => makeRow(i + 1, { id: `mid-${i + 1}` }));
    const calls = stubApi({ rows });
    const result = await fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams());
    expect(result.data).toHaveLength(650);
    expect(calls.some((c) => c.includes('page=7'))).toBe(true);
    expect(calls.some((c) => c.includes('page=8'))).toBe(false);
  });

  it('unit: overlapping pages deduplicate by id; identical titles stay separate', async () => {
    const calls = stubApi({ overlap: true });
    const result = await fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams());
    expect(calls.some((c) => c.includes('page=2'))).toBe(true);
    const ids = result.data.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.data).toHaveLength(150);
    expect(result.data.filter((r) => r.title === 'Twin Lake View')).toHaveLength(2);
  });

  it('unit: identical filters are sent on every page request', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => makeRow(i + 1, { id: `flt-${i + 1}` }));
    const calls = stubApi({ rows });
    await fetchAllMasterPages<Row>(
      '/masters/sightseeing',
      new URLSearchParams({ destinationId: DEST_A, status: 'ACTIVE' }),
    );
    const sightCalls = calls.filter((c) => c.includes('/masters/sightseeing?'));
    expect(sightCalls.length).toBeGreaterThan(1);
    for (const call of sightCalls) {
      expect(call).toContain(`destinationId=${DEST_A}`);
      expect(call).toContain('status=ACTIVE');
    }
  });

  it('unit: a failed page rejects instead of reporting partial data', async () => {
    stubApi({ failPages: new Set([2]) });
    await expect(
      fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams()),
    ).rejects.toThrow();
  });

  it('unit: an aborted fetch rejects without requesting further pages', async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(request), 'http://localhost');
        calls.push(`${url.pathname}${url.search}`);
        const aborted = controller.signal.aborted || init?.signal?.aborted;
        if (aborted) throw new DOMException('Aborted', 'AbortError');
        return apiOk(pageEnvelope([], 1, 100, 0));
      }),
    );
    await expect(
      fetchAllMasterPages<Row>('/masters/sightseeing', new URLSearchParams(), controller.signal),
    ).rejects.toThrow();
    expect(calls.filter((c) => c.includes('/masters/sightseeing?'))).toHaveLength(1);
  });

  it('page: renders all 150 attractions across both API pages', async () => {
    const calls = stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });

    // Both list pages were requested with the server maximum, not a total cap.
    await waitFor(() => {
      expect(calls.some((c) => c.includes('/masters/sightseeing?') && c.includes('page=2'))).toBe(
        true,
      );
    });
    expect(await screen.findByText('Summary Statistics')).toBeInTheDocument();
    expect(screen.getAllByText('150').length).toBeGreaterThan(0);

    // Mobile flat list exposes the same complete set as the desktop groups.
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });

    // A record that only exists on page 2 is reachable under its group.
    const toggles = await screen.findAllByRole('button', { name: /Kashmir/ });
    for (const toggle of toggles) await userEvent.click(toggle);
    expect((await screen.findAllByText('Zanzibar Zebra Encounter')).length).toBeGreaterThan(0);
  });

  it('page: identical titles in different cities remain separate rows', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
    expect(screen.getAllByText('Twin Lake View').length).toBeGreaterThanOrEqual(2);
  });

  it('page: same-name destinations do not collide when grouped', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
    // Two distinct destination groups share the visible name; both expand.
    const toggles = await screen.findAllByRole('button', { name: /Kashmir/ });
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) await userEvent.click(toggle);
    // "Srinagar" appears as a city under both destinations without merging.
    expect(screen.getAllByText('Srinagar').length).toBeGreaterThanOrEqual(2);
  });

  it('page: search finds a record that exists only on a later API page', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
    await userEvent.clear(screen.getByLabelText('Search sightseeing'));
    await userEvent.type(screen.getByLabelText('Search sightseeing'), 'Zebra');
    await waitFor(() => {
      expect(screen.getAllByText('Zanzibar Zebra Encounter').length).toBeGreaterThan(0);
    });
    // Clearing restores the complete eligible dataset.
    await userEvent.clear(screen.getByLabelText('Search sightseeing'));
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
  });

  it('page: destination filter applies across every page', async () => {
    const calls = stubApi({ destinations: manyDestinations(), cities: manyCities() });
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
    await userEvent.selectOptions(screen.getByLabelText('Destination'), DEST_B);
    await waitFor(() => {
      const articles = screen.getAllByRole('article');
      expect(articles.length).toBeGreaterThan(0);
      expect(articles.length).toBeLessThan(150);
    });
    expect(calls.filter((c) => c.includes(`destinationId=${DEST_B}`)).length).toBeGreaterThan(0);
  });

  it('page: a failed page shows an incomplete-data error with retry', async () => {
    stubApi({ failPages: new Set([2]) });
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/may be incomplete/);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('page: retry after a failure loads the complete dataset', async () => {
    const rows = makeDataset();
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = new URL(String(request), 'http://localhost');
        if (url.pathname.endsWith('/masters/sightseeing/summary'))
          return apiOk({ totalAttractions: rows.length, destinations: 2, citiesCovered: 3, withImages: 0 });
        if (url.pathname.endsWith('/masters/sightseeing')) {
          const page = Number(url.searchParams.get('page') ?? '1');
          if (fail && page === 2) return apiFail();
          const pageSize = Number(url.searchParams.get('pageSize') ?? '100');
          return apiOk(
            pageEnvelope(rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, rows.length),
          );
        }
        if (url.pathname.endsWith('/masters/destinations'))
          return apiOk(pageEnvelope(DESTINATIONS, 1, 100, DESTINATIONS.length));
        if (url.pathname.endsWith('/masters/cities'))
          return apiOk(pageEnvelope(CITIES, 1, 100, CITIES.length));
        return apiOk(pageEnvelope([], 1, 10, 0));
      }),
    );
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(150);
    });
  });

  it('page: stale search responses never replace newer results', async () => {
    const rows = makeDataset();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = new URL(String(request), 'http://localhost');
        calls.push(`${url.pathname}${url.search}`);
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        if (url.pathname.endsWith('/masters/sightseeing/summary')) {
          const filtered = rows.filter((r) => r.title.toLowerCase().includes(search));
          return apiOk({
            totalAttractions: filtered.length,
            destinations: new Set(filtered.map((r) => r.destination.id)).size,
            citiesCovered: new Set(filtered.map((r) => r.city.id)).size,
            withImages: 0,
          });
        }
        if (url.pathname.endsWith('/masters/sightseeing')) {
          // The older query resolves slowly; the newer one immediately.
          if (search.includes('zebra')) await new Promise((r) => setTimeout(r, 120));
          const filtered = rows.filter((r) => r.title.toLowerCase().includes(search));
          return apiOk(pageEnvelope(filtered, 1, 100, filtered.length));
        }
        if (url.pathname.endsWith('/masters/destinations'))
          return apiOk(pageEnvelope(DESTINATIONS, 1, 100, DESTINATIONS.length));
        if (url.pathname.endsWith('/masters/cities'))
          return apiOk(pageEnvelope(CITIES, 1, 100, CITIES.length));
        return apiOk(pageEnvelope([], 1, 10, 0));
      }),
    );
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    const input = await screen.findByLabelText('Search sightseeing');
    fireEvent.change(input, { target: { value: 'Zebra' } });
    // Let the older (slow) request start before superseding it.
    await waitFor(() => {
      expect(calls.some((c) => c.includes('search=Zebra'))).toBe(true);
    });
    fireEvent.change(input, { target: { value: 'Twin' } });
    await waitFor(
      () => {
        expect(screen.getAllByText('Twin Lake View').length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText('Zanzibar Zebra Encounter')).not.toBeInTheDocument();
  });

  it('page: destination and city dropdowns expose options beyond the first 100', async () => {
    stubApi({ destinations: manyDestinations(), cities: manyCities() });
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    const destinationSelect = await screen.findByLabelText('Destination');
    await waitFor(() => {
      expect(destinationSelect.querySelectorAll('option').length).toBe(151);
    });
    expect(destinationSelect.textContent).toContain('Destination 148');
    const citySelect = screen.getByLabelText('City');
    await waitFor(() => {
      expect(citySelect.querySelectorAll('option').length).toBe(151);
    });
    expect(citySelect.textContent).toContain('City 147');
  });
});
