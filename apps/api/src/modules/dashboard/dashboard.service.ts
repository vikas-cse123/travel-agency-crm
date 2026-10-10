import { Prisma } from '@prisma/client';
import {
  LEAD_SOURCES,
  PERMISSIONS,
  labelForLookup,
  type DashboardQuery,
  type UpcomingTravelQuery,
} from '@interscale/shared';
import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { localDayBounds } from '../../utils/timezone.js';
import { permissionsService } from '../auth/permissions.service.js';
import {
  visibility as queryVisibility,
  visibleWhere as queryVisibleWhere,
} from '../queries/queries.service.js';
import { bookingVisibleWhere } from '../bookings/bookings.service.js';
import { resolvePeriod, createdAtFilter, type ResolvedPeriod } from './dashboard.period.js';

const userSelect = { id: true, fullName: true } as const;
/** Neutral created-date filter usable across Query/Booking/Quotation wheres. */
type CreatedFilter = { createdAt?: { gte: Date; lt: Date } };
const money = (value: Prisma.Decimal | null | undefined) => value?.toFixed(2) ?? '0.00';
const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
// groupBy _count is typed as a union; read _all safely.
const countAll = (value: unknown): number =>
  value && typeof value === 'object' && '_all' in value
    ? Number((value as { _all: number })._all)
    : 0;

const has = (auth: AuthContext, permission: string) =>
  permissionsService.userHasPermission(auth.userId, permission);

/** Which dashboard sections the caller is authorised to see. */
async function resolveCapabilities(auth: AuthContext) {
  const [
    canViewLeads,
    canViewQuotations,
    canViewBookings,
    canViewFinancials,
    canViewVendors,
    canViewVendorFinancials,
    canViewFollowUps,
  ] = await Promise.all([
    has(auth, PERMISSIONS.QUERIES_VIEW),
    has(auth, PERMISSIONS.QUOTATIONS_VIEW),
    has(auth, PERMISSIONS.BOOKINGS_VIEW),
    has(auth, PERMISSIONS.BOOKINGS_VIEW_FINANCIALS),
    has(auth, PERMISSIONS.VENDORS_VIEW),
    has(auth, PERMISSIONS.VENDORS_VIEW_FINANCIALS),
    has(auth, PERMISSIONS.FOLLOWUPS_VIEW),
  ]);
  return {
    canViewLeads,
    canViewQuotations,
    canViewBookings,
    canViewFinancials,
    canViewVendors,
    canViewVendorFinancials,
    canViewFollowUps,
  };
}

async function companyTimezone(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  return company.timezone;
}

/**
 * Follow-up visibility mirrors the follow-ups module: privileged roles see all,
 * everyone else sees follow-ups assigned to them or attached to a visible lead.
 * Derived from the exported query visibility so the two stay in lockstep.
 */
async function followUpVisibility(auth: AuthContext): Promise<Prisma.QueryFollowUpWhereInput> {
  const queryVis = await queryVisibility(auth);
  const privileged = Object.keys(queryVis).length === 0;
  if (privileged) return {};
  return {
    OR: [
      { assignedToId: auth.userId },
      { query: { is: { companyId: auth.companyId, ...queryVis } } },
    ],
  };
}

/** Map a name lookup for a set of user ids in one query. */
async function nameMap(companyId: string, ids: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, companyId },
    select: userSelect,
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export const dashboardService = {
  async analytics(auth: AuthContext, input: DashboardQuery) {
    const timezone = await companyTimezone(auth.companyId);
    const period = resolvePeriod(input.period, timezone, input.from, input.to);
    const caps = await resolveCapabilities(auth);
    const dateFilter = createdAtFilter(period);
    const limit = input.limit ?? 5;

    const result: Record<string, unknown> = {
      period: {
        key: period.key,
        from: period.from?.toISOString() ?? null,
        to: period.to?.toISOString() ?? null,
        timezone,
      },
      capabilities: caps,
    };

    if (caps.canViewLeads) {
      result.leads = await this.leadMetrics(auth, dateFilter);
      result.leadSources = await this.leadSources(auth, dateFilter);
      result.topDestinations = await this.topDestinations(auth, period, input.limit ?? 10);
      result.confirmedRevenueByDestination = await this.confirmedRevenueByDestination(
        auth,
        period,
        input.limit ?? 10,
      );
      result.staffConversions = await this.staffConversions(auth, dateFilter, limit);
    }
    if (caps.canViewQuotations) {
      result.quotations = await this.quotationMetrics(auth, dateFilter);
    }
    if (caps.canViewBookings) {
      const bookings = await this.bookingMetrics(auth, dateFilter, caps.canViewFinancials);
      result.bookings = bookings.operational;
      if (caps.canViewFinancials) {
        result.financials = bookings.financial;
        result.staffFinancials = await this.staffFinancials(auth, dateFilter, limit);
      }
    }
    return result;
  },

  /**
   * Upcoming travel widgets: every lead with a future planned travel date,
   * split by current stage. Widget one holds only leads whose CURRENT
   * persisted stage is BOOKING_CONFIRMED; widget two holds every other
   * stage. Eligibility never consults stage history, vouchers, payments or
   * bookings — only the live lead row.
   *
   * There is intentionally no date-range window or row limit: both widgets
   * cover all future travel (past dates excluded). Legacy `days`/`from`/`to`
   * /`limit` query params are accepted but ignored.
   *
   * Travel date is the authoritative `Query.travelStartDate` (a calendar
   * date, like the operations widgets use); the destination is the first
   * itinerary stop by sequence, mirroring quotation title generation. Leads
   * without a travel date are excluded from both widgets.
   */
  async upcomingTravel(auth: AuthContext, _input: UpcomingTravelQuery) {
    const timezone = await companyTimezone(auth.companyId);
    const canViewLeads = await has(auth, PERMISSIONS.QUERIES_VIEW);
    // Lower calendar-date bound in the company timezone. `travelStartDate`
    // is a `@db.Date` column, so comparing it against a local-midnight
    // instant would let Postgres truncate the bound to a UTC date and shift
    // it by the UTC offset. A UTC-midnight calendar boundary keeps the
    // cutoff exact regardless of timezone — the same convention the leads
    // list uses for its TRAVEL_DATE filter.
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const parts = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
    const from = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
    const empty = {
      confirmed: { totalCount: 0, items: [] as never[] },
      others: { totalCount: 0, items: [] as never[] },
    };
    // Like the operations endpoint, lead content is withheld without the lead
    // capability instead of failing the whole request.
    if (!canViewLeads) return empty;
    const base = await queryVisibleWhere(auth, {
      travelStartDate: { gte: from },
    });
    const select = {
      id: true,
      customerName: true,
      travelStartDate: true,
      leadStage: true,
      itinerary: { select: { destination: true }, orderBy: { sequence: 'asc' as const }, take: 1 },
    } as const;
    const orderBy = { travelStartDate: 'asc' as const };
    const [confirmedRows, otherRows] = await prisma.$transaction([
      prisma.query.findMany({
        where: { ...base, leadStage: 'BOOKING_CONFIRMED' },
        select,
        orderBy,
      }),
      prisma.query.findMany({
        where: { ...base, leadStage: { not: 'BOOKING_CONFIRMED' } },
        select,
        orderBy,
      }),
    ]);
    const present = (row: (typeof confirmedRows)[number]) => ({
      id: row.id,
      customerName: row.customerName,
      travelDate: (row.travelStartDate as Date).toISOString(),
      destination: row.itinerary[0]?.destination.trim() || '—',
      leadStage: row.leadStage,
    });
    return {
      confirmed: { totalCount: confirmedRows.length, items: confirmedRows.map(present) },
      others: { totalCount: otherRows.length, items: otherRows.map(present) },
    };
  },

  async leadMetrics(auth: AuthContext, dateFilter: CreatedFilter) {
    const where = await queryVisibleWhere(auth, dateFilter);
    const [total, converted, lost, qualified, hot, quotationRequired, readyToBook] =
      await prisma.$transaction([
        prisma.query.count({ where }),
        prisma.query.count({ where: { ...where, leadStage: 'BOOKING_CONFIRMED' } }),
        prisma.query.count({ where: { ...where, leadStage: 'LOST' } }),
        prisma.query.count({ where: { ...where, leadStage: 'QUALIFIED' } }),
        prisma.query.count({ where: { ...where, leadType: 'HOT' } }),
        prisma.query.count({ where: { ...where, quotationRequired: true } }),
        prisma.query.count({ where: { ...where, leadStage: 'READY_TO_BOOK' } }),
      ]);
    return {
      totalLeads: total,
      convertedLeads: converted,
      lostLeads: lost,
      qualifiedLeads: qualified,
      hotLeads: hot,
      quotationRequired,
      readyToBook,
      conversionRate: percent(converted, total),
      winRate: percent(converted, converted + lost),
    };
  },

  async leadSources(auth: AuthContext, dateFilter: CreatedFilter) {
    const where = await queryVisibleWhere(auth, dateFilter);
    const grouped = await prisma.query.groupBy({
      by: ['leadSource'],
      where,
      _count: { _all: true },
      orderBy: { leadSource: 'asc' },
    });
    const total = grouped.reduce((sum, row) => sum + countAll(row._count), 0);
    // Preserve the canonical enum ordering, drop zero-count sources.
    return LEAD_SOURCES.map((source) => {
      const row = grouped.find((entry) => entry.leadSource === source);
      const count = countAll(row?._count);
      return { source, label: labelForLookup(source), count, percentage: percent(count, total) };
    })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count);
  },

  async topDestinations(auth: AuthContext, period: ResolvedPeriod, limit: number) {
    const bounded = Math.min(Math.max(limit, 1), 25);
    // Scope itineraries through their parent query's visibility and the period.
    const queryWhere = await queryVisibleWhere(
      auth,
      period.from && period.to ? { createdAt: { gte: period.from, lt: period.to } } : {},
    );
    const grouped = await prisma.queryItinerary.groupBy({
      by: ['destination'],
      where: { companyId: auth.companyId, query: { is: queryWhere } },
      _count: { _all: true },
      orderBy: { destination: 'asc' },
    });
    // Case-insensitive merge of free-text destinations; ignore blanks.
    const merged = new Map<string, { destination: string; enquiryCount: number }>();
    for (const row of grouped) {
      const trimmed = row.destination.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      const existing = merged.get(key);
      if (existing) existing.enquiryCount += countAll(row._count);
      else merged.set(key, { destination: trimmed, enquiryCount: countAll(row._count) });
    }
    return [...merged.values()].sort((a, b) => b.enquiryCount - a.enquiryCount).slice(0, bounded);
  },

  /**
   * Confirmed revenue by destination: the trip amount of every lead whose
   * CURRENT stage is BOOKING_CONFIRMED, attributed across its itinerary stops.
   *
   * Amount rule (mirrors the Leads list Amount column exactly): the latest
   * quotation's latest version `finalAmount` whenever positive — independent
   * of the recorded net cost, since a quotation can carry a selling price
   * with zero recorded cost — otherwise the lead's `expectedAmount`. Leads
   * with no positive amount from either source contribute nothing.
   * Attribution rule (the schema stores no per-stop amounts): each lead's
   * amount is split across its non-blank destinations pro-rata by nights, or
   * equally when the itinerary has zero total nights — so a lead's amount is
   * never counted twice. Destinations merge case-insensitively keeping the
   * first-seen display form, mirroring topDestinations.
   */
  async confirmedRevenueByDestination(auth: AuthContext, period: ResolvedPeriod, limit: number) {
    const bounded = Math.min(Math.max(limit, 1), 25);
    // Same scoping as topDestinations: parent query visibility + period on
    // Query.createdAt. Eligibility reads the CURRENT persisted stage only —
    // no history, no booking join. (BOOKING_CONFIRMED is a system stage set
    // together with booking creation, so confirmed leads carry bookings, but
    // the chart deliberately does not join them.)
    const queryWhere = await queryVisibleWhere(
      auth,
      period.from && period.to ? { createdAt: { gte: period.from, lt: period.to } } : {},
    );
    const leads = await prisma.query.findMany({
      where: { ...queryWhere, leadStage: 'BOOKING_CONFIRMED' },
      select: {
        expectedAmount: true,
        itinerary: { select: { destination: true, nights: true }, orderBy: { sequence: 'asc' } },
        quotations: {
          select: {
            versions: {
              select: { finalAmount: true },
              orderBy: { versionNumber: 'desc' },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    const merged = new Map<string, { destination: string; total: Prisma.Decimal }>();
    for (const lead of leads) {
      // Latest quotation's latest version, exactly like quotationSummary.
      const latest = lead.quotations[0]?.versions[0];
      const quoted =
        latest && Number(latest.finalAmount) > 0 ? new Prisma.Decimal(latest.finalAmount) : null;
      const expected =
        lead.expectedAmount !== null && Number(lead.expectedAmount) > 0
          ? new Prisma.Decimal(lead.expectedAmount)
          : null;
      const amount = quoted ?? expected;
      if (amount === null) continue;
      const stops = (lead.itinerary ?? [])
        .map((row) => ({ destination: row.destination.trim(), nights: row.nights }))
        .filter((row) => row.destination.length > 0);
      if (stops.length === 0) continue;
      const totalNights = stops.reduce((sum, row) => sum + row.nights, 0);
      for (const row of stops) {
        const share =
          totalNights > 0
            ? amount.times(row.nights).dividedBy(totalNights)
            : amount.dividedBy(stops.length);
        const key = row.destination.toLowerCase();
        const existing = merged.get(key);
        if (existing) existing.total = existing.total.plus(share);
        else merged.set(key, { destination: row.destination, total: share });
      }
    }
    return [...merged.values()]
      .map((row) => ({
        destination: row.destination,
        totalAmount: row.total.toDecimalPlaces(2).toFixed(2),
      }))
      .sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount))
      .slice(0, bounded);
  },

  async staffConversions(auth: AuthContext, dateFilter: CreatedFilter, limit: number) {
    const bounded = Math.min(Math.max(limit, 1), 20);
    const where = await queryVisibleWhere(auth, { ...dateFilter, assignedToId: { not: null } });
    const [totals, converted, lost] = await prisma.$transaction([
      prisma.query.groupBy({
        by: ['assignedToId'],
        where,
        _count: { _all: true },
        orderBy: { assignedToId: 'asc' },
      }),
      prisma.query.groupBy({
        by: ['assignedToId'],
        where: { ...where, leadStage: 'BOOKING_CONFIRMED' },
        _count: { _all: true },
        orderBy: { assignedToId: 'asc' },
      }),
      prisma.query.groupBy({
        by: ['assignedToId'],
        where: { ...where, leadStage: 'LOST' },
        _count: { _all: true },
        orderBy: { assignedToId: 'asc' },
      }),
    ]);
    const convertedBy = new Map(converted.map((row) => [row.assignedToId, countAll(row._count)]));
    const lostBy = new Map(lost.map((row) => [row.assignedToId, countAll(row._count)]));
    const ids = totals.map((row) => row.assignedToId).filter((id): id is string => Boolean(id));
    const names = await nameMap(auth.companyId, ids);
    return totals
      .filter((row) => row.assignedToId)
      .map((row) => {
        const userId = row.assignedToId!;
        const totalLeads = countAll(row._count);
        const convertedLeads = convertedBy.get(userId) ?? 0;
        const lostLeads = lostBy.get(userId) ?? 0;
        return {
          userId,
          displayName: names.get(userId) ?? 'Unknown',
          totalLeads,
          convertedLeads,
          lostLeads,
          conversionRate: percent(convertedLeads, totalLeads),
        };
      })
      .sort(
        (a, b) =>
          b.conversionRate - a.conversionRate ||
          b.convertedLeads - a.convertedLeads ||
          b.totalLeads - a.totalLeads,
      )
      .slice(0, bounded)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  },

  async quotationMetrics(auth: AuthContext, dateFilter: CreatedFilter) {
    const where: Prisma.QuotationWhereInput = {
      companyId: auth.companyId,
      deletedAt: null,
      query: {
        is: { companyId: auth.companyId, ...(await queryVisibility(auth)) },
      },
      ...dateFilter,
    };
    const grouped = await prisma.quotation.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });
    const byStatus = Object.fromEntries(grouped.map((row) => [row.status, countAll(row._count)]));
    const total = grouped.reduce((sum, row) => sum + countAll(row._count), 0);
    const accepted = byStatus.ACCEPTED ?? 0;
    const rejected = byStatus.REJECTED ?? 0;
    // Quoted value = sum of each visible quotation's current-version finalAmount.
    const currentVersions = await prisma.quotation.findMany({
      where: { ...where, currentVersionId: { not: null } },
      select: { currentVersionId: true },
    });
    const versionIds = currentVersions
      .map((row) => row.currentVersionId)
      .filter((id): id is string => Boolean(id));
    const valueAgg = versionIds.length
      ? await prisma.quotationVersion.aggregate({
          where: { id: { in: versionIds } },
          _sum: { finalAmount: true },
        })
      : { _sum: { finalAmount: null } };
    return {
      totalQuotations: total,
      acceptedQuotations: accepted,
      rejectedQuotations: rejected,
      totalQuotedValue: money(valueAgg._sum.finalAmount),
      quotationAcceptanceRate: percent(accepted, accepted + rejected),
    };
  },

  async bookingMetrics(auth: AuthContext, dateFilter: CreatedFilter, withFinancials: boolean) {
    const where = await bookingVisibleWhere(auth, dateFilter);
    const [total, statuses, financial] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.groupBy({
        by: ['bookingStatus'],
        where,
        _count: { _all: true },
        orderBy: { bookingStatus: 'asc' },
      }),
      withFinancials
        ? prisma.booking.aggregate({
            where,
            _sum: {
              totalSellingAmount: true,
              totalPayable: true,
              totalCustomerPaid: true,
              totalCustomerOutstanding: true,
              totalRefunded: true,
              netRevenue: true,
              totalCost: true,
              totalVendorOutstanding: true,
              grossProfit: true,
              netProfit: true,
            },
          })
        : Promise.resolve(null),
    ]);
    const byStatus = Object.fromEntries(
      statuses.map((row) => [row.bookingStatus, countAll(row._count)]),
    );
    const operational = {
      totalBookings: total,
      confirmedBookings: (byStatus.CONFIRMED ?? 0) + (byStatus.PARTIALLY_CONFIRMED ?? 0),
      pendingConfirmation: byStatus.PENDING_CONFIRMATION ?? 0,
      travelInProgress: byStatus.TRAVEL_IN_PROGRESS ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
    };
    if (!financial) return { operational, financial: null };
    // profitMarginPercentage recomputed from aggregates against total payable,
    // matching the per-booking convention; never recomputes booking rollups.
    const payable = financial._sum.totalPayable ?? new Prisma.Decimal(0);
    const gross = financial._sum.grossProfit ?? new Prisma.Decimal(0);
    return {
      operational,
      financial: {
        totalCustomerAmount: money(financial._sum.totalSellingAmount),
        totalPayable: money(financial._sum.totalPayable),
        customerPaymentsReceived: money(financial._sum.totalCustomerPaid),
        customerOutstanding: money(financial._sum.totalCustomerOutstanding),
        totalRefunded: money(financial._sum.totalRefunded),
        netRevenue: money(financial._sum.netRevenue),
        totalCost: money(financial._sum.totalCost),
        totalVendorOutstanding: money(financial._sum.totalVendorOutstanding),
        grossProfit: money(financial._sum.grossProfit),
        netProfit: money(financial._sum.netProfit),
        profitMarginPercentage: payable.isZero()
          ? '0.0000'
          : gross.dividedBy(payable).times(100).toFixed(4),
      },
    };
  },

  /**
   * Staff financial performance. The responsible salesperson is the booking's
   * `bookedById` — the user who created/owns the booking — because commission
   * and profit attribution follow the booking's originator, not a later
   * operational assignee (which can rotate). Financial-gated.
   */
  async staffFinancials(auth: AuthContext, dateFilter: CreatedFilter, limit: number) {
    const bounded = Math.min(Math.max(limit, 1), 20);
    const where = await bookingVisibleWhere(auth, dateFilter);
    const grouped = await prisma.booking.groupBy({
      by: ['bookedById'],
      where,
      _count: { _all: true },
      orderBy: { bookedById: 'asc' },
      _sum: {
        totalSellingAmount: true,
        netRevenue: true,
        totalPayable: true,
        grossProfit: true,
        netProfit: true,
      },
    });
    const names = await nameMap(
      auth.companyId,
      grouped.map((row) => row.bookedById),
    );
    return grouped
      .map((row) => {
        const payable = row._sum.totalPayable ?? new Prisma.Decimal(0);
        const gross = row._sum.grossProfit ?? new Prisma.Decimal(0);
        return {
          userId: row.bookedById,
          displayName: names.get(row.bookedById) ?? 'Unknown',
          bookingCount: countAll(row._count),
          revenue: money(row._sum.totalSellingAmount),
          netRevenue: money(row._sum.netRevenue),
          grossProfit: money(row._sum.grossProfit),
          netProfit: money(row._sum.netProfit),
          marginPercentage: payable.isZero()
            ? '0.0000'
            : gross.dividedBy(payable).times(100).toFixed(4),
          _netProfit: Number(row._sum.netProfit ?? 0),
        };
      })
      .sort((a, b) => b._netProfit - a._netProfit)
      .slice(0, bounded)
      .map(({ _netProfit, ...row }, index) => {
        void _netProfit;
        return { ...row, rank: index + 1 };
      });
  },

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  async operations(auth: AuthContext, input: DashboardQuery) {
    const timezone = await companyTimezone(auth.companyId);
    const { start, end } = localDayBounds(timezone);
    const caps = await resolveCapabilities(auth);
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 25);
    const result: Record<string, unknown> = { capabilities: caps };

    if (caps.canViewFollowUps)
      result.priorityFollowUps = await this.priorityFollowUps(auth, start, end, limit);
    if (caps.canViewLeads) result.nearTravelDates = await this.nearTravelDates(auth, start, limit);
    if (caps.canViewBookings) {
      result.upcomingTrips = await this.upcomingTrips(auth, start, limit);
      result.pendingCompletion = await this.pendingCompletion(auth, start, limit);
    }
    if (caps.canViewBookings && caps.canViewFinancials)
      result.clientPaymentsDue = await this.clientPaymentsDue(auth, start, limit);
    if (caps.canViewVendors && caps.canViewVendorFinancials)
      result.vendorPaymentsDue = await this.vendorPaymentsDue(auth, start, limit);
    return result;
  },

  async priorityFollowUps(auth: AuthContext, dayStart: Date, dayEnd: Date, limit: number) {
    const canPhone = await has(auth, PERMISSIONS.QUERIES_VIEW);
    const base: Prisma.QueryFollowUpWhereInput = {
      companyId: auth.companyId,
      deletedAt: null,
      status: 'PENDING',
      query: { isNot: null },
      ...(await followUpVisibility(auth)),
    };
    const totalCount = await prisma.queryFollowUp.count({ where: base });
    const rows = await prisma.queryFollowUp.findMany({
      where: base,
      orderBy: { scheduledAt: 'asc' },
      take: 200,
      include: {
        assignedTo: { select: userSelect },
        query: {
          select: {
            id: true,
            queryNumber: true,
            customerName: true,
            phone: true,
            leadType: true,
            leadStage: true,
          },
        },
      },
    });
    // Priority order: overdue HOT, other overdue, due today, nearest upcoming.
    const bucket = (row: (typeof rows)[number]) => {
      const overdue = row.scheduledAt < dayStart;
      const dueToday = row.scheduledAt >= dayStart && row.scheduledAt < dayEnd;
      if (overdue && row.query?.leadType === 'HOT') return 0;
      if (overdue) return 1;
      if (dueToday) return 2;
      return 3;
    };
    const ordered = rows
      .map((row) => ({ row, b: bucket(row) }))
      .sort((a, b) => a.b - b.b || a.row.scheduledAt.getTime() - b.row.scheduledAt.getTime())
      .slice(0, limit)
      .map(({ row }) => ({
        followUpId: row.id,
        queryId: row.queryId,
        queryNumber: row.query?.queryNumber ?? null,
        customerName: row.query?.customerName ?? null,
        customerPhone: canPhone ? (row.query?.phone ?? null) : null,
        assignedTo: row.assignedTo?.fullName ?? null,
        dueAt: row.scheduledAt.toISOString(),
        overdue: row.scheduledAt < dayStart,
        leadType: row.query?.leadType ?? null,
        leadStage: row.query?.leadStage ?? null,
      }));
    return { totalCount, items: ordered, viewAllPath: '/follow-ups' };
  },

  async nearTravelDates(auth: AuthContext, dayStart: Date, limit: number) {
    const windowEnd = new Date(dayStart.getTime() + 10 * 86_400_000);
    const where = await queryVisibleWhere(auth, {
      leadStage: { notIn: ['LOST', 'CANCELLED', 'INVALID'] },
      travelStartDate: { gte: dayStart, lte: windowEnd },
    });
    const [totalCount, rows] = await Promise.all([
      prisma.query.count({ where }),
      prisma.query.findMany({
        where,
        orderBy: { travelStartDate: 'asc' },
        take: limit,
        select: {
          id: true,
          queryNumber: true,
          customerName: true,
          phone: true,
          travelStartDate: true,
          leadStage: true,
          assignedTo: { select: userSelect },
          itinerary: { select: { destination: true }, orderBy: { sequence: 'asc' }, take: 3 },
        },
      }),
    ]);
    const items = rows.map((row) => ({
      queryId: row.id,
      queryNumber: row.queryNumber,
      customerName: row.customerName,
      customerPhone: row.phone,
      travelDate: row.travelStartDate?.toISOString() ?? null,
      daysUntilTravel: row.travelStartDate
        ? Math.max(0, Math.ceil((row.travelStartDate.getTime() - dayStart.getTime()) / 86_400_000))
        : null,
      leadStage: row.leadStage,
      assignedTo: row.assignedTo?.fullName ?? null,
      destinationSummary: row.itinerary.map((entry) => entry.destination).join(', ') || null,
    }));
    return { totalCount, items, viewAllPath: '/queries' };
  },

  async upcomingTrips(auth: AuthContext, dayStart: Date, limit: number) {
    const windowEnd = new Date(dayStart.getTime() + 25 * 86_400_000);
    const where = await bookingVisibleWhere(auth, {
      bookingStatus: { in: ['CONFIRMED', 'PARTIALLY_CONFIRMED'] },
      travelStartDate: { gte: dayStart, lte: windowEnd },
    });
    const [totalCount, rows] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { travelStartDate: 'asc' },
        take: limit,
        select: {
          id: true,
          bookingNumber: true,
          customerName: true,
          destinationSummary: true,
          travelStartDate: true,
          travelEndDate: true,
          bookingStatus: true,
          operationalStatus: true,
          adults: true,
          childrenWithBed: true,
          childrenWithoutBed: true,
          infants: true,
          assignedTo: { select: userSelect },
        },
      }),
    ]);
    const items = rows.map((row) => ({
      bookingId: row.id,
      bookingNumber: row.bookingNumber,
      customerName: row.customerName,
      destinationSummary: row.destinationSummary,
      travelStartDate: row.travelStartDate?.toISOString() ?? null,
      travelEndDate: row.travelEndDate?.toISOString() ?? null,
      daysUntilTravel: row.travelStartDate
        ? Math.max(0, Math.ceil((row.travelStartDate.getTime() - dayStart.getTime()) / 86_400_000))
        : null,
      travellerCount: row.adults + row.childrenWithBed + row.childrenWithoutBed + row.infants,
      bookingStatus: row.bookingStatus,
      operationalStatus: row.operationalStatus,
      assignedTo: row.assignedTo?.fullName ?? null,
    }));
    return { totalCount, items, viewAllPath: '/bookings' };
  },

  async pendingCompletion(auth: AuthContext, dayStart: Date, limit: number) {
    const where = await bookingVisibleWhere(auth, {
      OR: [
        { bookingStatus: 'TRAVEL_IN_PROGRESS' },
        {
          bookingStatus: { in: ['CONFIRMED', 'PARTIALLY_CONFIRMED'] },
          travelEndDate: { lt: dayStart },
        },
      ],
    });
    const [totalCount, rows] = await Promise.all([
      prisma.booking.count({ where }),
      prisma.booking.findMany({
        where,
        orderBy: { travelEndDate: 'asc' },
        take: limit,
        select: {
          id: true,
          bookingNumber: true,
          customerName: true,
          destinationSummary: true,
          travelEndDate: true,
          operationalStatus: true,
          assignedTo: { select: userSelect },
        },
      }),
    ]);
    const items = rows.map((row) => ({
      bookingId: row.id,
      bookingNumber: row.bookingNumber,
      customerName: row.customerName,
      destinationSummary: row.destinationSummary,
      travelEndDate: row.travelEndDate?.toISOString() ?? null,
      daysOverdue: row.travelEndDate
        ? Math.max(0, Math.floor((dayStart.getTime() - row.travelEndDate.getTime()) / 86_400_000))
        : null,
      operationalStatus: row.operationalStatus,
      assignedTo: row.assignedTo?.fullName ?? null,
    }));
    return { totalCount, items, viewAllPath: '/bookings' };
  },

  async clientPaymentsDue(auth: AuthContext, dayStart: Date, limit: number) {
    const windowEnd = new Date(dayStart.getTime() + 25 * 86_400_000);
    const bookingWhere = await bookingVisibleWhere(auth);
    const where: Prisma.BookingPaymentScheduleWhereInput = {
      companyId: auth.companyId,
      deletedAt: null,
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      dueDate: { lte: windowEnd },
      booking: { is: bookingWhere },
    };
    const [totalCount, rows] = await Promise.all([
      prisma.bookingPaymentSchedule.count({ where }),
      prisma.bookingPaymentSchedule.findMany({
        where,
        orderBy: { dueDate: 'asc' },
        take: limit,
        select: {
          id: true,
          installmentNumber: true,
          label: true,
          amount: true,
          dueDate: true,
          status: true,
          booking: {
            select: {
              id: true,
              bookingNumber: true,
              customerName: true,
              assignedTo: { select: userSelect },
            },
          },
        },
      }),
    ]);
    const items = rows.map((row) => ({
      scheduleId: row.id,
      bookingId: row.booking.id,
      bookingNumber: row.booking.bookingNumber,
      customerName: row.booking.customerName,
      installmentNumber: row.installmentNumber,
      label: row.label,
      dueDate: row.dueDate.toISOString(),
      amount: money(row.amount),
      status: row.status,
      overdue: row.dueDate < dayStart,
      assignedTo: row.booking.assignedTo?.fullName ?? null,
    }));
    return { totalCount, items, viewAllPath: '/bookings' };
  },

  async vendorPaymentsDue(auth: AuthContext, dayStart: Date, limit: number) {
    const windowEnd = new Date(dayStart.getTime() + 25 * 86_400_000);
    const where: Prisma.VendorPayableWhereInput = {
      companyId: auth.companyId,
      deletedAt: null,
      paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'] },
      OR: [{ dueDate: { lte: windowEnd } }, { dueDate: null }],
    };
    const [totalCount, rows] = await Promise.all([
      prisma.vendorPayable.count({ where }),
      prisma.vendorPayable.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }],
        take: limit,
        select: {
          id: true,
          payableNumber: true,
          originalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          dueDate: true,
          paymentStatus: true,
          supplierInvoiceNumber: true,
          vendor: { select: { id: true, name: true } },
          booking: { select: { id: true, bookingNumber: true } },
        },
      }),
    ]);
    const items = rows.map((row) => ({
      payableId: row.id,
      payableNumber: row.payableNumber,
      vendorId: row.vendor.id,
      vendorName: row.vendor.name,
      bookingId: row.booking.id,
      bookingNumber: row.booking.bookingNumber,
      dueDate: row.dueDate?.toISOString() ?? null,
      originalAmount: money(row.originalAmount),
      paidAmount: money(row.paidAmount),
      outstandingAmount: money(row.outstandingAmount),
      status: row.paymentStatus,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
      overdue: row.dueDate ? row.dueDate < dayStart : false,
    }));
    return { totalCount, items, viewAllPath: '/vendors' };
  },
};
