import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { LeadDetailsPage } from './LeadDetailsPage';
import { LeadFormPage } from './LeadFormPage';

const authState = vi.hoisted(() => ({
  permissions: new Set<string>(['queries.view', 'queries.update']),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me' },
    hasPermission: (permission: string) => authState.permissions.has(permission),
  }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const richLead = {
  id: 'lead-1',
  queryNumber: 'QRY-2026-000001',
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  alternatePhone: '+91 90000 11111',
  email: 'aarav@example.test',
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
  extraBeds: 1,
  childrenWithBedAges: [4, 6],
  childrenWithoutBedAges: [8],
  infantAges: [9],
  adultNames: ['Aarav Mehta', 'Priya Mehta', ''],
  childWithBedNames: ['Kabir Mehta', ''],
  childWithoutBedNames: ['Anaya Mehta'],
  infantNames: ['Rey Mehta'],
  travellerSummary: '3 Adults',
  expectedAmount: '250000',
  budgetMin: '100000',
  budgetMax: '300000',
  expectedMargin: '25000',
  currency: 'INR',
  tripType: 'Leisure',
  quotationRequired: false,
  bookingStatusPlaceholder: null,
  webLinkPlaceholder: null,
  supplierCostingNotes: 'Prefer morning flights',
  assignedToId: 'me',
  createdById: 'me',
  lastContactedAt: '2026-07-20T10:00:00.000Z',
  nextFollowUpAt: null,
  lostReason: null,
  convertedAt: null,
  internalRemarks: 'VIP customer, handle with care',
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  assignedTo: { id: 'me', fullName: 'Owner', username: 'owner' },
  createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
  customer: {
    id: 'cust-1',
    customerNumber: 'CUST-000001',
    displayName: 'Aarav Mehta',
    primaryPhone: '+91 98765 43210',
    email: 'aarav@example.test',
  },
  services: [{ serviceType: 'FLIGHT' }, { serviceType: 'HOTEL' }],
  // Deliberately out of sequence order: the page must render Phuket first.
  itinerary: [
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
    {
      id: 'it-1',
      country: 'Thailand',
      destination: 'Phuket',
      nights: 5,
      sequence: 1,
      arrivalDate: null,
      departureDate: null,
      notes: 'Beach resort',
    },
  ],
};

const richWorkspace = {
  lead: richLead,
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
  quotations: {
    count: 1,
    latest: null,
    items: [
      {
        id: 'quote-1',
        quotationNumber: 'QT-2026-000001',
        status: 'ACCEPTED',
        currentVersionId: 'ver-1',
        lastSentAt: null,
        lastViewedAt: null,
        acceptedAt: '2026-07-22T00:00:00.000Z',
        createdAt: '2026-07-21T00:00:00.000Z',
        booking: null,
        versions: [
          {
            id: 'ver-1',
            versionNumber: 1,
            finalAmount: '50000',
            currency: 'INR',
            status: 'FINALIZED',
          },
        ],
      },
    ],
  },
  bookings: { count: 0, latest: null, items: [] },
  timezone: 'Asia/Kolkata',
  permissions: {
    canEdit: true,
    canAssign: true,
    canChangeStage: true,
    canAddNote: true,
    canScheduleFollowUp: false,
    canCompleteFollowUp: false,
    canDelete: true,
    canViewQuotations: true,
    canCreateQuotation: false,
    canSendQuotation: false,
    canGenerateQuotationPdf: false,
    canViewBookings: false,
    canConvertBooking: false,
  },
};

const minimalLead = {
  ...richLead,
  id: 'lead-2',
  alternatePhone: null,
  email: null,
  travelMonth: null,
  travelYear: null,
  departureCountry: null,
  departureCity: null,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  childrenWithBedAges: null,
  childrenWithoutBedAges: null,
  infantAges: null,
  adultNames: null,
  childWithBedNames: null,
  childWithoutBedNames: null,
  infantNames: null,
  expectedAmount: null,
  budgetMin: null,
  budgetMax: null,
  expectedMargin: null,
  tripType: null,
  supplierCostingNotes: null,
  lastContactedAt: null,
  internalRemarks: null,
  customer: null,
  services: [],
  itinerary: [],
};

function stubDetail(workspace: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/workspace')) return response(workspace);
      if (url.includes('/notes'))
        return response([
          {
            id: 'note-1',
            content: 'Customer prefers morning flights',
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
            isCustomerContact: false,
            contactMethod: null,
            contactedAt: null,
            authorUser: { id: 'me', fullName: 'Owner', username: 'owner' },
          },
        ]);
      if (url.includes('/follow-ups')) return response([]);
      if (url.includes('/timeline'))
        return response({
          data: [
            {
              id: 't1',
              type: 'LEAD_CREATED',
              title: 'Lead created',
              description: 'Created',
              timestamp: '2026-07-21T00:00:00.000Z',
              actor: { id: 'me', fullName: 'Owner', username: 'owner' },
            },
          ],
          pagination: {},
        });
      if (url.includes('/lookups')) return response({});
      return response({ data: [], pagination: {} });
    }),
  );
}

const renderDetail = (id = 'lead-1') =>
  renderWithProviders(
    <Routes>
      <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
    </Routes>,
    { route: `/queries/${id}` },
  );
describe('Lead Detail page redesign', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update']);
  });

  it('removes the header card, side panels and action buttons', async () => {
    stubDetail({ ...richWorkspace, lead: richLead });
    renderDetail();
    await screen.findByText('Contact Information');

    // Removed: the entire top header card (back arrow button, stage badge,
    // phone links) with no replacement card.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    // Removed: right-side Lead actions panel and its controls.
    expect(screen.queryByText('Lead actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Change stage')).not.toBeInTheDocument();
    expect(screen.queryByText('Reassign lead')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New stage')).not.toBeInTheDocument();
    // Removed: right-side Payments panel and every Record Payment button.
    expect(screen.queryByText('Payments')).not.toBeInTheDocument();
    expect(screen.queryByText('No payments recorded')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    // Removed: top Delete Lead button (the delete API itself is untouched).
    expect(screen.queryByRole('button', { name: 'Delete Lead' })).not.toBeInTheDocument();
    // Removed: the small LEAD DETAILS label.
    expect(screen.queryByText('Lead details')).not.toBeInTheDocument();

    // Kept: contact info (phone) and all detail sections below the tabs.
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
    expect(screen.getByText('Travel Details')).toBeInTheDocument();
  });

  it('shows the lead name, ID and creation timestamp above the tabs', async () => {
    stubDetail(richWorkspace);
    renderDetail();
    const heading = await screen.findByRole('heading', { name: 'Aarav Mehta' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('QRY-2026-000001')).toBeInTheDocument();
    expect(screen.getAllByText(/Created/).length).toBeGreaterThan(0);
    // The identity block sits between the back button and the tabs.
    const back = screen.getByRole('link', { name: 'Back to Leads' });
    const nav = screen.getByRole('navigation', { name: 'Lead sections' });
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows a Back to Leads button above the tabs', async () => {
    stubDetail(richWorkspace);
    renderDetail();
    await screen.findByText('Contact Information');
    const back = screen.getByRole('link', { name: 'Back to Leads' });
    expect(back).toHaveAttribute('href', '/queries');
    // The button sits above the tabs navigation, with no restored header.
    const nav = screen.getByRole('navigation', { name: 'Lead sections' });
    expect(back.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Aarav Mehta' })).toBeInTheDocument();
  });

  it('keeps all four tabs and switches between them', async () => {
    stubDetail(richWorkspace);
    renderDetail();
    await screen.findByText('Contact Information');
    for (const tab of ['Lead Information', 'Quotations', 'Notes', 'Timeline']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Quotations' }));
    expect(await screen.findByRole('link', { name: 'QT-2026-000001' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Customer prefers morning flights')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByText('Lead created')).toBeInTheDocument();
  });

  it('displays the complete lead information in organized sections', async () => {
    stubDetail(richWorkspace);
    const view = renderDetail();
    await screen.findByText('Contact Information');

    // Contact Information.
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByText('+91 90000 11111')).toBeInTheDocument();
    expect(screen.getAllByText('aarav@example.test').length).toBeGreaterThan(0);
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Hot')).toBeInTheDocument();
    expect(screen.getAllByText('Owner').length).toBeGreaterThan(0);

    // Travel Details with counts and ages — Rooms is intentionally absent.
    expect(screen.getByText('Travel Details')).toBeInTheDocument();
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument();
    expect(screen.getByText('April 2025')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByText('Delhi')).toBeInTheDocument();
    expect(screen.getByText('2 (ages 4, 6)')).toBeInTheDocument();
    expect(screen.getByText('1 (age 8)')).toBeInTheDocument();
    expect(screen.getByText('1 (9 months)')).toBeInTheDocument();

    // Traveller Names with clear category labels and no card background.
    expect(screen.getByText('Traveller Names')).toBeInTheDocument();
    const firstName = screen.getByText('Adult 1: Aarav Mehta');
    expect(firstName.className).not.toContain('bg-slate-50');
    expect(screen.getByText('Adult 2: Priya Mehta')).toBeInTheDocument();
    expect(screen.getByText('Child With Bed 1: Kabir Mehta')).toBeInTheDocument();
    expect(screen.getByText('Child Without Bed 1: Anaya Mehta')).toBeInTheDocument();
    expect(screen.getByText('Infant 1: Rey Mehta')).toBeInTheDocument();

    // Services Required.
    expect(screen.getByText('Services Required')).toBeInTheDocument();
    expect(screen.getByText('Flight')).toBeInTheDocument();
    expect(screen.getByText('Hotel')).toBeInTheDocument();

    // Itinerary in sequence order despite the stored order.
    expect(screen.getByText('Itinerary')).toBeInTheDocument();
    const itinerary = screen.getByText('Itinerary').closest('section')!;
    const rows = within(itinerary).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Itinerary rows carry no card background.
    for (const row of rows) expect(row.className).not.toContain('bg-slate-50');
    expect(rows[0]!.textContent).toContain('Phuket');
    expect(rows[0]!.textContent).toContain('5 nights');
    expect(rows[1]!.textContent).toContain('Bangkok');
    expect(rows[1]!.textContent).toContain('3 nights');
    expect(screen.getByText('Beach resort')).toBeInTheDocument();
    // No "Dates open" placeholder anywhere in the itinerary.
    expect(screen.queryByText('Dates open')).not.toBeInTheDocument();

    // Additional Information was removed from the page entirely.
    expect(screen.queryByText('Additional Information')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest quotation')).not.toBeInTheDocument();
    expect(screen.queryByText('Leisure')).not.toBeInTheDocument();
    expect(screen.queryByText('VIP customer, handle with care')).not.toBeInTheDocument();
    expect(screen.queryByText('Prefer morning flights')).not.toBeInTheDocument();
    view.unmount();
  });

  it('omits the leading separator on itinerary rows whose city is empty', async () => {
    const leadWithMixedItinerary = {
      ...richLead,
      itinerary: [
        {
          id: 'it-a',
          country: 'Singapore Heaven Delight',
          destination: '',
          nights: 4,
          sequence: 1,
          arrivalDate: null,
          departureDate: null,
          notes: null,
        },
        {
          id: 'it-b',
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
    stubDetail({ ...richWorkspace, lead: leadWithMixedItinerary });
    renderDetail();
    await screen.findByText('Contact Information');

    const itinerary = screen.getByText('Itinerary').closest('section')!;
    const rows = within(itinerary).getAllByRole('listitem');
    // Missing city: no stray leading comma, just the destination.
    expect(rows[0]!.textContent).toContain('Singapore Heaven Delight');
    expect(rows[0]!.textContent).not.toContain(',');
    // Both present: the city and destination are still separated by a comma.
    expect(rows[1]!.textContent).toContain('Bangkok, Thailand');
  });

  it('hides empty sections and shows no misleading values', async () => {
    stubDetail({ ...richWorkspace, lead: minimalLead });
    renderDetail('lead-2');
    await screen.findByText('Contact Information');

    // Core sections stay; empty ones disappear.
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByText('Travel Details')).toBeInTheDocument();
    expect(screen.queryByText('Traveller Names')).not.toBeInTheDocument();
    expect(screen.queryByText('Services Required')).not.toBeInTheDocument();
    expect(screen.queryByText('Itinerary')).not.toBeInTheDocument();
    // No misleading placeholders for missing optional values.
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('null');
  });

  it('displays stored travel dates as DD-MM-YYYY', async () => {
    stubDetail({
      ...richWorkspace,
      lead: { ...richLead, travelStartDate: '2026-11-05', travelEndDate: '2026-11-10' },
    });
    renderDetail();
    await screen.findByText('Contact Information');

    // Range shares the row with the month label, so match on containment.
    expect(document.body.textContent).toContain('05-11-2026 – 10-11-2026');
    // No ambiguous locale-slash rendering of the range.
    expect(document.body.textContent).not.toContain('11/5/2026');
    expect(document.body.textContent).not.toContain('11/10/2026');
  });

  it('keeps month-only travel timing when no travel dates exist', async () => {
    stubDetail(richWorkspace);
    renderDetail();
    await screen.findByText('Contact Information');

    expect(screen.getByText('April 2025')).toBeInTheDocument();
  });
});

describe('Lead Details header Edit button', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update']);
  });

  it('shows an Edit button in the header for authorized users', async () => {
    stubDetail(richWorkspace);
    renderDetail();
    const heading = await screen.findByRole('heading', { name: 'Aarav Mehta' });

    const edit = screen.getByRole('link', { name: 'Edit' });
    expect(edit).toHaveAttribute('href', '/queries/lead-1/edit');
    // Pencil icon, aligned with the lead name/ID block.
    expect(edit.querySelector('svg')).not.toBeNull();
    expect(heading.parentElement?.parentElement).toContainElement(edit);
  });

  it('hides the Edit button when the workspace forbids editing the lead', async () => {
    stubDetail({
      ...richWorkspace,
      permissions: { ...richWorkspace.permissions, canEdit: false },
    });
    renderDetail();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('hides the Edit button without the global update permission', async () => {
    authState.permissions = new Set(['queries.view']);
    stubDetail(richWorkspace);
    renderDetail();
    await screen.findByRole('heading', { name: 'Aarav Mehta' });

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('opens the existing lead in edit mode with saved values hydrated', async () => {
    const lookups = {
      countries: ['India'],
      cities: ['Delhi'],
      leadSources: [{ value: 'WEBSITE', label: 'Website' }],
      leadTypes: [{ value: 'HOT', label: 'Hot' }],
      leadStages: [{ value: 'NEW_LEAD', label: 'New Lead' }],
      priorities: [{ value: 'HIGH', label: 'High' }],
      serviceTypes: [
        { value: 'FLIGHT', label: 'Flight' },
        { value: 'HOTEL', label: 'Hotel' },
      ],
      tripTypes: ['Leisure'],
      currencies: ['INR'],
      assignableUsers: [{ id: 'me', fullName: 'Owner', username: 'owner' }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const url = String(input);
        if (url.includes('/workspace'))
          return response({ ...richWorkspace, lead: richLead });
        if (url.match(/\/queries\/lead-1(\?|$)/) && options?.method !== 'PATCH')
          return response(richLead);
        if (url.includes('/masters/destinations'))
          return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
        if (url.includes('/notes')) return response([]);
        if (url.includes('/follow-ups')) return response([]);
        if (url.includes('/timeline'))
          return response({ data: [], pagination: {} });
        if (url.includes('/lookups')) return response(lookups);
        return response({ data: [], pagination: {} });
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: '/queries/lead-1' },
    );

    await screen.findByRole('heading', { name: 'Aarav Mehta' });
    await userEvent.click(screen.getByRole('link', { name: 'Edit' }));

    // The existing Edit Lead route renders in edit mode for this lead.
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Saved values hydrate into the form (lead name, phone, traveller name).
    expect(screen.getByLabelText('Name')).toHaveValue('Aarav Mehta');
    expect(screen.getByLabelText('Phone')).toHaveValue('+91 98765 43210');
  });
});
