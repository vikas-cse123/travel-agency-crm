import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { SightseeingDetailsPage } from './SightseeingDetailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const sightseeingId = '77777777-7777-4777-8777-777777777777';

const baseRecord = {
  id: sightseeingId,
  title: 'Sentosa Day',
  sequence: 1,
  estimatedHours: 2.5,
  suggestedStartTime: '18:00',
  description: '<p>Night safari</p>',
  remarks: null,
  pricing: [],
  status: 'ACTIVE',
  hasImage: false,
  imageFileName: null,
  imageMimeType: null,
  imageConfirmedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  destination: { id: 'dest-1', name: 'Singapore' },
  city: { id: 'city-1', name: 'Sentosa' },
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  updatedBy: null,
};

function stubRecord(mealDefaults: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ ...baseRecord, mealDefaults })),
  );
}

function renderDetails() {
  renderWithProviders(
    <Routes>
      <Route path="/masters/sightseeing/:sightseeingId" element={<SightseeingDetailsPage />} />
    </Routes>,
    { route: `/masters/sightseeing/${sightseeingId}` },
  );
}

describe('Sightseeing master detail meals and transfer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'masters.sightseeing.view',
      'masters.sightseeing.update',
      'masters.sightseeing.delete',
    ]);
  });

  it('shows included meals with options, transfer details, and overall transfer', async () => {
    stubRecord({
      meals: { breakfast: true, lunch: true, dinner: false },
      mealModes: { breakfast: 'WITH_TRANSFER', lunch: 'INCLUDE_AT_HOTEL', dinner: null },
      mealTransferDetails: { breakfast: 'Lobby pickup at 8 AM', lunch: null, dinner: null },
      transfer: 'SHARED',
    });
    renderDetails();

    expect(await screen.findByText('Meals Included')).toBeInTheDocument();
    expect(screen.getByText('Breakfast — With Transfer')).toBeInTheDocument();
    expect(
      screen.getByText('Breakfast Transfer Details: Lobby pickup at 8 AM'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lunch — Include At Hotel')).toBeInTheDocument();
    expect(screen.queryByText(/Dinner/)).not.toBeInTheDocument();
    // Overall transfer is separate from per-meal details.
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.getByText('Shared Transfer')).toBeInTheDocument();
  });

  it('renders graceful empty states without saved defaults', async () => {
    stubRecord(null);
    renderDetails();

    expect(await screen.findByText('Meals Included')).toBeInTheDocument();
    expect(screen.getByText('No meals included')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('handles legacy records without transfer-details keys', async () => {
    stubRecord({
      meals: { breakfast: false, lunch: true, dinner: false },
      mealModes: { lunch: 'NO_TRANSFER' },
      transfer: null,
    });
    renderDetails();

    expect(await screen.findByText('Lunch — No Transfer')).toBeInTheDocument();
    expect(screen.queryByText(/Transfer Details/)).not.toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });
});
