import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { hashPassword } from '../src/utils/crypto.js';

let app: Express;
let db: PrismaClient;
beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
});

type Client = ReturnType<typeof createAuthClient>;

async function owner(email = 'owner@dash.test', companyName = 'Dashboard Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function roleClient(ownerEmail: string, roleName: string, email: string) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { normalizedEmail: ownerEmail } });
  const role = await db.role.findFirstOrThrow({
    where: { companyId: ownerUser.companyId, name: roleName },
  });
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: email.split('@')[0]!,
      fullName: `${roleName} User`,
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Sales@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  expect(
    (await client.post('/api/auth/login', { email, password: 'Sales@2026', rememberMe: false }))
      .status,
  ).toBe(200);
  return client;
}

const leadPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Lead Customer',
  phone: '+91 90000 10001',
  leadSource: 'REFERRAL',
  leadType: 'WARM',
  leadStage: 'NEW_LEAD',
  priority: 'MEDIUM',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
  ...overrides,
});

async function seedLead(client: Client, overrides: Record<string, unknown> = {}) {
  const response = await client.post('/api/queries', leadPayload(overrides));
  expect(response.status).toBe(201);
  return response.body.data as { id: string };
}

/** Move a lead to a terminal/target stage directly (bypasses UI transitions). */
async function setStage(id: string, leadStage: string) {
  await db.query.update({ where: { id }, data: { leadStage: leadStage as never } });
}

const manualBooking = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Booking Customer',
  customerPhone: '9000020002',
  destinationSummary: 'Goa',
  travelStartDate: '2026-10-10',
  travelEndDate: '2026-10-14',
  currency: 'INR',
  totalSellingAmount: 50000,
  manualCreationReason: 'Dashboard test booking',
  services: [],
  itinerary: [],
  paymentSchedule: [],
  ...overrides,
});

describe('Phase 16 dashboard analytics', () => {
  it('returns lead metrics with conversion and win rate for the period', async () => {
    const client = await owner();
    const a = await seedLead(client, { leadType: 'HOT', leadSource: 'WEBSITE' });
    const b = await seedLead(client, { leadType: 'HOT', leadSource: 'GOOGLE_ADS' });
    const c = await seedLead(client, { leadSource: 'REFERRAL' });
    const d = await seedLead(client, { leadSource: 'REFERRAL' });
    await setStage(a.id, 'BOOKING_CONFIRMED');
    await setStage(b.id, 'BOOKING_CONFIRMED');
    await setStage(c.id, 'LOST');
    void d;

    const res = await client.get('/api/dashboard/analytics?period=THIS_YEAR');
    expect(res.status).toBe(200);
    expect(res.body.data.leads).toMatchObject({
      totalLeads: 4,
      convertedLeads: 2,
      lostLeads: 1,
      hotLeads: 2,
      conversionRate: 50,
      winRate: expect.closeTo(66.7, 1),
    });
    expect(res.body.data.period.key).toBe('THIS_YEAR');
    expect(res.body.data.period.timezone).toBeTruthy();
  });

  it('groups lead sources with counts and percentages, sorted descending', async () => {
    const client = await owner();
    await seedLead(client, { leadSource: 'REFERRAL' });
    await seedLead(client, { leadSource: 'REFERRAL' });
    await seedLead(client, { leadSource: 'WEBSITE' });
    const res = await client.get('/api/dashboard/analytics');
    const sources = res.body.data.leadSources as Array<{
      source: string;
      label: string;
      count: number;
      percentage: number;
    }>;
    expect(sources[0]).toMatchObject({ source: 'REFERRAL', label: 'Referral', count: 2 });
    expect(sources.map((s) => s.source)).toEqual(['REFERRAL', 'WEBSITE']);
    expect(sources.find((s) => s.source === 'REFERRAL')!.percentage).toBeCloseTo(66.7, 1);
    // Zero-count sources are omitted.
    expect(sources.some((s) => s.source === 'WALK_IN')).toBe(false);
  });

  it('groups top destination enquiries case-insensitively', async () => {
    const client = await owner();
    await seedLead(client, {
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await seedLead(client, {
      itinerary: [{ country: 'India', destination: 'goa', nights: 2, sequence: 1 }],
    });
    await seedLead(client, {
      itinerary: [{ country: 'UAE', destination: 'Dubai', nights: 3, sequence: 1 }],
    });
    const res = await client.get('/api/dashboard/analytics?limit=10');
    const destinations = res.body.data.topDestinations as Array<{
      destination: string;
      enquiryCount: number;
    }>;
    expect(destinations[0]).toMatchObject({ enquiryCount: 2 });
    expect(destinations[0]!.destination.toLowerCase()).toBe('goa');
    expect(destinations.find((d) => d.destination === 'Dubai')!.enquiryCount).toBe(1);
  });

  it('ranks staff conversion performance', async () => {
    const client = await owner();
    const salesUser = await db.user.findFirstOrThrow({
      where: { normalizedEmail: 'owner@dash.test' },
    });
    const l1 = await seedLead(client, { assignedToId: salesUser.id });
    const l2 = await seedLead(client, { assignedToId: salesUser.id });
    await setStage(l1.id, 'BOOKING_CONFIRMED');
    void l2;
    const res = await client.get('/api/dashboard/analytics');
    const staff = res.body.data.staffConversions as Array<{
      userId: string;
      totalLeads: number;
      convertedLeads: number;
      conversionRate: number;
      rank: number;
    }>;
    const row = staff.find((s) => s.userId === salesUser.id)!;
    expect(row).toMatchObject({ totalLeads: 2, convertedLeads: 1, conversionRate: 50, rank: 1 });
  });

  it('aggregates booking financials, refunds and net profit for a financial user', async () => {
    const client = await owner();
    const booking = (await client.post('/api/bookings', manualBooking())).body.data;
    await client.patch(`/api/bookings/${booking.id}/financials`, {
      gstAmount: 2500,
      tcsAmount: 500,
    });
    const res = await client.get('/api/dashboard/analytics');
    expect(res.body.data.bookings.totalBookings).toBe(1);
    expect(res.body.data.financials).toMatchObject({
      totalCustomerAmount: '50000.00',
      totalPayable: '53000.00',
    });
    expect(res.body.data.financials).toHaveProperty('netProfit');
    expect(res.body.data.financials).toHaveProperty('totalRefunded');
    expect(Array.isArray(res.body.data.staffFinancials)).toBe(true);
  });

  it('omits financial blocks entirely without booking financial permission', async () => {
    const owner1 = await owner();
    await owner1.post('/api/bookings', manualBooking());
    const sales = await roleClient('owner@dash.test', 'Sales Executive', 'sales@dash.test');
    const res = await sales.get('/api/dashboard/analytics');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('financials');
    expect(res.body.data).not.toHaveProperty('staffFinancials');
    expect(res.body.data.capabilities.canViewFinancials).toBe(false);
    // Operational booking metrics are still present.
    expect(res.body.data.bookings).toHaveProperty('totalBookings');
  });

  it('omits lead sections without query permission', async () => {
    const owner1 = await owner();
    void owner1;
    const viewer = await roleClient('owner@dash.test', 'View Only', 'viewer@dash.test');
    const res = await viewer.get('/api/dashboard/analytics');
    expect(res.status).toBe(200);
    // View Only lacks queries.view in the default template.
    if (!res.body.data.capabilities.canViewLeads) {
      expect(res.body.data).not.toHaveProperty('leads');
      expect(res.body.data).not.toHaveProperty('leadSources');
    }
  });

  it('supports a custom date range and rejects an invalid one', async () => {
    const client = await owner();
    await seedLead(client);
    const ok = await client.get(
      '/api/dashboard/analytics?period=CUSTOM&from=2026-01-01&to=2026-12-31',
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.period.key).toBe('CUSTOM');
    const missing = await client.get('/api/dashboard/analytics?period=CUSTOM');
    expect(missing.status).toBe(400);
    const reversed = await client.get(
      '/api/dashboard/analytics?period=CUSTOM&from=2026-12-31&to=2026-01-01',
    );
    expect(reversed.status).toBe(400);
  });

  it('applies the period filter to lead counts', async () => {
    const client = await owner();
    await seedLead(client);
    // A lead created "today" is inside THIS_YEAR but outside a past custom range.
    const past = await client.get(
      '/api/dashboard/analytics?period=CUSTOM&from=2020-01-01&to=2020-12-31',
    );
    expect(past.body.data.leads.totalLeads).toBe(0);
    const thisYear = await client.get('/api/dashboard/analytics?period=THIS_YEAR');
    expect(thisYear.body.data.leads.totalLeads).toBe(1);
  });

  it('isolates tenants', async () => {
    const alpha = await owner('owner@alpha-dash.test', 'Alpha Dash');
    await seedLead(alpha);
    await seedLead(alpha);
    const beta = await owner('owner@beta-dash.test', 'Beta Dash');
    const res = await beta.get('/api/dashboard/analytics');
    expect(res.body.data.leads.totalLeads).toBe(0);
  });

  it('requires the dashboard.view permission', async () => {
    const anonymous = createAuthClient(app);
    expect((await anonymous.get('/api/dashboard/analytics')).status).toBe(401);
  });
});

describe('Upcoming travel widgets', () => {
  type TravelRow = {
    id: string;
    customerName: string;
    travelDate: string;
    city: string;
    leadStage: string;
  };
  type WidgetSection = { totalCount: number; items: TravelRow[] };

  const travelOf = async (client: Client, query = 'days=30') => {
    const res = await client.get(`/api/dashboard/upcoming-travel?${query}`);
    expect(res.status).toBe(200);
    return res.body.data as {
      range: { from: string; to: string; timezone: string; days: string };
      confirmed: WidgetSection;
      others: WidgetSection;
    };
  };

  /** Travel date string safely inside the default 30-day window. */
  const soon = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  it('shows a confirmed lead with a future travel date only in Upcoming Travel', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      customerName: 'Aarav Mehta',
      travelStartDate: soon(10),
      itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const data = await travelOf(client);
    expect(data.confirmed.totalCount).toBe(1);
    expect(data.confirmed.items).toMatchObject([
      { customerName: 'Aarav Mehta', city: 'Goa', leadStage: 'BOOKING_CONFIRMED' },
    ]);
    expect(data.others.totalCount).toBe(0);
    expect(data.others.items).toEqual([]);
  });

  it('shows any other stage with a future travel date only in Other Upcoming Travel', async () => {
    const client = await owner();
    for (const stage of ['NEW_LEAD', 'QUALIFIED', 'READY_TO_BOOK', 'ON_HOLD', 'FOLLOW_UP']) {
      const lead = await seedLead(client, {
        customerName: `Traveller ${stage}`,
        travelStartDate: soon(10),
        itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
      });
      await setStage(lead.id, stage);
    }
    const data = await travelOf(client);
    expect(data.confirmed.totalCount).toBe(0);
    expect(data.others.totalCount).toBe(5);
    expect(data.others.items[0]).toMatchObject({ leadStage: expect.any(String) });
    expect(
      data.others.items.every((row) => row.leadStage !== 'BOOKING_CONFIRMED'),
    ).toBe(true);
  });

  it('moves a lead between widgets when its stage changes', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      travelStartDate: soon(10),
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    expect((await travelOf(client)).confirmed.totalCount).toBe(1);
    // Real API transition (owner is privileged): confirmed -> Lost.
    const lost = await client.patch(`/api/queries/${lead.id}/stage`, {
      stage: 'LOST',
      lostReason: 'budget cut',
    });
    expect(lost.status).toBe(200);
    const moved = await travelOf(client);
    expect(moved.confirmed.totalCount).toBe(0);
    expect(moved.others.totalCount).toBe(1);
    // And back again via the database (manual confirmation is system-guarded).
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const back = await travelOf(client);
    expect(back.confirmed.totalCount).toBe(1);
    expect(back.others.totalCount).toBe(0);
  });

  it('moves a lead to confirmed and shows it only in Upcoming Travel', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      travelStartDate: soon(10),
      itinerary: [{ country: 'India', destination: 'Kerala', nights: 2, sequence: 1 }],
    });
    expect((await travelOf(client)).others.totalCount).toBe(1);
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const data = await travelOf(client);
    expect(data.confirmed.totalCount).toBe(1);
    expect(data.others.totalCount).toBe(0);
  });

  it('excludes past travel dates and leads without travel dates', async () => {
    const client = await owner();
    const past = await seedLead(client, {
      travelStartDate: '2020-05-01',
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(past.id, 'BOOKING_CONFIRMED');
    const dateless = await seedLead(client, { travelStartDate: null });
    await setStage(dateless.id, 'BOOKING_CONFIRMED');
    const data = await travelOf(client);
    expect(data.confirmed.totalCount).toBe(0);
    expect(data.others.totalCount).toBe(0);
  });

  it('uses the first itinerary stop as the city', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      travelStartDate: soon(10),
      itinerary: [
        { country: 'India', destination: 'Goa', nights: 2, sequence: 1 },
        { country: 'UAE', destination: 'Dubai', nights: 3, sequence: 2 },
      ],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const data = await travelOf(client);
    expect(data.confirmed.items).toMatchObject([{ city: 'Goa' }]);
  });

  it('enforces date-range boundaries on the company-local window', async () => {
    const client = await owner();
    // Fix the company timezone so boundaries are deterministic.
    const company = await db.company.findFirstOrThrow({ select: { id: true } });
    await db.company.update({ where: { id: company.id }, data: { timezone: 'Asia/Kolkata' } });
    const kolkataToday = new Date(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()) + 'T00:00:00.000Z',
    );
    const day = (offset: number) =>
      new Date(kolkataToday.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const mk = (name: string, travelStartDate: string) =>
      seedLead(client, {
        customerName: name,
        travelStartDate,
        itinerary: [{ country: 'India', destination: 'Goa', nights: 1, sequence: 1 }],
      }).then(async (lead) => {
        await setStage(lead.id, 'BOOKING_CONFIRMED');
        return lead;
      });
    await mk('Today Traveller', day(0));
    await mk('Week Traveller', day(6));
    await mk('Boundary Traveller', day(7));
    await mk('Past Traveller', day(-1));
    const data = await travelOf(client, 'days=7');
    expect(data.range.days).toBe('7');
    const names = data.confirmed.items.map((row) => row.customerName);
    expect(names).toContain('Today Traveller');
    expect(names).toContain('Week Traveller');
    expect(names).not.toContain('Boundary Traveller');
    expect(names).not.toContain('Past Traveller');
    expect(data.confirmed.totalCount).toBe(2);
  });

  it('supports custom ranges and rejects invalid ones', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      travelStartDate: soon(40),
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    expect((await travelOf(client, 'days=30')).confirmed.totalCount).toBe(0);
    const from = soon(30);
    const to = soon(60);
    const custom = await travelOf(client, `from=${from}&to=${to}`);
    expect(custom.confirmed.totalCount).toBe(1);
    expect(
      (await client.get('/api/dashboard/upcoming-travel?from=2026-06-30&to=2026-06-01')).status,
    ).toBe(400);
    expect((await client.get('/api/dashboard/upcoming-travel?from=2026-06-01')).status).toBe(400);
  });

  it('limits preview rows while reporting full counts', async () => {
    const client = await owner();
    for (let index = 0; index < 3; index += 1) {
      const lead = await seedLead(client, {
        customerName: `Group Traveller ${index}`,
        phone: `+91 90000 2000${index}`,
        travelStartDate: soon(10),
        itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
      });
      await setStage(lead.id, 'BOOKING_CONFIRMED');
    }
    const data = await travelOf(client, 'days=30&limit=2');
    expect(data.confirmed.totalCount).toBe(3);
    expect(data.confirmed.items).toHaveLength(2);
  });

  it('isolates tenants and respects assignment visibility', async () => {
    const alpha = await owner('owner@alpha-travel.test', 'Alpha Travel');
    const lead = await seedLead(alpha, {
      travelStartDate: soon(10),
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const beta = await owner('owner@beta-travel.test', 'Beta Travel');
    const betaData = await travelOf(beta);
    expect(betaData.confirmed.totalCount).toBe(0);
    expect(betaData.others.totalCount).toBe(0);
    const sales = await roleClient('owner@alpha-travel.test', 'Sales Executive', 'sales@rev.test');
    expect((await travelOf(sales)).confirmed.totalCount).toBe(0);
    const salesUser = await db.user.findUniqueOrThrow({
      where: { normalizedEmail: 'sales@rev.test' },
    });
    await db.query.update({ where: { id: lead.id }, data: { assignedToId: salesUser.id } });
    expect((await travelOf(sales)).confirmed.totalCount).toBe(1);
  });

  it('requires the dashboard.view permission', async () => {
    const anonymous = createAuthClient(app);
    expect((await anonymous.get('/api/dashboard/upcoming-travel?days=30')).status).toBe(401);
  });
});
describe('Phase 16 dashboard operations', () => {
  it('returns actionable operations lists with counts and view-all paths', async () => {
    const client = await owner();
    // A near-travel lead (within 10 days) and a future booking.
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await seedLead(client, { travelStartDate: soon, leadStage: 'QUALIFIED' });
    const trip = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    // The end date must move with the start: a fixed 2026-10-10 end turns
    // this into a start-after-end 400 once today+10d passes it.
    const tripEnd = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const booking = (
      await client.post('/api/bookings', manualBooking({ travelStartDate: trip, travelEndDate: tripEnd }))
    ).body.data;
    await client.patch(`/api/bookings/${booking.id}/status`, { status: 'CONFIRMED' });

    const res = await client.get('/api/dashboard/operations');
    expect(res.status).toBe(200);
    expect(res.body.data.nearTravelDates).toMatchObject({ viewAllPath: '/queries' });
    expect(res.body.data.nearTravelDates.items.length).toBeGreaterThan(0);
    expect(res.body.data.upcomingTrips).toMatchObject({ viewAllPath: '/bookings' });
    expect(res.body.data.upcomingTrips.items[0]).toHaveProperty('daysUntilTravel');
  });

  it('returns client payments due only with financial permission and vendor payments with vendor financials', async () => {
    const client = await owner();
    const dueSoon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const booking = (
      await client.post(
        '/api/bookings',
        manualBooking({
          paymentSchedule: [
            { installmentNumber: 1, label: 'Advance', amount: 25000, dueDate: dueSoon },
          ],
        }),
      )
    ).body.data;
    void booking;
    const res = await client.get('/api/dashboard/operations');
    expect(res.body.data.clientPaymentsDue.items.length).toBeGreaterThan(0);
    expect(res.body.data.clientPaymentsDue.items[0]).toHaveProperty('amount');

    const sales = await roleClient('owner@dash.test', 'Sales Executive', 'sales2@dash.test');
    const salesRes = await sales.get('/api/dashboard/operations');
    expect(salesRes.body.data).not.toHaveProperty('clientPaymentsDue');
    expect(salesRes.body.data).not.toHaveProperty('vendorPaymentsDue');
  });

  it('orders priority follow-ups with overdue hot leads first', async () => {
    const client = await owner();
    const hot = await seedLead(client, { leadType: 'HOT' });
    // Create an overdue follow-up on the hot lead directly.
    const user = await db.user.findFirstOrThrow({ where: { normalizedEmail: 'owner@dash.test' } });
    await db.queryFollowUp.create({
      data: {
        companyId: user.companyId,
        queryId: hot.id,
        assignedToId: user.id,
        title: 'Overdue hot follow-up',
        reminderType: 'LEAD_FOLLOW_UP',
        scheduledAt: new Date(Date.now() - 2 * 86_400_000),
        status: 'PENDING',
        createdById: user.id,
      },
    });
    const res = await client.get('/api/dashboard/operations');
    const items = res.body.data.priorityFollowUps.items as Array<{
      leadType: string;
      overdue: boolean;
    }>;
    expect(items[0]).toMatchObject({ leadType: 'HOT', overdue: true });
    expect(res.body.data.priorityFollowUps.viewAllPath).toBe('/follow-ups');
  });

  it('returns an empty-state payload with no data', async () => {
    const client = await owner();
    const res = await client.get('/api/dashboard/operations');
    expect(res.body.data.upcomingTrips.items).toEqual([]);
    expect(res.body.data.upcomingTrips.totalCount).toBe(0);
    const analytics = await client.get('/api/dashboard/analytics');
    expect(analytics.body.data.leads.totalLeads).toBe(0);
    expect(analytics.body.data.leadSources).toEqual([]);
  });
});

describe('Booking confirmed amount by destination', () => {
  type RevenueRow = { destination: string; totalAmount: string };
  const revenueOf = async (client: Client, query = 'period=THIS_YEAR') => {
    const res = await client.get(`/api/dashboard/analytics?${query}`);
    expect(res.status).toBe(200);
    return res.body.data.confirmedRevenueByDestination as RevenueRow[];
  };

  it('counts only leads whose current stage is BOOKING_CONFIRMED', async () => {
    const client = await owner();
    const confirmed = await seedLead(client, {
      expectedAmount: 120000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
    });
    await setStage(confirmed.id, 'BOOKING_CONFIRMED');
    // Every other stage is excluded, even HOT leads and terminal ones.
    // (Stages are seeded directly; the PATCH-driven removal is covered below.)
    for (const stage of ['LOST', 'CANCELLED', 'NEW_LEAD', 'QUALIFIED', 'READY_TO_BOOK', 'ON_HOLD']) {
      const lead = await seedLead(client, {
        expectedAmount: 50000,
        itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
      });
      await setStage(lead.id, stage);
    }
    // HOT type alone (still NEW_LEAD) is excluded.
    await seedLead(client, {
      leadType: 'HOT',
      expectedAmount: 90000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    expect(await revenueOf(client)).toEqual([{ destination: 'Goa', totalAmount: '120000.00' }]);
  });

  it('uses the latest quotation amount when the lead has no expected amount', async () => {
    // Regression: confirmed lead whose amount lives only on its quotation
    // (exactly like the Amount column in the leads list). The lead itself
    // carries expectedAmount null — as with QRY-000005/mohan, whose
    // ₹1,00,000 comes from its latest quotation version, not the lead.
    const client = await owner();
    const lead = await seedLead(client, {
      itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 5, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    // Sanity: with no quotation and no expected amount the chart is empty.
    expect(await revenueOf(client)).toEqual([]);
    const quotation = (
      await client.post('/api/quotations', { queryId: lead.id })
    ).body.data as { id: string; versions: { id: string }[] };
    await db.quotationVersion.update({
      where: { id: quotation.versions[0]!.id },
      data: { finalAmount: 100000, netAmount: 60000 },
    });
    expect(await revenueOf(client)).toEqual([
      { destination: 'Singapore', totalAmount: '100000.00' },
    ]);
  });

  it('removes the amount after a real stage change away from confirmed', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      expectedAmount: 75000,
      itinerary: [{ country: 'UAE', destination: 'Dubai', nights: 3, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    expect(await revenueOf(client)).toEqual([{ destination: 'Dubai', totalAmount: '75000.00' }]);
    const lost = await client.patch(`/api/queries/${lead.id}/stage`, {
      stage: 'LOST',
      lostReason: 'budget cut',
    });
    expect(lost.status).toBe(200);
    expect(await revenueOf(client)).toEqual([]);
    // And symmetrically for cancellation.
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const cancelled = await client.patch(`/api/queries/${lead.id}/stage`, {
      stage: 'CANCELLED',
      reason: 'duplicate lead',
    });
    expect(cancelled.status).toBe(200);
    expect(await revenueOf(client)).toEqual([]);
  });

  it('ignores a quotation amount with no real net cost, falls back to expected', async () => {
    // Mirrors the list rule: a quotation placeholder total (net 0) is not a
    // real amount, so the chart uses the lead's expectedAmount instead.
    const client = await owner();
    const lead = await seedLead(client, {
      expectedAmount: 50000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const quotation = (
      await client.post('/api/quotations', { queryId: lead.id })
    ).body.data as { id: string; versions: { id: string }[] };
    await db.quotationVersion.update({
      where: { id: quotation.versions[0]!.id },
      data: { finalAmount: 3000, netAmount: 0 },
    });
    expect(await revenueOf(client)).toEqual([{ destination: 'Goa', totalAmount: '50000.00' }]);
  });

  it('aggregates destination totals sorted descending', async () => {
    const client = await owner();
    const first = await seedLead(client, {
      expectedAmount: 100000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
    });
    await setStage(first.id, 'BOOKING_CONFIRMED');
    const second = await seedLead(client, {
      expectedAmount: 50000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    });
    await setStage(second.id, 'BOOKING_CONFIRMED');
    const third = await seedLead(client, {
      expectedAmount: 80000,
      itinerary: [{ country: 'UAE', destination: 'Dubai', nights: 3, sequence: 1 }],
    });
    await setStage(third.id, 'BOOKING_CONFIRMED');
    expect(await revenueOf(client)).toEqual([
      { destination: 'Goa', totalAmount: '150000.00' },
      { destination: 'Dubai', totalAmount: '80000.00' },
    ]);
  });

  it('splits one lead across its itinerary without double-counting', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      expectedAmount: 100000,
      itinerary: [
        { country: 'India', destination: 'Goa', nights: 2, sequence: 1 },
        { country: 'UAE', destination: ' Dubai ', nights: 3, sequence: 2 },
      ],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const rows = await revenueOf(client);
    // Nights pro-rata: 2/5 and 3/5 of 100000; trimmed + merged.
    expect(rows).toEqual([
      { destination: 'Dubai', totalAmount: '60000.00' },
      { destination: 'Goa', totalAmount: '40000.00' },
    ]);
    const total = rows.reduce((sum, row) => sum + Number(row.totalAmount), 0);
    expect(total).toBe(100000);
  });

  it('splits equally when the itinerary carries zero nights', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      expectedAmount: 90000,
      itinerary: [
        { country: 'India', destination: 'Goa', nights: 0, sequence: 1 },
        { country: 'India', destination: 'Kerala', nights: 0, sequence: 2 },
      ],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    expect(await revenueOf(client)).toEqual([
      { destination: 'Goa', totalAmount: '45000.00' },
      { destination: 'Kerala', totalAmount: '45000.00' },
    ]);
  });

  it('merges destination casing and skips leads without amount or stops', async () => {
    const client = await owner();
    const a = await seedLead(client, {
      expectedAmount: 60000,
      itinerary: [{ country: 'India', destination: 'GOA', nights: 2, sequence: 1 }],
    });
    await setStage(a.id, 'BOOKING_CONFIRMED');
    const b = await seedLead(client, {
      expectedAmount: 40000,
      itinerary: [{ country: 'India', destination: 'goa', nights: 2, sequence: 1 }],
    });
    await setStage(b.id, 'BOOKING_CONFIRMED');
    // No amount and no itinerary: contributes nothing, breaks nothing.
    const c = await seedLead(client, { itinerary: [] });
    await setStage(c.id, 'BOOKING_CONFIRMED');
    // Unconfirmed lead with an amount: excluded.
    await seedLead(client, {
      expectedAmount: 10000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 1, sequence: 1 }],
    });
    expect(await revenueOf(client)).toEqual([{ destination: 'GOA', totalAmount: '100000.00' }]);
  });

  it('applies the dashboard date period on lead creation date', async () => {
    const client = await owner();
    const lead = await seedLead(client, {
      expectedAmount: 120000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    expect(await revenueOf(client, 'period=THIS_YEAR')).toEqual([
      { destination: 'Goa', totalAmount: '120000.00' },
    ]);
    expect(await revenueOf(client, 'period=CUSTOM&from=2020-01-01&to=2020-12-31')).toEqual([]);
  });

  it('isolates tenants and respects assignment visibility', async () => {
    const alpha = await owner('owner@alpha-rev.test', 'Alpha Revenue');
    const lead = await seedLead(alpha, {
      expectedAmount: 120000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
    });
    await setStage(lead.id, 'BOOKING_CONFIRMED');
    const beta = await owner('owner@beta-rev.test', 'Beta Revenue');
    expect(await revenueOf(beta)).toEqual([]);
    // A non-privileged user sees only leads they created or are assigned to.
    const sales = await roleClient('owner@alpha-rev.test', 'Sales Executive', 'sales@rev.test');
    expect(await revenueOf(sales)).toEqual([]);
    const salesUser = await db.user.findUniqueOrThrow({
      where: { normalizedEmail: 'sales@rev.test' },
    });
    await db.query.update({ where: { id: lead.id }, data: { assignedToId: salesUser.id } });
    expect(await revenueOf(sales)).toEqual([{ destination: 'Goa', totalAmount: '120000.00' }]);
  });

  it('returns an empty list with no qualifying leads', async () => {
    const client = await owner();
    await seedLead(client);
    expect(await revenueOf(client)).toEqual([]);
  });

  it('leaves every existing KPI and section untouched', async () => {
    const client = await owner();
    const confirmed = await seedLead(client, {
      expectedAmount: 120000,
      itinerary: [{ country: 'India', destination: 'Goa', nights: 3, sequence: 1 }],
    });
    await setStage(confirmed.id, 'BOOKING_CONFIRMED');
    const lost = await seedLead(client, { leadSource: 'WEBSITE', itinerary: [] });
    await setStage(lost.id, 'LOST');
    const res = await client.get('/api/dashboard/analytics?period=THIS_YEAR');
    expect(res.status).toBe(200);
    expect(res.body.data.leads).toMatchObject({
      totalLeads: 2,
      convertedLeads: 1,
      lostLeads: 1,
    });
    expect(res.body.data.leadSources).toEqual(
      expect.arrayContaining([expect.objectContaining({ count: 1 })]),
    );
    // Enquiry counts still count itineraries regardless of stage.
    expect(res.body.data.topDestinations).toEqual([{ destination: 'Goa', enquiryCount: 1 }]);
    expect(res.body.data.confirmedRevenueByDestination).toEqual([
      { destination: 'Goa', totalAmount: '120000.00' },
    ]);
  });
});
