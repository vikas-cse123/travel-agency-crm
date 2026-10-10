import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { LeadPaymentsCard, RecordLeadPaymentDialog } from './LeadPayments';
import { LeadDetailsPage } from './LeadDetailsPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'me' },
    hasPermission: (key: string) => auth.permissions.has(key),
  }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const paymentRow = {
  id: 'pay-1',
  paymentNumber: 'PAY-000001',
  amount: '10000.00',
  currency: 'INR',
  paymentMethod: 'UPI',
  paymentStatus: 'RECEIVED',
  receivedAt: '2026-10-09T00:00:00.000Z',
  referenceNumber: 'UPI123',
  bankName: null,
  notes: null,
  createdAt: '2026-10-09T00:00:00.000Z',
  reversedAt: null,
  reversedById: null,
  reversalReason: null,
  recordedBy: { id: 'u1', fullName: 'Owner' },
  reversedBy: null,
  receipt: { id: 'rcp-1', receiptNumber: 'RCP-000001', uploadStatus: 'AVAILABLE' },
};

const paymentCase = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-1',
  customerId: null,
  queryId: 'lead-1',
  customerName: 'Vikas Sahni',
  customerPhone: null,
  customerEmail: null,
  title: 'Vikas Sahni – Singapore',
  tripAmount: '600000.00',
  currency: 'INR',
  collected: '10000.00',
  outstanding: '590000.00',
  paymentCount: 1,
  status: 'PARTIALLY_PAID',
  customer: null,
  query: { id: 'lead-1', queryNumber: 'QRY-000006', customerName: 'Vikas Sahni' },
  createdBy: { id: 'u1', fullName: 'Owner' },
  payments: [paymentRow],
  ...overrides,
});

const leadState = (overrides: Record<string, unknown> = {}) => ({
  lead: { id: 'lead-1', queryNumber: 'QRY-000006', customerName: 'Vikas Sahni' },
  quotation: {
    id: 'q-1',
    quotationNumber: 'QT-001034',
    finalAmount: 600000,
    currency: 'INR',
  },
  suggestion: {
    title: 'Vikas Sahni – Singapore',
    tripAmount: 600000,
    currency: 'INR',
    quotationId: 'q-1',
    quotationNumber: 'QT-001034',
  },
  requiresAmount: false,
  created: false,
  case: paymentCase(),
  ...overrides,
});

function stubPayments({
  byLead = leadState(),
  forLead,
  record,
  recordError,
}: {
  byLead?: unknown;
  forLead?: unknown;
  record?: unknown;
  recordError?: { status: number; message: string };
} = {}) {
  const calls: Array<{ url: string; method: string | undefined; body: unknown }> = [];
  const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.includes('/payments/cases/by-lead')) return response(byLead);
    if (url.includes('/payments/cases/for-lead')) {
      calls.push({
        url,
        method: options?.method,
        body: options?.body ? JSON.parse(String(options.body)) : undefined,
      });
      return response(forLead ?? byLead);
    }
    if (url.endsWith('/api/payments') && options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      calls.push({ url, method: 'POST', body });
      if (recordError)
        return {
          ok: false,
          status: recordError.status,
          json: async () => ({
            success: false,
            error: { code: 'CONFLICT', message: recordError.message },
          }),
        } as unknown as Response;
      return response(record ?? { id: 'pay-2', paymentNumber: 'PAY-000002' });
    }
    return response({ data: [], pagination: {} });
  });
  vi.stubGlobal('fetch', mock);
  return { calls, mock };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  auth.permissions = new Set(['payments.view', 'payments.create', 'payments.view_receipts']);
});

describe('Lead payments card', () => {
  it('shows the empty state with a Record action when no case exists', async () => {
    stubPayments({ byLead: leadState({ case: null, requiresAmount: true }) });
    renderWithProviders(<LeadPaymentsCard queryId="lead-1" onRecord={() => undefined} />);
    expect(await screen.findByText('No payments recorded')).toBeInTheDocument();
    // Header action + empty-state action.
    expect(screen.getAllByRole('button', { name: /record payment/i })).toHaveLength(2);
  });

  it('shows agreed, received, outstanding and the payment history', async () => {
    stubPayments();
    renderWithProviders(<LeadPaymentsCard queryId="lead-1" onRecord={() => undefined} />);
    expect(await screen.findByText('₹6,00,000.00')).toBeInTheDocument();
    // Received summary and the payment row share the collected figure.
    expect(screen.getAllByText('₹10,000.00')).toHaveLength(2);
    expect(screen.getByText('₹5,90,000.00')).toBeInTheDocument();
    expect(screen.getByText('PAY-000001')).toBeInTheDocument();
    expect(screen.getByText('RCP-000001')).toBeInTheDocument();
    expect(screen.getByText('Upi')).toBeInTheDocument();
    // Summary label + row status share the word.
    expect(screen.getAllByText('Received')).toHaveLength(2);
  });

  it('hides every Record action without the create permission', async () => {
    auth.permissions = new Set(['payments.view']);
    stubPayments({ byLead: leadState({ case: null, requiresAmount: true }) });
    renderWithProviders(<LeadPaymentsCard queryId="lead-1" onRecord={() => undefined} />);
    expect(await screen.findByText('No payments recorded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
  });

  it('hides the card without the view permission', async () => {
    auth.permissions = new Set([]);
    const mock = vi.fn(async () => response(leadState()));
    vi.stubGlobal('fetch', mock);
    const { container } = renderWithProviders(
      <LeadPaymentsCard queryId="lead-1" onRecord={() => undefined} />,
    );
    await waitFor(() => expect(mock).not.toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('Record lead payment dialog', () => {
  it('prefills the trip and records a payment against its case', async () => {
    const { calls } = stubPayments();
    renderWithProviders(<RecordLeadPaymentDialog queryId="lead-1" onClose={() => undefined} />);
    // Lead + linked quotation context, resolved server-side.
    expect(await screen.findByText(/Vikas Sahni/)).toBeInTheDocument();
    expect(screen.getByText(/QT-001034/)).toBeInTheDocument();
    // Outstanding math from the existing case.
    expect(await screen.findByText(/Outstanding: ₹5,90,000.00/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Amount received'), '50000');
    await userEvent.click(screen.getByRole('button', { name: /^record payment$/i }));
    await waitFor(() =>
      expect(
        calls.some(
          ({ url, body }) =>
            url.endsWith('/api/payments') &&
            (body as Record<string, unknown>).caseId === 'case-1' &&
            (body as Record<string, unknown>).amount === 50000 &&
            (body as Record<string, unknown>).currency === 'INR' &&
            (body as Record<string, unknown>).paymentStatus === 'RECEIVED',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(/PAY-000002/)).toBeInTheDocument();
  });

  it('asks for the agreed amount when none could be derived, then continues', async () => {
    const derived = leadState({ case: null, requiresAmount: true });
    const ready = leadState();
    const forLeadBodies: unknown[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/payments/cases/for-lead')) {
        const body = options?.body ? JSON.parse(String(options.body)) : undefined;
        forLeadBodies.push(body);
        // First call resolves the derivation (no case yet); once the caller
        // supplies values, the created case comes back.
        if (body && typeof body === 'object' && 'tripAmount' in (body as object))
          return response(ready);
        return response(derived);
      }
      return response({ data: [], pagination: {} });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<RecordLeadPaymentDialog queryId="lead-1" onClose={() => undefined} />);
    expect(await screen.findByLabelText('Agreed trip amount')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Agreed trip amount'));
    await userEvent.type(screen.getByLabelText('Agreed trip amount'), '250000');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Case created from caller-supplied values → payment form appears.
    expect(await screen.findByLabelText('Amount received')).toBeInTheDocument();
    expect(forLeadBodies).toContainEqual(
      expect.objectContaining({
        queryId: 'lead-1',
        title: 'Vikas Sahni – Singapore',
        tripAmount: 250000,
      }),
    );
  });

  it('blocks recording on a fully paid trip while showing history', async () => {
    stubPayments({
      byLead: leadState(),
      forLead: leadState({
        case: paymentCase({
          collected: '600000.00',
          outstanding: '0.00',
          paymentCount: 2,
          status: 'PAID',
        }),
      }),
    });
    renderWithProviders(<RecordLeadPaymentDialog queryId="lead-1" onClose={() => undefined} />);
    expect(await screen.findByText(/fully paid/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount received')).not.toBeInTheDocument();
    expect(screen.getByText('PAY-000001')).toBeInTheDocument();
  });

  it('surfaces server rejections such as overpayments', async () => {
    stubPayments({
      recordError: { status: 409, message: 'Payment exceeds the outstanding balance.' },
    });
    renderWithProviders(<RecordLeadPaymentDialog queryId="lead-1" onClose={() => undefined} />);
    await userEvent.type(await screen.findByLabelText('Amount received'), '99999999');
    await userEvent.click(screen.getByRole('button', { name: /^record payment$/i }));
    expect(await screen.findByText('Payment exceeds the outstanding balance.')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    stubPayments();
    const onClose = vi.fn();
    renderWithProviders(<RecordLeadPaymentDialog queryId="lead-1" onClose={onClose} />);
    await screen.findByText(/Vikas Sahni/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Lead details payment entry point', () => {
  const lead = {
    id: 'lead-1',
    queryNumber: 'QRY-000006',
    customerName: 'Vikas Sahni',
    phone: '+91 99999 88888',
    alternatePhone: null,
    email: 'vikas@example.test',
    dateOfBirth: null,
    leadSource: 'REFERRAL',
    leadType: 'HOT',
    leadStage: 'NEW_LEAD',
    priority: 'HIGH',
    departureCountry: 'India',
    departureCity: 'Delhi',
    travelStartDate: null,
    travelEndDate: null,
    travelMonth: 11,
    travelYear: 2026,
    flexibleDates: true,
    rooms: 1,
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
    extraBeds: 0,
    travellerSummary: '2 Adults',
    expectedAmount: null,
    budgetMin: null,
    budgetMax: null,
    expectedMargin: null,
    currency: 'INR',
    tripType: 'Leisure',
    quotationRequired: false,
    bookingStatusPlaceholder: null,
    webLinkPlaceholder: null,
    supplierCostingNotes: null,
    assignedToId: null,
    assignedTo: null,
    createdById: 'u1',
    createdBy: { id: 'u1', fullName: 'Owner', username: 'owner' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    lastContactedAt: null,
    nextFollowUpAt: null,
    lostReason: null,
    convertedAt: null,
    internalRemarks: null,
    customer: null,
    services: [],
    itinerary: [],
  };
  const workspace = {
    lead,
    operationalSummary: {
      pendingFollowUpCount: 0,
      overdueFollowUpCount: 0,
      completedFollowUpCount: 0,
      notesCount: 0,
    },
    indicators: [],
    recent: { notes: [], followUps: [], timeline: [] },
    quotations: { count: 0, latest: null, items: [] },
    bookings: { count: 0, latest: null, items: [] },
    timezone: 'Asia/Kolkata',
    permissions: {
      canEdit: false,
      canAssign: false,
      canChangeStage: false,
      canAddNote: false,
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
  };
  function stubDetails(paymentState: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/workspace')) return response(workspace);
        if (url.includes('/notes')) return response([]);
        if (url.includes('/follow-ups')) return response([]);
        if (url.includes('/timeline')) return response({ data: [], pagination: {} });
        if (url.includes('/lookups')) return response({ leadStages: [], assignableUsers: [] });
        if (url.includes('/payments/cases/by-lead')) return response(paymentState);
        if (url.includes('/payments/cases/for-lead')) return response(paymentState);
        return response({ data: [], pagination: {} });
      }),
    );
  }

  it('shows Record Payment in the header and the payments card on overview', async () => {
    stubDetails(leadState({ case: null, requiresAmount: true }));
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
      </Routes>,
      { route: '/queries/lead-1' },
    );
    const header = await screen.findByText('Lead details');
    expect(header).toBeInTheDocument();
    expect(await screen.findByText('No payments recorded')).toBeInTheDocument();
    // Header action + card header + empty-state action.
    const actions = screen.getAllByRole('button', { name: /record payment/i });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    // Opening the action shows the server-resolved lead context.
    await userEvent.click(actions[0]!);
    expect(await screen.findByRole('dialog', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.getAllByText(/QT-001034/).length).toBeGreaterThanOrEqual(1);
  });

  it('hides the Record action without the create permission', async () => {
    auth.permissions = new Set(['payments.view']);
    stubDetails(leadState({ case: null, requiresAmount: true }));
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
      </Routes>,
      { route: '/queries/lead-1' },
    );
    await screen.findByText('Lead details');
    expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
  });
});
