import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { LeadFormPage } from './LeadFormPage';
import { destinationOptionLabel } from '@/features/queries/LeadForm';

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
    await userEvent.click(screen.getByRole('option', { name: 'Thailand — Thai Private' }));
    // The committed input shows only the public destination name.
    expect(first).toHaveValue('Thailand');

    // Backspace / clear / retype on the committed row.
    await userEvent.click(first);
    fireEvent.change(first, { target: { value: 'Thailan' } });
    expect(screen.getByRole('option', { name: 'Thailand — Thai Private' })).toBeInTheDocument();
    // Clearing collapses back to the country list.
    fireEvent.change(first, { target: { value: '' } });
    expect(first).toHaveValue('');
    expect(
      screen.queryByRole('option', { name: 'Thailand — Thai Private' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OTHER' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OTHER' }));
    expect(screen.getByRole('option', { name: 'Singapore' })).toBeInTheDocument();
    fireEvent.change(first, { target: { value: 'sing' } });
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    expect(first).toHaveValue('Singapore');

    // A second row keeps independent search state.
    await userEvent.click(screen.getByRole('button', { name: /Add More/i }));
    const second = screen.getByLabelText('Destination 2');
    expect(second).toHaveValue('');
    await search(second, 'thail');
    expect(screen.getByRole('option', { name: 'Thailand — Thai Private' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Thailand — Thai Private' }));
    expect(second).toHaveValue('Thailand');
    // The first row is untouched by the second row's search.
    expect(first).toHaveValue('Singapore');
  }, 30000);

  it('itinerary rows expose only a Destination (no City column)', async () => {
    await renderCreate();
    expect(screen.getByLabelText('Destination 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add More/i }));
    expect(screen.getByLabelText('Destination 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('City 2')).not.toBeInTheDocument();
  }, 30000);

  it('Edit: the City column is gone while saved itinerary values are preserved', async () => {
    await renderEdit();
    const country = screen.getByLabelText('Departure country');
    const city = screen.getByLabelText('Departure city');
    const destination = screen.getByLabelText('Destination 1');

    // Saved values load intact (committed input shows the public name).
    expect(country).toHaveValue('India');
    expect(city).toHaveValue('Chennai');
    expect(destination).toHaveValue('Thailand');
    // The itinerary City field is no longer exposed in Edit mode.
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();

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

    // Itinerary Destination stays searchable with its saved value.
    await search(destination, 'sing');
    await userEvent.click(screen.getByRole('option', { name: 'Singapore' }));
    expect(destination).toHaveValue('Singapore');
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
  }, 30000);

  it('Create: itinerary Destination is findable by private name and commits the public name', async () => {
    await renderCreate();
    const first = screen.getByLabelText('Destination 1');

    // Searching the private name finds the combined option.
    await search(first, 'thai private');
    expect(
      screen.getByRole('option', { name: 'Thailand — Thai Private' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Singapore' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'Thailand — Thai Private' }));
    expect(first).toHaveValue('Thailand');
  }, 30000);
});

describe('destinationOptionLabel', () => {
  it('combines destination and private names with an em dash', () => {
    expect(destinationOptionLabel('Malaysia', 'Malaysia - 3 Nights - Essential')).toBe(
      'Malaysia — Malaysia - 3 Nights - Essential',
    );
  });

  it('returns the plain name when the private name is missing or blank', () => {
    expect(destinationOptionLabel('Singapore', null)).toBe('Singapore');
    expect(destinationOptionLabel('Singapore', undefined)).toBe('Singapore');
    expect(destinationOptionLabel('Singapore', '')).toBe('Singapore');
    expect(destinationOptionLabel('Lucknow', '   ')).toBe('Lucknow');
  });

  it('never repeats the name when the private name is identical', () => {
    expect(destinationOptionLabel('Kashmir 6N/7D', 'Kashmir 6N/7D')).toBe('Kashmir 6N/7D');
    expect(destinationOptionLabel('Goa', '  Goa  ')).toBe('Goa');
    expect(destinationOptionLabel('Goa', 'goa')).toBe('Goa');
  });
});

describe('itinerary destination country groups', () => {
  const groupedDestinations = [
    {
      id: 'dest-kashmir',
      name: 'Kashmir 6N/7D',
      privateName: 'Kashmir 6N/7D',
      countryCode: 'IN',
      countryName: 'India',
      status: 'ACTIVE',
      cities: [{ id: 'dc-k', sequence: 1, city: { name: 'Srinagar' } }],
    },
    {
      id: 'dest-my',
      name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width',
      privateName: 'Malaysia - Langkawi & Kuala Lumpur - 5Nights',
      countryCode: 'MY',
      countryName: 'Malaysia',
      status: 'ACTIVE',
      cities: [{ id: 'dc-m', sequence: 1, city: { name: 'Kuala Lumpur' } }],
    },
    {
      id: 'dest-sg',
      name: 'Singapore',
      privateName: null,
      countryCode: 'SG',
      countryName: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-s', sequence: 1, city: { name: 'Singapore' } }],
    },
    {
      id: 'dest-nowhere',
      name: 'Mystery Island',
      privateName: null,
      countryCode: '',
      countryName: '',
      status: 'ACTIVE',
      cities: [{ id: 'dc-n', sequence: 1, city: { name: 'Mystery Island' } }],
    },
  ];

  async function renderGroupedCreate() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/masters/destinations'))
          return response({
            data: groupedDestinations,
            pagination: { page: 1, pageSize: 100, total: 4, totalPages: 1 },
          });
        return response(lookups);
      }),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await waitFor(() => expect(screen.getByLabelText('Destination 1')).toBeInTheDocument());
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups options by country with each heading once and full untruncated labels', async () => {
    await renderGroupedCreate();
    const input = screen.getByLabelText('Destination 1');
    await userEvent.click(input);
    const menu = await screen.findByRole('listbox', { name: 'Destination 1 search results' });

    // Collapsed initially: country rows only, no destinations yet.
    const headings = ['INDIA', 'MALAYSIA', 'SINGAPORE', 'OTHER'];
    for (const heading of headings) {
      expect(within(menu).getAllByText(heading)).toHaveLength(1);
    }
    const menuText = menu.textContent ?? '';
    expect(menuText.indexOf('INDIA')).toBeLessThan(menuText.indexOf('MALAYSIA'));
    expect(menuText.indexOf('MALAYSIA')).toBeLessThan(menuText.indexOf('SINGAPORE'));
    expect(menuText.indexOf('SINGAPORE')).toBeLessThan(menuText.indexOf('OTHER'));
    expect(
      within(menu).queryByRole('option', { name: 'Singapore' }),
    ).not.toBeInTheDocument();
    // Country rows expose their expanded state and do not select anything.
    const malaysiaRow = within(menu).getByRole('button', { name: 'MALAYSIA' });
    expect(malaysiaRow).toHaveAttribute('aria-expanded', 'false');

    // Expanding reveals that country's destinations with complete labels.
    await userEvent.click(malaysiaRow);
    expect(malaysiaRow).toHaveAttribute('aria-expanded', 'true');
    const longLabel =
      'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width — Malaysia - Langkawi & Kuala Lumpur - 5Nights';
    const longOption = within(menu).getByRole('option', { name: longLabel });
    expect(longOption.textContent).toContain(longLabel);
    // No ellipsis truncation: the label span wraps instead.
    const labelSpan = longOption.querySelector('span');
    expect(labelSpan?.className).not.toMatch(/truncate/);
    expect(labelSpan?.className).toMatch(/break-words/);
    // Clicking the country did not select a destination.
    expect(input).toHaveValue('');
    // Other countries stay collapsed with their destinations hidden.
    expect(
      within(menu).queryByRole('option', { name: 'Singapore' }),
    ).not.toBeInTheDocument();

    // Clicking the same country again collapses it.
    await userEvent.click(within(menu).getByRole('button', { name: 'MALAYSIA' }));
    expect(
      within(menu).queryByRole('option', { name: longLabel }),
    ).not.toBeInTheDocument();
    // Identical private names collapse; plain and Other rows render too.
    await userEvent.click(within(menu).getByRole('button', { name: 'INDIA' }));
    expect(
      within(menu).getByRole('option', { name: 'Kashmir 6N/7D' }),
    ).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('button', { name: 'OTHER' }));
    expect(within(menu).getByRole('option', { name: 'Mystery Island' })).toBeInTheDocument();
  });

  it('search keeps matching groups and hides empty ones', async () => {
    await renderGroupedCreate();
    const input = screen.getByLabelText('Destination 1');
    await search(input, '5nights');

    const menu = await screen.findByRole('listbox', { name: 'Destination 1 search results' });
    // Private-name search finds the option under its own country group.
    expect(
      within(menu).getByRole('option', {
        name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width — Malaysia - Langkawi & Kuala Lumpur - 5Nights',
      }),
    ).toBeInTheDocument();
    expect(within(menu).getByText('MALAYSIA')).toBeInTheDocument();
    // Non-matching groups disappear entirely.
    expect(within(menu).queryByText('INDIA')).not.toBeInTheDocument();
    expect(within(menu).queryByText('SINGAPORE')).not.toBeInTheDocument();
    expect(within(menu).queryByText('OTHER')).not.toBeInTheDocument();
  });

  it('selecting commits only the public name while the value stays the destination', async () => {
    await renderGroupedCreate();
    const input = screen.getByLabelText('Destination 1');
    await search(input, 'langkawi');
    await userEvent.click(
      screen.getByRole('option', {
        name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width — Malaysia - Langkawi & Kuala Lumpur - 5Nights',
      }),
    );
    expect(input).toHaveValue(
      'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width',
    );

    // Keyboard selection works the same way on grouped options.
    await search(input, 'mystery');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Mystery Island');
  });

  it('expanding one country collapses the previously expanded one', async () => {
    await renderGroupedCreate();
    const input = screen.getByLabelText('Destination 1');
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: 'Destination 1 search results' });

    await userEvent.click(screen.getByRole('button', { name: 'MALAYSIA' }));
    expect(
      screen.queryByRole('option', {
        name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width — Malaysia - Langkawi & Kuala Lumpur - 5Nights',
      }),
    ).toBeInTheDocument();

    // Expanding another country collapses Malaysia (accordion).
    await userEvent.click(screen.getByRole('button', { name: 'INDIA' }));
    expect(screen.getByRole('option', { name: 'Kashmir 6N/7D' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', {
        name: 'Malaysia - Langkawi & Kuala Lumpur with a very long trailing suffix for width — Malaysia - Langkawi & Kuala Lumpur - 5Nights',
      }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('keyboard navigation toggles countries and commits options', async () => {
    await renderGroupedCreate();
    const input = screen.getByLabelText('Destination 1');
    await userEvent.click(input);
    await screen.findByRole('listbox', { name: 'Destination 1 search results' });

    // Highlight starts on the first country row; Enter expands it.
    expect(input).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    expect(
      screen.getByRole('option', { name: 'Kashmir 6N/7D' }),
    ).toBeInTheDocument();
    expect(input).toHaveValue('');

    // ArrowDown reaches the destination; Enter commits its public name.
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Kashmir 6N/7D');
    expect(
      screen.queryByRole('listbox', { name: 'Destination 1 search results' }),
    ).not.toBeInTheDocument();
  });
});

describe('itinerary Destination dropdown upward positioning', () => {
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  const originalInnerHeight = window.innerHeight;

  // The Destination input sits near the viewport bottom, so a downward menu
  // would fit but the dropdown must still open upward.
  function mockDestinationInput() {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      const label = (this as HTMLElement).getAttribute?.('aria-label') ?? '';
      if (label === 'Destination 1')
        return {
          x: 100, y: 600, left: 100, top: 600, right: 350, bottom: 638,
          width: 250, height: 38, toJSON: () => ({}),
        } as DOMRect;
      return originalRect.call(this);
    };
  }

  afterEach(() => {
    window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
  });

  it('opens the itinerary Destination menu above its own input', async () => {
    mockDestinationInput();
    await renderEdit();
    const destination = screen.getByLabelText('Destination 1') as HTMLInputElement;

    await userEvent.click(destination);
    const menu = await screen.findByRole('listbox', { name: 'Destination 1 search results' });
    // Anchored to the Destination input (left 100), above it.
    expect(menu.style.left).toBe('100px');
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(600);
  });
});

