import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { CitiesPage } from './CitiesPage';
import { CityDetailsPage } from './CityDetailsPage';
import { CityFormPage } from './CityFormPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const cityId = '11111111-1111-4111-8111-111111111111';
// Stored record keeps airportCode = BOM; the UI must never expose or overwrite it.
const storedCity = {
  id: cityId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Mumbai',
  airportCode: 'BOM',
  status: 'ACTIVE',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'user-1', fullName: 'Aditi Rao' },
  _count: { destinationLinks: 0 },
};
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});
const lookups = {
  countries: [{ code: 'IN', name: 'India' }],
  cities: [{ id: cityId, name: 'Mumbai', airportCode: 'BOM', countryCode: 'IN' }],
};

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.permissions = new Set([
    'masters.cities.view',
    'masters.cities.create',
    'masters.cities.update',
    'masters.cities.delete',
  ]);
});

describe('City Master UI cleanup (no Airport Code / Status)', () => {
  it('create form shows Country + City Name only, no Airport Code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/cities/new" element={<CityFormPage />} />
      </Routes>,
      { route: '/masters/cities/new' },
    );
    await screen.findByRole('heading', { name: 'Create City' });
    expect(screen.getByText(/Country \*/)).toBeInTheDocument();
    expect(screen.getByText(/City Name \*/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter city name')).toBeInTheDocument();
    expect(screen.queryByText(/airport code/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g. DEL')).not.toBeInTheDocument();
  });

  it('edit form hides Airport Code and preserves BOM on save', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init?.body));
        return response({ ...storedCity, ...body });
      }
      return response(storedCity);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/masters/cities/:cityId/edit" element={<CityFormPage />} />
        <Route path="/masters/cities/:cityId" element={<div>Saved city</div>} />
      </Routes>,
      { route: `/masters/cities/${cityId}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit City' });
    // Existing name is prefilled; Airport Code is nowhere in the UI.
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enter city name')).toHaveValue('Mumbai'),
    );
    expect(screen.queryByText(/airport code/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('BOM')).not.toBeInTheDocument();

    // Change only the city name and save.
    await userEvent.clear(screen.getByPlaceholderText('Enter city name'));
    await userEvent.type(screen.getByPlaceholderText('Enter city name'), 'Mumbai Updated');
    await userEvent.click(screen.getByRole('button', { name: 'Update City' }));
    await screen.findByText('Saved city');

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/masters/cities/${cityId}`) && init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String(patchCall?.[1]?.body));
    expect(body).toMatchObject({ name: 'Mumbai Updated' });
    // Data preservation: the hidden field must not null out the stored value.
    expect(body).not.toHaveProperty('airportCode');
  });

  it('details page does not show Airport Code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(storedCity)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/cities/:cityId" element={<CityDetailsPage />} />
      </Routes>,
      { route: `/masters/cities/${cityId}` },
    );
    expect((await screen.findAllByText('Mumbai')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/airport code/i)).not.toBeInTheDocument();
    expect(screen.queryByText('BOM')).not.toBeInTheDocument();
  });

  it('table has no Airport Code / Status columns and search hides airport wording', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) =>
      String(request).includes('/lookups') ? response(lookups) : response(page([storedCity])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<CitiesPage />);
    expect((await screen.findAllByText('Mumbai')).length).toBeGreaterThan(0);

    // Desktop headers.
    expect(screen.getByText('Country')).toBeInTheDocument();
    expect(screen.getByText('City name')).toBeInTheDocument();
    expect(screen.queryByText('Airport code')).not.toBeInTheDocument();
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    // Row values.
    expect(screen.queryByText('BOM')).not.toBeInTheDocument();
    expect(screen.queryByText('No airport code')).not.toBeInTheDocument();
    // No status filter control.
    expect(screen.queryByLabelText('City status')).not.toBeInTheDocument();

    // Search placeholder communicates only city/country.
    const search = screen.getByLabelText('Search cities');
    expect(search).toHaveAttribute('placeholder', 'Search city or country…');
    expect(search.getAttribute('placeholder')).not.toMatch(/airport|iata/i);

    // Search by city name still works.
    await userEvent.type(search, 'Mumbai');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=Mumbai'))).toBe(
        true,
      ),
    );
  });
});
