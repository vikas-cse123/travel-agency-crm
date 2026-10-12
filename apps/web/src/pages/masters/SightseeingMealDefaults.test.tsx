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

const cityId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const sightseeingId = '77777777-7777-4777-8777-777777777777';

const destination = {
  id: destinationId,
  name: 'Singapore',
  countryCode: 'SG',
  countryName: 'Singapore',
  destinationType: 'INTERNATIONAL',
  status: 'ACTIVE',
  cities: [{ id: 'link-1', cityId, sequence: 0, city: { id: cityId, name: 'Sentosa', airportCode: null } }],
  _count: { cities: 1 },
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
};

const savedMealDefaults = {
  meals: { breakfast: true, lunch: false, dinner: true },
  mealModes: { breakfast: 'WITH_TRANSFER', lunch: null, dinner: 'INCLUDE_AT_HOTEL' },
  transfer: 'PRIVATE',
};

const savedSightseeing = {
  id: sightseeingId,
  title: 'Sentosa Day',
  sequence: 1,
  estimatedHours: null,
  suggestedStartTime: null,
  description: null,
  remarks: null,
  pricing: [],
  mealDefaults: savedMealDefaults,
  status: 'ACTIVE',
  hasImage: false,
  imageFileName: null,
  imageMimeType: null,
  imageConfirmedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  destination: { id: destinationId, name: 'Singapore' },
  city: { id: cityId, name: 'Sentosa' },
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  updatedBy: null,
};

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

function stubApi() {
  return vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    const url = String(request);
    if (url.includes(`/masters/sightseeing/${sightseeingId}`)) return response(savedSightseeing);
    if (url.includes('/masters/sightseeing')) return response(page([savedSightseeing]));
    if (url.includes(`/masters/destinations/${destinationId}`)) return response(destination);
    if (url.includes('/masters/destinations')) return response(page([destination]));
    if (url.includes('/masters/cities')) return response(page([{ id: cityId, name: 'Sentosa', status: 'ACTIVE' }]));
    return response({ id: sightseeingId });
  });
}

describe('Sightseeing meal and transfer defaults form', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves meal and transfer defaults on create', async () => {
    const fetchMock = stubApi();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SightseeingFormPage />, { route: '/masters/sightseeing/new' });

    const destinationSelect = await screen.findByLabelText(/destination/i);
    await waitFor(() => expect(destinationSelect).toHaveTextContent('Singapore'));
    await userEvent.selectOptions(destinationSelect, destinationId);
    const citySelect = await screen.findByLabelText(/city/i);
    await waitFor(() => expect(citySelect).not.toBeDisabled());
    await userEvent.selectOptions(citySelect, cityId);
    await userEvent.type(screen.getByLabelText(/title/i), 'Sentosa Day');

    await userEvent.click(screen.getByLabelText('Meals included breakfast'));
    await userEvent.click(screen.getByLabelText('breakfast meal mode With Transfer'));
    await userEvent.click(screen.getByLabelText('Meals included dinner'));
    await userEvent.click(screen.getByLabelText('dinner meal mode Include At Hotel'));
    await userEvent.click(screen.getByLabelText('Transfer default Private Transfer'));

    await userEvent.click(screen.getByRole('button', { name: /create sightseeing/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => String(url).endsWith('/masters/sightseeing') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/masters/sightseeing') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      mealDefaults: {
        meals: { breakfast: true, lunch: false, dinner: true },
        mealModes: { breakfast: 'WITH_TRANSFER', lunch: null, dinner: 'INCLUDE_AT_HOTEL' },
        transfer: 'PRIVATE',
      },
    });
  });

  it('loads saved defaults into the edit form and clears them', async () => {
    const fetchMock = stubApi();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/masters/sightseeing/:sightseeingId/edit" element={<SightseeingFormPage />} />
      </Routes>,
      { route: `/masters/sightseeing/${sightseeingId}/edit` },
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Meals included breakfast')).toBeChecked(),
    );
    expect(screen.getByLabelText('Meals included lunch')).not.toBeChecked();
    expect(screen.getByLabelText('Meals included dinner')).toBeChecked();
    expect(screen.getByLabelText('breakfast meal mode With Transfer')).toBeChecked();
    expect(screen.getByLabelText('dinner meal mode Include At Hotel')).toBeChecked();
    expect(screen.getByLabelText('Transfer default Private Transfer')).toBeChecked();

    // Clearing everything sends an explicit null so saved defaults are removed.
    await userEvent.click(screen.getByLabelText('Meals included breakfast'));
    await userEvent.click(screen.getByLabelText('Meals included dinner'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('button', { name: /update sightseeing/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith(`/masters/sightseeing/${sightseeingId}`) &&
            options?.method === 'PATCH',
        ),
      ).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).endsWith(`/masters/sightseeing/${sightseeingId}`) && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body)).mealDefaults).toBeNull();
  });

  it('omits meal defaults on create when nothing is set', async () => {
    const fetchMock = stubApi();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SightseeingFormPage />, { route: '/masters/sightseeing/new' });

    const destinationSelect = await screen.findByLabelText(/destination/i);
    await waitFor(() => expect(destinationSelect).toHaveTextContent('Singapore'));
    await userEvent.selectOptions(destinationSelect, destinationId);
    const citySelect = await screen.findByLabelText(/city/i);
    await waitFor(() => expect(citySelect).not.toBeDisabled());
    await userEvent.selectOptions(citySelect, cityId);
    await userEvent.type(screen.getByLabelText(/title/i), 'Plain Tour');

    await userEvent.click(screen.getByRole('button', { name: /create sightseeing/i }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) => String(url).endsWith('/masters/sightseeing') && options?.method === 'POST',
        ),
      ).toBe(true);
    });
    const post = fetchMock.mock.calls.find(
      ([url, options]) => String(url).endsWith('/masters/sightseeing') && options?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).not.toHaveProperty('mealDefaults');
  });
});
