import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { HotelFormPage } from './HotelFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    hasPermission: (key: string) => auth.permissions.has(key),
    user: { id: 'user-1' },
  }),
}));

const destination = { id: 'dest-sg', name: 'Singapore' };
const destinationDetail = {
  id: 'dest-sg',
  name: 'Singapore',
  cities: [{ cityId: 'city-sg', city: { id: 'city-sg', name: 'Singapore' } }],
};

const page = (data: unknown[], total?: number) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: total ?? data.length, totalPages: 1 },
});

const response = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () =>
      status < 400 ? { success: true, data } : { success: false, error: { message: 'boom' } },
  }) as Response;

/** Fetch mock routing the masters endpoints used by the hotel form. */
function stubFormFetch(defaultTotal: number, onPost?: (body: unknown) => void) {
  const calls: string[] = [];
  const posted: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      calls.push(`${options?.method ?? 'GET'} ${url}`);
      if (url.includes('/masters/hotels') && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        posted.push(body);
        if (onPost) onPost(body);
        return response({ id: 'hotel-new', ...body });
      }
      if (url.includes('/masters/destinations/dest-sg')) return response(destinationDetail);
      if (url.includes('/masters/destinations')) return response(page([destination]));
      if (url.includes('/masters/hotels') && url.includes('isDefaultForCity=true'))
        return response(page([], defaultTotal));
      return response(page([]));
    }),
  );
  return { calls, posted };
}

/** The "Default hotels: N / 10" line spans several text nodes; match by paragraph. */
function countLine() {
  return screen.findByText(
    (_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('Default hotels:'),
  );
}

async function selectDestination() {
  await screen.findByRole('option', { name: 'Singapore' });
  fireEvent.change(screen.getByLabelText('Destination *'), { target: { value: 'dest-sg' } });
  await countLine();
}

async function fillRequiredFields() {
  await selectDestination();
  // City options load from the destination detail query.
  await screen.findByRole('option', { name: 'Singapore' });
  const cityOptions = await screen.findAllByRole('option', { name: 'Singapore' });
  expect(cityOptions.length).toBeGreaterThan(1);
  fireEvent.change(screen.getByLabelText('City *'), { target: { value: 'city-sg' } });
  await userEvent.type(screen.getByLabelText('Hotel Name *'), 'Hotel Eleven');
}

describe('Hotel form — multi-default hotels per destination', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels the checkbox per destination and shows the N / 10 count', async () => {
    stubFormFetch(3);
    renderWithProviders(
      <Routes>
        <Route path="/masters/hotels/new" element={<HotelFormPage />} />
      </Routes>,
      { route: '/masters/hotels/new' },
    );
    await screen.findByRole('heading', { name: 'Create Hotel' });
    expect(
      screen.getByRole('checkbox', { name: /Default hotel for this destination/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/for this city/)).not.toBeInTheDocument();

    await selectDestination();
    const line = await countLine();
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('3 / 10');
  });

  it('blocks marking an 11th default hotel with a clear message and no POST', async () => {
    const { calls } = stubFormFetch(10);
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/hotels/new" element={<HotelFormPage />} />
      </Routes>,
      { route: '/masters/hotels/new' },
    );
    await screen.findByRole('heading', { name: 'Create Hotel' });
    await fillRequiredFields();
    await user.click(screen.getByRole('checkbox', { name: /Default hotel for this destination/ }));
    await user.click(screen.getByRole('button', { name: 'Create Hotel' }));

    // Shown both inline on the checkbox and in the form alert.
    const alerts = await screen.findAllByText(/already has 10 default hotels/);
    expect(alerts.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/masters/hotels'))).toBe(false);
  });

  it('submits a default hotel below the cap with the flag set', async () => {
    const { calls, posted } = stubFormFetch(9);
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/hotels/new" element={<HotelFormPage />} />
      </Routes>,
      { route: '/masters/hotels/new' },
    );
    await screen.findByRole('heading', { name: 'Create Hotel' });
    await fillRequiredFields();
    await user.click(screen.getByRole('checkbox', { name: /Default hotel for this destination/ }));
    await user.click(screen.getByRole('button', { name: 'Create Hotel' }));

    // Successful submit navigates to the details page; the POST carries the flag.
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.startsWith('POST') && c.includes('/masters/hotels'))).toBe(true);
    expect((posted[0] as Record<string, unknown>).isDefaultForCity).toBe(true);
  });
});
