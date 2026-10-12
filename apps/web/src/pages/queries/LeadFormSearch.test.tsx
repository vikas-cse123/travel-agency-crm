import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { LeadFormPage } from './LeadFormPage';

const authState = vi.hoisted(() => ({
  user: { id: 'me' } as { id: string } | null,
  permissions: new Set([
    'queries.view',
    'queries.create',
    'queries.update',
    'queries.delete',
    'queries.assign',
  ]),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: authState.user,
    hasPermission: (permission: string) => authState.permissions.has(permission),
  }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const lookups = {
  countries: ['India'],
  cities: ['Delhi', 'Berlin'],
  leadSources: [{ value: 'WEBSITE', label: 'Website' }],
  leadTypes: [{ value: 'FRESH', label: 'Fresh' }],
  leadStages: [{ value: 'NEW_LEAD', label: 'New Lead' }],
  priorities: [{ value: 'MEDIUM', label: 'Medium' }],
  serviceTypes: [
    { value: 'FLIGHT', label: 'Flight' },
    { value: 'HOTEL', label: 'Hotel' },
  ],
  tripTypes: ['Leisure'],
  currencies: ['INR'],
  assignableUsers: [{ id: 'me', fullName: 'Owner', username: 'owner' }],
};

const destinations = [
  {
    id: 'dest-th',
    name: 'Thailand',
    privateName: 'Thai Private',
    status: 'ACTIVE',
    cities: [
      { id: 'dc-1', sequence: 1, city: { name: 'Bangkok' } },
      { id: 'dc-2', sequence: 2, city: { name: 'Phuket' } },
    ],
  },
  {
    id: 'dest-sg',
    name: 'Singapore',
    privateName: null,
    status: 'ACTIVE',
    cities: [
      { id: 'dc-3', sequence: 1, city: { name: 'Singapore' } },
      // Shared with Thailand so destination switches can preserve it.
      { id: 'dc-4', sequence: 2, city: { name: 'Bangkok' } },
    ],
  },
];

const savedLead = {
  id: '11111111-1111-4111-8111-111111111111',
  queryNumber: 'QRY-2026-000001',
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  alternatePhone: null,
  email: 'aarav@example.test',
  dateOfBirth: null,
  leadSource: 'WEBSITE',
  leadType: 'FRESH',
  leadStage: 'NEW_LEAD',
  priority: 'MEDIUM',
  departureCountry: 'India',
  departureCity: 'Chennai',
  travelStartDate: '2026-08-15T00:00:00.000Z',
  travelEndDate: null,
  travelMonth: null,
  travelYear: null,
  flexibleDates: false,
  rooms: 1,
  adults: 1,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  expectedAmount: null,
  budgetMin: null,
  budgetMax: null,
  expectedMargin: null,
  currency: 'INR',
  tripType: null,
  quotationRequired: false,
  bookingStatusPlaceholder: null,
  webLinkPlaceholder: null,
  supplierCostingNotes: null,
  assignedToId: 'me',
  createdById: 'me',
  internalRemarks: null,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  assignedTo: { id: 'me', fullName: 'Owner', username: 'owner' },
  createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
  services: [{ serviceType: 'FLIGHT' }],
  itinerary: [
    {
      id: 'itinerary-1',
      country: 'Thailand',
      destination: 'Bangkok',
      nights: 3,
      sequence: 1,
      arrivalDate: null,
      departureDate: null,
      notes: null,
    },
  ],
};

function stubCreate() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: destinations,
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      return response(lookups);
    }),
  );
}

function stubEdit() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: destinations,
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        });
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${savedLead.id}`)) return response(savedLead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    }),
  );
}

/** Focus the combobox and replace its text with `value`. */
async function search(input: HTMLElement, value: string) {
  await userEvent.click(input);
  fireEvent.change(input, { target: { value } });
}

async function renderCreate() {
  stubCreate();
  renderWithProviders(<LeadFormPage />);
  await screen.findByRole('heading', { name: 'Create lead' });
  // Itinerary destination options load asynchronously.
  await waitFor(() => expect(screen.getByLabelText('Destination 1')).toBeInTheDocument());
}

async function renderEdit() {
  stubEdit();
  renderWithProviders(
    <Routes>
      <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
    </Routes>,
    { route: `/queries/${savedLead.id}/edit` },
  );
  await screen.findByRole('heading', { name: 'Edit lead' });
  await waitFor(() => expect(screen.getByLabelText('Destination 1')).toBeInTheDocument());
}

describe('Lead searchable fields regression', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('Assign To is a native select, not a searchable combobox', async () => {
    await renderCreate();
    const assignTo = screen.getByLabelText('Assigned salesperson');
    expect(assignTo.tagName).toBe('SELECT');
    expect(assignTo).not.toHaveAttribute('role', 'combobox');
  });

  it('Create: Departure country handles typing, Backspace, clearing and reselection', async () => {
    await renderCreate();
    const country = screen.getByLabelText('Departure country');
    expect(country).toHaveValue('India');

    // Type a complete value and filter.
    await search(country, 'german');
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'France' })).not.toBeInTheDocument();

    // Delete the last character: results follow the current input.
    fireEvent.change(country, { target: { value: 'germa' } });
    expect(country).toHaveValue('germa');
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument();

    // Delete several characters.
    fireEvent.change(country, { target: { value: 'ger' } });
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument();

    // Clear the whole search while open: stays empty, full list returns.
    fireEvent.change(country, { target: { value: '' } });
    expect(country).toHaveValue('');
    expect(screen.getByRole('option', { name: 'India' })).toBeInTheDocument();

    // A different query right after clearing filters from scratch.
    fireEvent.change(country, { target: { value: 'franc' } });
    expect(screen.getByRole('option', { name: 'France' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Germany' })).not.toBeInTheDocument();

    // Mouse selection commits and closes.
    await userEvent.click(screen.getByRole('option', { name: 'France' }));
    expect(country).toHaveValue('France');

    // Keyboard search + selection.
    await search(country, 'german');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(country).toHaveValue('Germany');

    // Open, close, reopen preserves the selection and allows a new search.
    // (Keyboard commit above already closed the menu.)
    expect(
      screen.queryByRole('listbox', { name: 'Departure country search results' }),
    ).not.toBeInTheDocument();
    expect(country).toHaveValue('Germany');
    await userEvent.click(country);
    expect(
      screen.getByRole('listbox', { name: 'Departure country search results' }),
    ).toBeInTheDocument();
    await userEvent.click(country);
    expect(
      screen.queryByRole('listbox', { name: 'Departure country search results' }),
    ).not.toBeInTheDocument();
    await userEvent.click(country);
    fireEvent.change(country, { target: { value: 'india' } });
    await userEvent.click(screen.getByRole('option', { name: 'India' }));
    expect(country).toHaveValue('India');
  }, 30000);

  it('Create: Departure city handles edits, clearing, and country-specific filtering', async () => {
    await renderCreate();
    const country = screen.getByLabelText('Departure country');
    const city = screen.getByLabelText('Departure city');

    // India dataset is searchable.
    await search(city, 'chenn');
    await userEvent.click(screen.getByRole('option', { name: 'Chennai' }));
    expect(city).toHaveValue('Chennai');

    // Backspace the last character: still matches Chennai, not stale Delhi.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'Chenna' } });
    expect(city).toHaveValue('Chenna');
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();

    // Clear fully and search something else.
    fireEvent.change(city, { target: { value: '' } });
    expect(city).toHaveValue('');
    fireEvent.change(city, { target: { value: 'mumba' } });
    await userEvent.click(screen.getByRole('option', { name: 'Mumbai' }));
    expect(city).toHaveValue('Mumbai');

    // Changing the country clears a city that does not exist there.
    await search(country, 'german');
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    expect(city).toHaveValue('');

    // Non-India cities come from lookups and stay searchable.
    await search(city, 'berl');
    await userEvent.click(screen.getByRole('option', { name: 'Berlin' }));
    expect(city).toHaveValue('Berlin');

    // Backspace + clear + new search on the non-India dataset.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'Berli' } });
    expect(screen.getByRole('option', { name: 'Berlin' })).toBeInTheDocument();
    fireEvent.change(city, { target: { value: '' } });
    expect(city).toHaveValue('');
    fireEvent.change(city, { target: { value: 'delh' } });
    await userEvent.click(screen.getByRole('option', { name: 'Delhi' }));
    expect(city).toHaveValue('Delhi');
  }, 30000);

  it('Create: itinerary Destination rows search independently', async () => {
    await renderCreate();
    const first = screen.getByLabelText('Destination 1');

    await search(first, 'thail');
    await userEvent.click(screen.getByRole('option', { name: 'Thailand' }));
    expect(first).toHaveValue('Thailand');

    // Backspace / clear / retype on the committed row.
    await userEvent.click(first);
    fireEvent.change(first, { target: { value: 'Thailan' } });
    expect(screen.getByRole('option', { name: 'Thailand' })).toBeInTheDocument();
    fireEvent.change(first, { target: { value: '' } });
    expect(first).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Singapore' })).toBeInTheDocument();
    fireEvent.change(first, { target: { value: 'sing' } });
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    expect(first).toHaveValue('Singapore');

    // A second row keeps independent search state.
    await userEvent.click(screen.getByRole('button', { name: /Add More/i }));
    const second = screen.getByLabelText('Destination 2');
    expect(second).toHaveValue('');
    await search(second, 'thail');
    expect(screen.getByRole('option', { name: 'Thailand' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Thailand' }));
    expect(second).toHaveValue('Thailand');
    // The first row is untouched by the second row's search.
    expect(first).toHaveValue('Singapore');
  }, 30000);

  it('Create: itinerary City follows its destination and survives shared cities', async () => {
    await renderCreate();
    const destination = screen.getByLabelText('Destination 1');
    const city = screen.getByLabelText('City 1') as HTMLInputElement;

    // No destination: the city field is disabled.
    expect(city).toBeDisabled();

    await search(destination, 'thailand');
    await userEvent.click(screen.getByRole('option', { name: 'Thailand' }));
    await waitFor(() => expect(city).toBeEnabled());

    // City search, Backspace, clear, reselect.
    await search(city, 'bang');
    await userEvent.click(screen.getByRole('option', { name: 'Bangkok' }));
    expect(city).toHaveValue('Bangkok');
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'Bangko' } });
    expect(screen.getByRole('option', { name: 'Bangkok' })).toBeInTheDocument();
    fireEvent.change(city, { target: { value: '' } });
    expect(city).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Phuket' })).toBeInTheDocument();
    fireEvent.change(city, { target: { value: 'phuk' } });
    await userEvent.click(screen.getByRole('option', { name: 'Phuket' }));
    expect(city).toHaveValue('Phuket');

    // Switching to a destination without Phuket clears the city.
    await search(destination, 'singapore');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    expect(city).toHaveValue('');

    // A shared city (Bangkok) survives the destination switch.
    await search(city, 'bang');
    await userEvent.click(screen.getByRole('option', { name: 'Bangkok' }));
    expect(city).toHaveValue('Bangkok');
    await search(destination, 'thailand');
    await userEvent.click(screen.getByRole('option', { name: 'Thailand' }));
    expect(destination).toHaveValue('Thailand');
    expect(city).toHaveValue('Bangkok');

    // Keyboard selection works for city too.
    await search(city, 'phuk');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(city).toHaveValue('Phuket');
  }, 30000);

  it('Create: second itinerary City row is independent of the first', async () => {
    await renderCreate();
    await search(screen.getByLabelText('Destination 1'), 'thailand');
    await userEvent.click(screen.getByRole('option', { name: 'Thailand' }));
    await search(screen.getByLabelText('City 1'), 'phuk');
    await userEvent.click(screen.getByRole('option', { name: 'Phuket' }));

    await userEvent.click(screen.getByRole('button', { name: /Add More/i }));
    await search(screen.getByLabelText('Destination 2'), 'singapore');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    const city2 = screen.getByLabelText('City 2');
    await search(city2, 'sing');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));

    expect(screen.getByLabelText('City 1')).toHaveValue('Phuket');
    expect(city2).toHaveValue('Singapore');
    // First row menu only ever listed Thailand cities.
    await userEvent.click(screen.getByLabelText('City 1'));
    fireEvent.change(screen.getByLabelText('City 1'), { target: { value: '' } });
    const menu = screen.getByRole('listbox', { name: 'City 1 search results' });
    expect(within(menu).getByRole('option', { name: 'Bangkok' })).toBeInTheDocument();
    expect(within(menu).queryByRole('option', { name: 'Singapore' })).not.toBeInTheDocument();
  }, 30000);

  it('Edit: saved values are preserved and every field stays searchable', async () => {
    await renderEdit();
    const country = screen.getByLabelText('Departure country');
    const city = screen.getByLabelText('Departure city');
    const destination = screen.getByLabelText('Destination 1');
    const itineraryCity = screen.getByLabelText('City 1');

    // Saved values load intact.
    expect(country).toHaveValue('India');
    expect(city).toHaveValue('Chennai');
    expect(destination).toHaveValue('Thailand');
    expect(itineraryCity).toHaveValue('Bangkok');

    // Departure city: Backspace, clear, and a fresh search.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'Chenna' } });
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
    fireEvent.change(city, { target: { value: '' } });
    expect(city).toHaveValue('');
    fireEvent.change(city, { target: { value: 'mumba' } });
    await userEvent.click(screen.getByRole('option', { name: 'Mumbai' }));
    expect(city).toHaveValue('Mumbai');

    // Departure country change clears the city, as in Create.
    await search(country, 'german');
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    expect(country).toHaveValue('Germany');
    expect(city).toHaveValue('');

    // Itinerary destination + city stay searchable with saved values.
    await search(destination, 'sing');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    // Bangkok exists in Singapore too, so it survives the switch.
    expect(itineraryCity).toHaveValue('Bangkok');
    await search(itineraryCity, 'sing');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    expect(itineraryCity).toHaveValue('Singapore');
    // Backspace and clear on the edited itinerary city.
    await userEvent.click(itineraryCity);
    fireEvent.change(itineraryCity, { target: { value: 'Singapor' } });
    expect(screen.getByRole('option', { name: 'Singapore' })).toBeInTheDocument();
    fireEvent.change(itineraryCity, { target: { value: '' } });
    expect(itineraryCity).toHaveValue('');
  }, 30000);
});
