import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { DashboardPage } from './DashboardPage';

const response = (data: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () =>
      ok
        ? { success: true, data }
        : { success: false, error: { code: 'INTERNAL_ERROR', message: 'failed' } },
  }) as Response;

const fullCaps = {
  canViewLeads: true,
  canViewQuotations: true,
  canViewBookings: true,
  canViewFinancials: true,
  canViewVendors: true,
  canViewVendorFinancials: true,
  canViewFollowUps: true,
};

const analytics = (overrides: Record<string, unknown> = {}) => ({
  period: { key: 'THIS_YEAR', from: null, to: null, timezone: 'Asia/Kolkata' },
  capabilities: fullCaps,
  leads: {
    totalLeads: 40,
    convertedLeads: 12,
    lostLeads: 8,
    qualifiedLeads: 10,
    hotLeads: 6,
    quotationRequired: 5,
    readyToBook: 3,
    conversionRate: 30,
    winRate: 60,
  },
  quotations: {
    totalQuotations: 20,
    acceptedQuotations: 12,
    rejectedQuotations: 8,
    quotationAcceptanceRate: 60,
    agencyRevenue: '250000.00',
  },
  bookings: {
    totalBookings: 12,
    confirmedBookings: 8,
    pendingConfirmation: 2,
    travelInProgress: 1,
    completed: 1,
    cancelled: 0,
  },
  financials: {
    totalCustomerAmount: '600000.00',
    totalPayable: '640000.00',
    customerPaymentsReceived: '400000.00',
    customerOutstanding: '240000.00',
    totalRefunded: '20000.00',
    netRevenue: '380000.00',
    totalCost: '300000.00',
    totalVendorOutstanding: '50000.00',
    grossProfit: '340000.00',
    netProfit: '80000.00',
    profitMarginPercentage: '53.1200',
  },
  leadSources: [
    { source: 'REFERRAL', label: 'Referral', count: 20, percentage: 50 },
    { source: 'WEBSITE', label: 'Website', count: 12, percentage: 30 },
  ],
  topDestinations: [
    { destination: 'Goa', enquiryCount: 15 },
    { destination: 'Dubai', enquiryCount: 9 },
  ],
  staffConversions: [
    {
      userId: 'u1',
      displayName: 'Aditi Rao',
      totalLeads: 20,
      convertedLeads: 8,
      lostLeads: 4,
      conversionRate: 40,
      rank: 1,
    },
  ],
  staffFinancials: [
    {
      userId: 'u1',
      displayName: 'Aditi Rao',
      bookingCount: 6,
      revenue: '300000.00',
      netRevenue: '280000.00',
      grossProfit: '120000.00',
      netProfit: '60000.00',
      marginPercentage: '20.0000',
      rank: 1,
    },
  ],
  ...overrides,
});

const operations = (overrides: Record<string, unknown> = {}) => ({
  capabilities: fullCaps,
  priorityFollowUps: {
    totalCount: 1,
    viewAllPath: '/follow-ups',
    items: [
      {
        followUpId: 'f1',
        queryId: 'q1',
        queryNumber: 'QRY-2026-000001',
        customerName: 'Ravi Kumar',
        assignedTo: 'Aditi Rao',
        leadType: 'HOT',
        overdue: true,
      },
    ],
  },
  nearTravelDates: {
    totalCount: 1,
    viewAllPath: '/queries',
    items: [
      {
        queryId: 'q2',
        queryNumber: 'QRY-2026-000002',
        customerName: 'Meera Shah',
        destinationSummary: 'Goa',
        daysUntilTravel: 4,
      },
    ],
  },
  upcomingTrips: {
    totalCount: 1,
    viewAllPath: '/bookings',
    items: [
      {
        bookingId: 'b1',
        bookingNumber: 'BK-2026-000001',
        customerName: 'Ravi Kumar',
        destinationSummary: 'Goa',
        daysUntilTravel: 12,
      },
    ],
  },
  pendingCompletion: {
    totalCount: 1,
    viewAllPath: '/bookings',
    items: [
      {
        bookingId: 'b2',
        bookingNumber: 'BK-2026-000002',
        customerName: 'Sara Khan',
        operationalStatus: 'TRAVEL_IN_PROGRESS',
        daysOverdue: 2,
      },
    ],
  },
  clientPaymentsDue: {
    totalCount: 1,
    viewAllPath: '/bookings',
    items: [
      {
        scheduleId: 's1',
        bookingId: 'b3',
        bookingNumber: 'BK-2026-000003',
        customerName: 'Ravi Kumar',
        label: 'Advance',
        amount: '25000.00',
        overdue: true,
      },
    ],
  },
  vendorPaymentsDue: {
    totalCount: 1,
    viewAllPath: '/vendors',
    items: [
      {
        payableId: 'p1',
        vendorId: 'v1',
        vendorName: 'Ground Handler',
        bookingNumber: 'BK-2026-000004',
        payableNumber: 'VP-2026-000001',
        outstandingAmount: '18000.00',
      },
    ],
  },
  ...overrides,
});

function stub(analyticsData: unknown, operationsData: unknown, ok = true) {
  const mock = vi.fn(async (request: RequestInfo | URL) =>
    String(request).includes('/dashboard/operations')
      ? response(operationsData, ok)
      : response(analyticsData, ok),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

const renderDashboard = () =>
  renderWithProviders(
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/queries/:id" element={<div>Lead page</div>} />
      <Route path="/bookings/:id" element={<div>Booking page</div>} />
    </Routes>,
    { route: '/dashboard' },
  );

describe('Phase 16 dashboard page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders analytics content directly with lead KPIs', async () => {
    stub(analytics(), operations());
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Total Leads')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('Converted Leads')).toBeInTheDocument();
    // No account/session panel remains from the old dashboard.
    expect(screen.queryByText('Your account')).not.toBeInTheDocument();
  });

  it('does not show an Analytics/Operations selector', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.queryByRole('button', { name: 'operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'analytics' })).not.toBeInTheDocument();
  });

  it('shows financial tiles and the profit table with financial permission', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.getByText('Agency Revenue')).toBeInTheDocument();
    // Agency revenue comes from the quotations metrics, formatted as INR.
    expect(screen.getByText('₹2,50,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Net Profit').length).toBeGreaterThan(0);
    expect(screen.getByText('Top Performers — Profit Earned')).toBeInTheDocument();
    // Removed KPI cards never render.
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('Acceptance Rate')).not.toBeInTheDocument();
  });

  it('omits financial tiles and profit table without financial permission', async () => {
    stub(
      analytics({
        capabilities: { ...fullCaps, canViewFinancials: false },
        financials: undefined,
        staffFinancials: undefined,
      }),
      operations(),
    );
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.queryByText('Agency Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Top Performers — Profit Earned')).not.toBeInTheDocument();
    // Non-financial lead panels still render.
    expect(screen.getByText('Lead Sources')).toBeInTheDocument();
  });

  it('renders the lead-source and destination charts with accessible values', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Lead Sources');
    // Legend carries the real counts and percentages.
    expect(screen.getByText('Referral')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Top Destination Enquiries')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Goa: 15' })).toBeInTheDocument();
  });

  it('renders the staff conversion table', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Top Performers — Conversion Rate');
    expect(screen.getAllByText('Aditi Rao').length).toBeGreaterThan(0);
  });

  it('exposes the period selector and custom range fields', async () => {
    const mock = stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    await userEvent.selectOptions(screen.getByLabelText('Dashboard period'), 'CUSTOM');
    expect(screen.getByLabelText('Custom from date')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Custom from date'), '2026-01-01');
    await userEvent.type(screen.getByLabelText('Custom to date'), '2026-06-30');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) =>
          String(url).includes('period=CUSTOM&from=2026-01-01&to=2026-06-30'),
        ),
      ).toBe(true),
    );
  });

  it('shows an error state when analytics fails', async () => {
    stub(analytics(), operations(), false);
    renderDashboard();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });

  it('shows empty panel states', async () => {
    stub(analytics({ leadSources: [], topDestinations: [], staffConversions: [] }), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.getByText('No staff activity in this period.')).toBeInTheDocument();
  });

  it('renders confirmed revenue by destination sorted with INR amounts', async () => {
    stub(
      analytics({
        confirmedRevenueByDestination: [
          { destination: 'Goa', totalAmount: '150000.00' },
          { destination: 'Dubai', totalAmount: '80000.00' },
        ],
      }),
      operations(),
    );
    renderDashboard();
    expect(await screen.findByText('Booking Confirmed Amount (Destination Wise)')).toBeInTheDocument();
    // Amounts use Indian currency formatting above each bar.
    expect(screen.getAllByText('₹1,50,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₹80,000.00').length).toBeGreaterThanOrEqual(1);
    // Accessible summary lists every bar in descending order.
    expect(
      screen.getByRole('img', { name: 'Goa: ₹1,50,000.00, Dubai: ₹80,000.00' }),
    ).toBeInTheDocument();
  });

  it('shows the revenue chart empty state when nothing qualifies', async () => {
    stub(analytics({ confirmedRevenueByDestination: [] }), operations());
    renderDashboard();
    await screen.findByText('Booking Confirmed Amount (Destination Wise)');
    expect(screen.getByText('No data')).toBeInTheDocument();
    // Existing KPIs and charts are unaffected.
    expect(screen.getByText('Total Leads')).toBeInTheDocument();
    expect(screen.getByText('Lead Sources')).toBeInTheDocument();
  });

  it('refreshes the revenue chart when the period is applied', async () => {
    const mock = stub(
      analytics({
        confirmedRevenueByDestination: [{ destination: 'Goa', totalAmount: '150000.00' }],
      }),
      operations(),
    );
    renderDashboard();
    await screen.findByText('Booking Confirmed Amount (Destination Wise)');
    await userEvent.selectOptions(screen.getByLabelText('Dashboard period'), 'THIS_MONTH');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => String(url).includes('period=THIS_MONTH')),
      ).toBe(true),
    );
  });

  it('hides the Net Profit card when its value is zero', async () => {
    stub(analytics({ financials: { ...analytics().financials, netProfit: '0.00' } }), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.queryByText('Net Profit')).not.toBeInTheDocument();
    // Neighbouring cards still render with no gap left behind.
    expect(screen.getByText('Total Leads')).toBeInTheDocument();
    expect(screen.getByText('Agency Revenue')).toBeInTheDocument();
    expect(screen.getByText('Quotations')).toBeInTheDocument();
  });

  it('shows the Net Profit card formatted for a positive value', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.getByText('Net Profit')).toBeInTheDocument();
    expect(screen.getByText('₹80,000.00')).toBeInTheDocument();
  });

  it('hides the Net Profit card for missing values without NaN', async () => {
    const bare = analytics();
    delete (bare.financials as Record<string, unknown>).netProfit;
    stub(bare, operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    expect(screen.queryByText('Net Profit')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it('orders KPI cards, chart, travel, sources, then performers', async () => {
    stub(analytics(), operations());
    renderDashboard();
    await screen.findByText('Total Leads');
    const text = document.body.textContent ?? '';
    const order = [
      'Total Leads',
      'Converted Leads',
      'Agency Revenue',
      'Hot Leads',
      'Conversion Rate',
      'Quotations',
      'Net Profit',
      'Booking Confirmed Amount (Destination Wise)',
      'Upcoming Travel',
      'Other Upcoming Travel',
      'Lead Sources',
      'Top Destination Enquiries',
      'Top Performers — Conversion Rate',
      'Top Performers — Profit Earned',
    ];
    let fromIndex = -1;
    for (const label of order) {
      const index = text.indexOf(label, fromIndex + 1);
      expect(index, `missing or misordered section: ${label}`).toBeGreaterThan(fromIndex);
      fromIndex = index;
    }
  });
});
