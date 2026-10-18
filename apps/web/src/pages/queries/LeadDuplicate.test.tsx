import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { LeadDetailsPage } from './LeadDetailsPage';
import { LeadFormPage } from './LeadFormPage';
import { buildDuplicateLeadDraft } from '@/features/queries/LeadForm';
import type { Lead } from '@/features/queries/queries.api';

const authState = vi.hoisted(() => ({
  user: { id: 'me', fullName: 'Owner', username: 'owner' } as { id: string } | null,
  permissions: new Set<string>(['queries.view', 'queries.create', 'queries.update', 'queries.assign']),
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
  cities: ['Delhi'],
  leadSources: [
    { value: 'WEBSITE', label: 'Website' },
    { value: 'REFERRAL', label: 'Referral' },
  ],
  leadTypes: [
    { value: 'FRESH', label: 'Fresh' },
    { value: 'HOT', label: 'Hot' },
  ],
  leadStages: [
    { value: 'NEW_LEAD', label: 'New Lead' },
    { value: 'QUOTATION_SENT', label: 'Quotation Sent' },
  ],
  priorities: [{ value: 'MEDIUM', label: 'Medium' }],
  serviceTypes: [
    { value: 'FLIGHT', label: 'Flight' },
    { value: 'HOTEL', label: 'Hotel' },
    { value: 'CRUISE', label: 'Cruise' },
    { value: 'VEHICLE_TRANSFER', label: 'Vehicle' },
    { value: 'SIGHTSEEING', label: 'Sightseeing' },
    { value: 'OTHER_ADD_ON', label: 'Add-on Service' },
  ],
  tripTypes: ['Leisure'],
  currencies: ['INR'],
  assignableUsers: [
    { id: 'me', fullName: 'Owner', username: 'owner' },
    { id: 'agent-1', fullName: 'Agent One', username: 'agent1' },
  ],
};

const monthLead = {
  id: 'lead-1',
  queryNumber: 'QRY-2026-000001',
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  alternatePhone: null,
  email: null,
  dateOfBirth: null,
  leadSource: 'WEBSITE',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  priority: 'HIGH',
  departureCountry: 'India',
  departureCity: 'Delhi',
  travelStartDate: null,
  travelEndDate: null,
  travelMonth: 4,
  travelYear: 2025,
  flexibleDates: false,
  rooms: 1,
  adults: 3,
  childrenWithBed: 2,
  childrenWithoutBed: 1,
  infants: 1,
  extraBeds: 0,
  childrenWithBedAges: [4, 6],
  childrenWithoutBedAges: [8],
  infantAges: [9],
  adultNames: ['Aarav Mehta', 'Priya Mehta', ''],
  childWithBedNames: ['Kabir Mehta', ''],
  childWithoutBedNames: ['Anaya Mehta'],
  infantNames: ['Rey Mehta'],
  travellerSummary: '3 Adults',
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
  assignedToId: 'agent-1',
  createdById: 'me',
  lastContactedAt: null,
  nextFollowUpAt: null,
  lostReason: null,
  convertedAt: null,
  internalRemarks: 'VIP customer, handle with care',
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  assignedTo: { id: 'agent-1', fullName: 'Agent One', username: 'agent1' },
  createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
  customer: null,
  services: [{ serviceType: 'FLIGHT' }, { serviceType: 'HOTEL' }, { serviceType: 'SIGHTSEEING' }],
  itinerary: [
    {
      id: 'it-1',
      country: 'Thailand',
      destination: 'Phuket',
      nights: 5,
      sequence: 1,
      arrivalDate: null,
      departureDate: null,
      notes: null,
    },
    {
      id: 'it-2',
      country: 'Thailand',
      destination: 'Bangkok',
      nights: 3,
      sequence: 2,
      arrivalDate: null,
      departureDate: null,
      notes: null,
    },
  ],
};

const exactLead = {
  ...monthLead,
  id: 'lead-2',
  queryNumber: 'QRY-2026-000002',
  travelStartDate: '2026-10-23',
  travelMonth: null,
  travelYear: null,
};

const richWorkspace = (lead: unknown) => ({
  lead,
  operationalSummary: {
    pendingFollowUpCount: 0,
    overdueFollowUpCount: 0,
    completedFollowUpCount: 0,
    notesCount: 1,
    daysSinceLastContact: null,
    noFutureFollowUp: false,
    requiresAttention: false,
  },
  indicators: [],
  recent: { notes: [], followUps: [], timeline: [] },
  quotations: { count: 0, latest: null, items: [] },
  bookings: { count: 0, latest: null, items: [] },
  timezone: 'Asia/Kolkata',
  permissions: {
    canEdit: true,
    canAssign: true,
    canChangeStage: true,
    canAddNote: true,
    canScheduleFollowUp: false,
    canCompleteFollowUp: false,
    canDelete: false,
    canViewQuotations: false,
    canCreateQuotation: false,
    canSendQuotation: false,
    canGenerateQuotationPdf: false,
    canViewBookings: false,
    canConvertBooking: false,
  },
});

const thailand = {
  id: 'dest-th',
  name: 'Thailand',
  cities: [{ city: { id: 'c-phuket', name: 'Phuket' } }, { city: { id: 'c-bangkok', name: 'Bangkok' } }],
};

function stubApi(options: {
  lead?: unknown;
  createdId?: string;
  lookupsOverride?: unknown;
} = {}) {
  const calls: Array<[unknown, { method: string | undefined; body?: unknown }]> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method;
    calls.push([input, { method, body: (init as { body?: unknown } | undefined)?.body }]);
    if (method === 'POST' && url.endsWith('/queries')) {
      const body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      return response({ id: options.createdId ?? 'lead-2', queryNumber: 'QRY-2026-000002', ...body });
    }
    if (url.includes('/workspace')) return response(richWorkspace(options.lead ?? monthLead));
    if (url.includes('/notes')) return response([]);
    if (url.includes('/follow-ups')) return response([]);
    if (url.includes('/timeline')) return response({ data: [], pagination: {} });
    if (url.includes('/queries/lookups')) return response(options.lookupsOverride ?? lookups);
    if (url.includes('/masters/destinations')) {
      return response({ data: [thailand], pagination: { total: 1 } });
    }
    return response({ data: [], pagination: { total: 0 } });
  });
  vi.stubGlobal('fetch', mock);
  return { calls, mock };
}

const renderBoth = (route = '/queries/lead-1') =>
  renderWithProviders(
    <Routes>
      <Route path="/queries/new" element={<LeadFormPage />} />
      <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
      <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
    </Routes>,
    { route },
  );

describe('Duplicate Lead', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.user = { id: 'me', fullName: 'Owner', username: 'owner' } as { id: string };
    authState.permissions = new Set(['queries.view', 'queries.create', 'queries.update', 'queries.assign']);
  });

  it('shows Duplicate Lead on the detail page for authorized users', async () => {
    stubApi();
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    expect(screen.getByRole('link', { name: 'Duplicate Lead' })).toBeInTheDocument();
  });

  it('places Edit immediately left of Duplicate Lead in one right-aligned group', async () => {
    stubApi();
    renderBoth();
    const heading = await screen.findByRole('heading', { name: 'Aarav Mehta' });
    const edit = screen.getByRole('link', { name: 'Edit' });
    const duplicate = screen.getByRole('link', { name: 'Duplicate Lead' });
    // Both actions share one group, with Edit directly before Duplicate Lead.
    expect(edit.parentElement).toBe(duplicate.parentElement);
    expect(edit.nextElementSibling).toBe(duplicate);
    // The group is pushed to the right end of the header row.
    expect(duplicate.parentElement?.className).toContain('justify-end');
    expect(duplicate.parentElement?.className).toContain('flex-wrap');
    // The identity block shares the header row with the action group.
    const header = duplicate.parentElement?.parentElement;
    expect(header?.contains(heading)).toBe(true);
    // Both actions still perform their existing actions.
    expect(edit).toHaveAttribute('href', '/queries/lead-1/edit');
  });

  it('hides Duplicate Lead without create permission', async () => {
    authState.permissions = new Set(['queries.view', 'queries.update']);
    stubApi();
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    expect(screen.queryByRole('link', { name: 'Duplicate Lead' })).not.toBeInTheDocument();
    // Existing actions are untouched.
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
  });

  it('opens the existing Create form prefilled and labelled Create Lead', async () => {
    stubApi();
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.getByLabelText('Name')).toHaveValue('Aarav Mehta');
    expect(screen.getByLabelText('Phone')).toHaveValue('+91 98765 43210');
    // Create workflow, not edit: the submit button creates.
    expect(screen.getByRole('button', { name: 'Create Lead' })).toBeInTheDocument();
  });

  it('prefills lead information, month travel, departure, party, services, itinerary', async () => {
    stubApi();
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });

    expect((screen.getByLabelText('Lead Source *') as HTMLSelectElement).value).toBe('WEBSITE');
    await screen.findByRole('option', { name: 'Hot' });
    await waitFor(() => {
      expect((screen.getByLabelText('Type *') as HTMLSelectElement).value).toBe('HOT');
    });
    expect((screen.getByLabelText('Stage *') as HTMLSelectElement).value).toBe('NEW_LEAD');
    expect((screen.getByLabelText('Assigned salesperson') as HTMLSelectElement).value).toBe(
      'agent-1',
    );
    // Month mode preserved (not converted to an exact date).
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('Travel month') as HTMLSelectElement).value).toBe('4');
    expect((screen.getByLabelText('Travel year') as HTMLSelectElement).value).toBe('2025');
    expect(screen.queryByLabelText('Travel Date')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Departure country') as HTMLInputElement).value).toBe('India');
    expect((screen.getByLabelText('Departure city') as HTMLInputElement).value).toBe('Delhi');
    expect(screen.getByLabelText('Adults *')).toHaveValue(3);
    expect(screen.getByLabelText('CWB')).toHaveValue(2);
    expect(screen.getByLabelText('CWOB')).toHaveValue(1);
    expect(screen.getByLabelText('Infants')).toHaveValue(1);
    // Regenerated summary from counts (not a copied string).
    expect(screen.getByText('3 Adults, 2 Child With Bed, 1 Child Without Bed, 1 Infant')).toBeInTheDocument();
    // Services match exactly.
    expect(screen.getByRole('checkbox', { name: 'Flight' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Hotel' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sightseeing' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cruise' })).not.toBeChecked();
    // Itinerary rows in order.
    expect((screen.getByLabelText('Destination 1') as HTMLInputElement).value).toBe('Thailand');
    expect(screen.getByLabelText('Nights 1')).toHaveValue(5);
    expect(screen.getByLabelText('Nights 2')).toHaveValue(3);
    // Create Lead no longer exposes the itinerary City column.
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('City 2')).not.toBeInTheDocument();
    // Traveller names + ages.
    await userEvent.click(screen.getByRole('button', { name: 'Traveller names' }));
    expect(screen.getByLabelText('Adult 1')).toHaveValue('Aarav Mehta');
    expect(screen.getByLabelText('Adult 3')).toHaveValue('');
    expect(screen.getByLabelText('Child With Bed 1')).toHaveValue('Kabir Mehta');
    expect(screen.getByLabelText('CWB 1 Age')).toHaveValue(4);
    expect(screen.getByLabelText('Infant 1 Age (Months)')).toHaveValue(9);
  });

  it('preserves exact-date travel mode with its date', async () => {
    stubApi({ lead: exactLead });
    renderBoth('/queries/lead-2');
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.getByRole('radio', { name: 'Exact Date' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Travel Date')).toHaveValue('2026-10-23');
    expect(screen.queryByLabelText('Travel month')).not.toBeInTheDocument();
  });

  it('falls back to the session user when the source assignee is unavailable', async () => {
    stubApi({ lead: { ...monthLead, assignedToId: 'ghost-user', assignedTo: null } });
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });
    await waitFor(() =>
      expect((screen.getByLabelText('Assigned salesperson') as HTMLSelectElement).value).toBe('me'),
    );
  });

  it('submitting creates a separate lead and never touches the original', async () => {
    const { calls } = stubApi({ createdId: 'lead-9' });
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });

    // Edit a copied value before saving.
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Aarav Mehta (Family 2)');
    await userEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    await waitFor(() => {
      expect(
        calls.some(([url, options]) => String(url).endsWith('/queries') && options?.method === 'POST'),
      ).toBe(true);
    });
    const post = calls.find(
      ([url, options]) => String(url).endsWith('/queries') && options?.method === 'POST',
    );
    const body = JSON.parse(String(post?.[1]?.body ?? '{}'));
    // New record content, new identity rules.
    expect(body.customerName).toBe('Aarav Mehta (Family 2)');
    expect(body.phone).toBe('+91 98765 43210');
    expect(body.travelMonth).toBe(4);
    expect(body.travelYear).toBe(2025);
    expect(body.services).toEqual(expect.arrayContaining(['FLIGHT', 'HOTEL', 'SIGHTSEEING']));
    expect(body.itinerary).toHaveLength(2);
    expect(body.itinerary[0]).toMatchObject({ destination: 'Phuket', nights: 5 });
    expect(body.id ?? null).toBeNull();
    expect(body.queryNumber ?? null).toBeNull();
    // Excluded associations never leak into the payload.
    for (const key of ['notes', 'quotations', 'bookings', 'payments', 'timeline', 'documents']) {
      expect(body, `payload must not contain ${key}`).not.toHaveProperty(key);
    }
    // Unlisted form fields reset to safe defaults rather than copying over.
    expect(body.internalRemarks).toBeNull();
    // Original untouched: no update call to the source lead…
    expect(
      calls.some(([url, options]) => String(url).includes('/queries/lead-1') && options?.method === 'PATCH'),
    ).toBe(false);
    // …and the new id comes from the backend: the app loads the new record.
    await waitFor(() => {
      expect(calls.some(([url]) => String(url).includes('/queries/lead-9/workspace'))).toBe(true);
    });
  });

  it('cancelling leaves the original lead completely unchanged', async () => {
    const { calls } = stubApi();
    renderBoth();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Duplicate Lead' }));
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Changed then cancelled');
    expect(calls.some(([, options]) => options?.method === 'POST' || options?.method === 'PATCH')).toBe(
      false,
    );
  });

  it('plain Create route still works with empty defaults', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route path="/queries/new" element={<LeadFormPage />} />
      </Routes>,
      { route: '/queries/new' },
    );
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Phone')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create Lead' })).toBeInTheDocument();
  });
});

describe('buildDuplicateLeadDraft', () => {
  it('copies only form fields and resets identity, timestamps, and associations', () => {
    const draft = buildDuplicateLeadDraft(monthLead as unknown as Lead);
    expect(draft.id).toBe('');
    expect(draft.queryNumber).toBe('');
    expect(draft.createdAt).toBe('');
    expect(draft.internalRemarks).toBeNull();
    expect(draft.customer).toBeNull();
    expect(draft.customerName).toBe('Aarav Mehta');
    expect(draft.assignedToId).toBe('agent-1');
    expect(draft.travelMonth).toBe(4);
    expect(draft.travelYear).toBe(2025);
    expect(draft.services.map((s) => s.serviceType)).toEqual(['FLIGHT', 'HOTEL', 'SIGHTSEEING']);
    expect(draft.itinerary.map((r) => [r.destination, r.nights, r.sequence])).toEqual([
      ['Phuket', 5, 1],
      ['Bangkok', 3, 2],
    ]);
    expect(draft.itinerary.every((r) => r.id === '')).toBe(true);
    expect(draft.adultNames).toEqual(['Aarav Mehta', 'Priya Mehta', '']);
  });

  it('drops unknown service types that would fail backend validation', () => {
    const draft = buildDuplicateLeadDraft({
      ...monthLead,
      services: [{ serviceType: 'FLIGHT' }, { serviceType: 'TELEPORT' }],
    } as unknown as Lead);
    expect(draft.services.map((s) => s.serviceType)).toEqual(['FLIGHT']);
  });
});
