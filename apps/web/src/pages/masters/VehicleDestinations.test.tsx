import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { VehicleFormPage } from './VehicleFormPage';
import { VehicleDetailsPage } from './VehicleDetailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () =>
      status < 400 ? { success: true, data } : { success: false, error: { message: 'boom' } },
  }) as Response;

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const DESTINATIONS = [
  { id: 'dest-kashmir', name: 'Kashmir' },
  { id: 'dest-delhi', name: 'Delhi' },
  { id: 'dest-agra', name: 'Agra' },
];

function stubMasters(opts: {
  destinations?: Array<{ id: string; name: string }>;
  vehicle?: unknown;
  onPost?: (body: unknown) => void;
  onPatch?: (body: unknown) => void;
}) {
  const posted: unknown[] = [];
  const patched: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/vehicles') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posted.push(body);
        if (opts.onPost) opts.onPost(body);
        return response({ id: 'vehicle-new', ...body });
      }
      if (/\/masters\/vehicles\/.+/.test(url) && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patched.push(body);
        return response({ ...(opts.vehicle as object), ...body });
      }
      if (url.includes('/masters/vehicles/types')) return response({ vehicleTypes: [] });
      if (url.includes('/masters/destinations')) return response(page(opts.destinations ?? []));
      if (url.includes('/masters/vehicles/')) return response(opts.vehicle ?? {});
      return response(page([]));
    }),
  );
  return { posted, patched };
}

async function selectDestination(id: string, optionName: string) {
  await screen.findByRole('option', { name: optionName });
  fireEvent.change(screen.getByLabelText('Select destination'), {
    target: { value: id },
  });
}

function countText() {
  return screen.findByText(
    (_, el) => el?.tagName === 'SPAN' && /\/ 10 destinations/.test(el.textContent ?? ''),
  );
}

describe('Vehicle destination assignments', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the selector with a 0 / 10 count on create', async () => {
    stubMasters({});
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/new" element={<VehicleFormPage />} />
      </Routes>,
      { route: '/masters/vehicles/new' },
    );
    await screen.findByRole('heading', { name: 'Create Vehicle' });
    expect(screen.getByLabelText('Select destination')).toBeInTheDocument();
    const line = await countText();
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('0 / 10');
  });

  it('selects multiple destinations as chips and submits their IDs in order', async () => {
    const { posted } = stubMasters({ destinations: DESTINATIONS });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/new" element={<VehicleFormPage />} />
      </Routes>,
      { route: '/masters/vehicles/new' },
    );
    await screen.findByRole('heading', { name: 'Create Vehicle' });
    await selectDestination('dest-kashmir', 'Kashmir');
    expect(await screen.findByRole('button', { name: 'Remove Kashmir' })).toBeInTheDocument();
    await selectDestination('dest-delhi', 'Delhi');
    expect(await screen.findByRole('button', { name: 'Remove Delhi' })).toBeInTheDocument();
    const line = await countText();
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('2 / 10');

    await user.type(screen.getByLabelText(/vehicle name/i), 'Toyota Innova');
    await user.type(screen.getByLabelText(/vehicle type/i), 'SUV');
    await user.click(screen.getByRole('button', { name: /create vehicle/i }));
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect((posted[0] as Record<string, unknown>).destinationIds).toEqual([
      'dest-kashmir',
      'dest-delhi',
    ]);
  });

  it('removes a selected destination and submits the remainder', async () => {
    const { posted } = stubMasters({ destinations: DESTINATIONS });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/new" element={<VehicleFormPage />} />
      </Routes>,
      { route: '/masters/vehicles/new' },
    );
    await screen.findByRole('heading', { name: 'Create Vehicle' });
    await selectDestination('dest-kashmir', 'Kashmir');
    await selectDestination('dest-agra', 'Agra');
    await user.click(await screen.findByRole('button', { name: 'Remove Kashmir' }));
    expect(screen.queryByRole('button', { name: 'Remove Kashmir' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/vehicle name/i), 'Tempo Traveller');
    await user.type(screen.getByLabelText(/vehicle type/i), 'Van');
    await user.click(screen.getByRole('button', { name: /create vehicle/i }));
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect((posted[0] as Record<string, unknown>).destinationIds).toEqual(['dest-agra']);
  });

  it('blocks an 11th destination with a message and keeps the existing 10', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      id: `dest-${i + 1}`,
      name: `Place ${i + 1}`,
    }));
    const vehicle = {
      id: 'vehicle-1',
      name: 'Big Bus',
      vehicleType: 'Bus',
      capacity: null,
      description: null,
      price: null,
      currency: 'INR',
      status: 'ACTIVE',
      destinations: ten.map((d) => ({ id: d.id, name: d.name })),
    };
    const { patched } = stubMasters({
      destinations: [...ten, { id: 'dest-11', name: 'Place 11' }],
      vehicle,
    });
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/:vehicleId/edit" element={<VehicleFormPage />} />
      </Routes>,
      { route: '/masters/vehicles/vehicle-1/edit' },
    );
    await screen.findByRole('heading', { name: 'Edit Vehicle' });
    // Existing 10 load as chips with the count.
    expect(await screen.findByRole('button', { name: 'Remove Place 1' })).toBeInTheDocument();
    const line = await countText();
    expect(line.textContent?.replace(/\s+/g, ' ')).toContain('10 / 10');

    // The 11th is blocked with a clear message; selection unchanged.
    await selectDestination('dest-11', 'Place 11');
    expect(await screen.findByText(/at most 10 destinations/)).toBeInTheDocument();
    const after = await countText();
    expect(after.textContent?.replace(/\s+/g, ' ')).toContain('10 / 10');
    expect(patched).toHaveLength(0);
  });

  it('edit form loads existing destinations and clears them when all removed', async () => {
    const { patched } = stubMasters({
      destinations: DESTINATIONS,
      vehicle: {
        id: 'vehicle-1',
        name: 'Toyota Innova',
        vehicleType: 'SUV',
        capacity: null,
        description: null,
        price: null,
        currency: 'INR',
        status: 'ACTIVE',
        destinations: [{ id: 'dest-kashmir', name: 'Kashmir' }],
      },
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/:vehicleId/edit" element={<VehicleFormPage />} />
      </Routes>,
      { route: '/masters/vehicles/vehicle-1/edit' },
    );
    await screen.findByRole('heading', { name: 'Edit Vehicle' });
    expect(await screen.findByRole('button', { name: 'Remove Kashmir' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Kashmir' }));
    await user.click(screen.getByRole('button', { name: /update vehicle/i }));
    await waitFor(() => expect(patched.length).toBeGreaterThan(0));
    expect((patched[0] as Record<string, unknown>).destinationIds).toEqual([]);
  });

  it('details page shows assigned destinations with the count', async () => {
    stubMasters({
      vehicle: {
        id: 'vehicle-1',
        name: 'Toyota Innova',
        vehicleType: 'SUV',
        capacity: 7,
        description: null,
        price: null,
        currency: 'INR',
        status: 'ACTIVE',
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
        createdBy: { id: 'u1', fullName: 'Aditi Rao' },
        destinations: [
          { id: 'dest-kashmir', name: 'Kashmir' },
          { id: 'dest-delhi', name: 'Delhi' },
        ],
      },
    });
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/:vehicleId" element={<VehicleDetailsPage />} />
      </Routes>,
      { route: '/masters/vehicles/vehicle-1' },
    );
    expect(await screen.findByRole('heading', { name: 'Toyota Innova' })).toBeInTheDocument();
    expect(screen.getByText('Kashmir')).toBeInTheDocument();
    expect(screen.getByText('Delhi')).toBeInTheDocument();
  });
});
