import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  labelForLookup,
  type LeadPaymentCaseInput,
  type PaymentCaseInput,
  type PaymentInput,
  type PaymentUpdateInput,
} from '@interscale/shared';
import { prisma } from '../../config/prisma.js';
import type { AuthContext } from '../../middleware/authenticate.js';
import { env } from '../../config/env.js';
import { permissionsService } from '../auth/permissions.service.js';
import { paymentVoucherObjectKey, storageService } from '../../services/storage/storage.service.js';
import { loadCompanyBranding } from '../../services/pdf/company-branding.js';
import { renderPaymentVoucherPdf } from './payment-voucher-pdf.service.js';
import { nextPaymentNumber } from './payments.utils.js';
import { localDayBounds, zonedTimeToUtc } from '../../utils/timezone.js';
import {
  buildPaginationMeta,
  resolvePagination,
  toPrismaPagination,
} from '../../utils/pagination.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors.js';

export type PaymentsRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const userSelect = { id: true, fullName: true } as const;

const hasPermission = (auth: AuthContext, permission: string) =>
  permissionsService.userHasPermission(auth.userId, permission);

async function financialAccess(auth: AuthContext) {
  return hasPermission(auth, PERMISSIONS.PAYMENTS_VIEW);
}

/** Payment rows that count as collected money. Reversed/failed rows never count. */
const COLLECTED_STATUSES = ['RECEIVED', 'CLEARED'] as const;

function assertCollectible(payment: { reversedAt: Date | null; paymentStatus: string }) {
  if (
    payment.reversedAt ||
    payment.paymentStatus === 'REVERSED' ||
    !(COLLECTED_STATUSES as readonly string[]).includes(payment.paymentStatus)
  )
    throw new ConflictError('A voucher can only be generated for a received or cleared payment.');
}

const decimal = (value: Prisma.Decimal | null | undefined) => value?.toFixed(2) ?? null;

function formatReceiptDate(value: Date) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(value);
}

const caseInclude = {
  customer: { select: { id: true, customerNumber: true, displayName: true } },
  query: { select: { id: true, queryNumber: true, customerName: true } },
  createdBy: { select: userSelect },
} as const;

type CaseRow = Prisma.PaymentCaseGetPayload<{ include: typeof caseInclude }> & {
  payments: Array<{ amount: Prisma.Decimal; paymentStatus: string; reversedAt: Date | null }>;
};

function caseTotals(row: {
  tripAmount: Prisma.Decimal;
  payments: Array<{ amount: Prisma.Decimal; paymentStatus: string; reversedAt: Date | null }>;
}) {
  const collected = row.payments
    .filter(
      (payment) =>
        payment.reversedAt === null &&
        (COLLECTED_STATUSES as readonly string[]).includes(payment.paymentStatus),
    )
    .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
  const tripAmount = new Prisma.Decimal(row.tripAmount);
  const outstanding = Prisma.Decimal.max(0, tripAmount.minus(collected));
  const count = row.payments.filter((payment) => payment.reversedAt === null).length;
  return {
    collected,
    outstanding,
    paymentCount: count,
    status:
      outstanding.isZero() && count > 0 ? 'PAID' : collected.isZero() ? 'UNPAID' : 'PARTIALLY_PAID',
  };
}

function presentCase(row: CaseRow) {
  const { companyId: _companyId, payments: _payments, ...safe } = row;
  void _companyId;
  void _payments;
  const totals = caseTotals(row);
  return {
    ...safe,
    tripAmount: decimal(row.tripAmount),
    collected: totals.collected.toFixed(2),
    outstanding: totals.outstanding.toFixed(2),
    paymentCount: totals.paymentCount,
    status: totals.status,
  };
}

const paymentInclude = {
  recordedBy: { select: userSelect },
  reversedBy: { select: userSelect },
  receipt: { select: { id: true, receiptNumber: true, uploadStatus: true } },
  paymentCase: {
    select: {
      id: true,
      customerId: true,
      queryId: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      title: true,
      tripAmount: true,
      currency: true,
    },
  },
} as const;

type LedgerRow = Prisma.CustomerPaymentGetPayload<{ include: typeof paymentInclude }>;

function presentLedgerRow(row: LedgerRow) {
  const { companyId: _companyId, caseId: _caseId, ...safe } = row;
  void _companyId;
  void _caseId;
  return { ...safe, amount: decimal(row.amount) };
}

function presentPaymentReceipt(receipt: Record<string, unknown>) {
  const {
    companyId: _companyId,
    paymentId: _paymentId,
    objectKey: _objectKey,
    bucket: _bucket,
    storageProvider: _storageProvider,
    checksum: _checksum,
    uploadedById: _uploadedById,
    ...safe
  } = receipt;
  void _companyId;
  void _paymentId;
  void _objectKey;
  void _bucket;
  void _storageProvider;
  void _checksum;
  void _uploadedById;
  return safe;
}

async function getCase(auth: AuthContext, caseId: string) {
  const row = await prisma.paymentCase.findFirst({
    where: { id: caseId, companyId: auth.companyId },
    include: { ...caseInclude, payments: true },
  });
  if (!row) throw new NotFoundError('Payment trip not found.');
  return row;
}

async function validateCaseRefs(
  auth: AuthContext,
  input: { customerId?: string | null | undefined; queryId?: string | null | undefined },
) {
  if (input.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, companyId: auth.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new ValidationError('Selected customer was not found.');
  }
  if (input.queryId) {
    const query = await prisma.query.findFirst({
      where: { id: input.queryId, companyId: auth.companyId },
      select: { id: true },
    });
    if (!query) throw new ValidationError('Selected lead was not found.');
  }
}

async function getPayment(auth: AuthContext, paymentId: string) {
  const payment = await prisma.customerPayment.findFirst({
    where: { id: paymentId, companyId: auth.companyId },
    include: {
      recordedBy: { select: userSelect },
      reversedBy: { select: userSelect },
      paymentCase: { include: { ...caseInclude, payments: true } },
    },
  });
  if (!payment) throw new NotFoundError('Payment not found.');
  return payment;
}

async function presentCasePayments(
  auth: AuthContext,
  row: { id: string },
) {
  const payments = await prisma.customerPayment.findMany({
    where: { caseId: row.id, companyId: auth.companyId },
    include: {
      recordedBy: { select: userSelect },
      reversedBy: { select: userSelect },
      receipt: { select: { id: true, receiptNumber: true, uploadStatus: true } },
    },
    orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
  });
  return payments.map((payment) => {
    const { companyId: _companyId, caseId: _caseId, ...safe } = payment;
    void _companyId;
    void _caseId;
    return { ...safe, amount: decimal(payment.amount) };
  });
}

async function loadCaseDetails(auth: AuthContext, caseId: string) {
  const row = await getCase(auth, caseId);
  return { ...presentCase(row), payments: await presentCasePayments(auth, row) };
}

/**
 * Shared derivation for lead-bound payment cases. Finds the lead
 * (tenant-scoped), its existing case if any, and the applicable linked
 * quotation — the latest non-deleted quotation by creation time, and that
 * quotation's latest version by version number (the same rule the Leads
 * table uses for its quotation amount).
 */
async function resolveLeadCaseDerivation(
  auth: AuthContext,
  queryId: string,
  overrides?: {
    title?: string | null | undefined;
    tripAmount?: number | null | undefined;
    currency?: string | null | undefined;
  },
) {
  const lead = await prisma.query.findFirst({
    where: { id: queryId, companyId: auth.companyId },
    select: {
      id: true,
      queryNumber: true,
      customerId: true,
      customerName: true,
      phone: true,
      email: true,
      currency: true,
      itinerary: { select: { destination: true }, orderBy: { sequence: 'asc' }, take: 1 },
    },
  });
  if (!lead) throw new NotFoundError('Lead not found.');
  const quotation = await prisma.quotation.findFirst({
    where: { queryId: lead.id, companyId: auth.companyId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      quotationNumber: true,
      destinationSummary: true,
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 1,
        select: { finalAmount: true, currency: true },
      },
    },
  });
  const version = quotation?.versions[0] ?? null;
  const versionAmount =
    version?.finalAmount != null && Number(version.finalAmount) > 0
      ? Number(version.finalAmount)
      : null;
  const tripAmount = overrides?.tripAmount ?? versionAmount;
  const currency = (
    overrides?.currency ??
    version?.currency ??
    lead.currency ??
    'INR'
  ).toUpperCase();
  const destination =
    quotation?.destinationSummary?.trim() || lead.itinerary[0]?.destination?.trim() || '';
  const title = (
    overrides?.title?.trim() ||
    (destination ? `${lead.customerName} – ${destination}` : `Trip for ${lead.customerName}`)
  ).slice(0, 200);
  return {
    lead: { id: lead.id, queryNumber: lead.queryNumber, customerName: lead.customerName },
    quotation: quotation
      ? {
          id: quotation.id,
          quotationNumber: quotation.quotationNumber,
          finalAmount: version?.finalAmount != null ? Number(version.finalAmount) : null,
          currency: version?.currency ?? null,
        }
      : null,
    suggestion: {
      title,
      tripAmount,
      currency,
      quotationId: quotation?.id ?? null,
      quotationNumber: quotation?.quotationNumber ?? null,
    },
    requiresAmount: tripAmount == null,
    customerId: lead.customerId,
    customerName: lead.customerName,
    customerPhone: lead.phone,
    customerEmail: lead.email,
  };
}

export const paymentsService = {
  async cases(auth: AuthContext, query: Record<string, unknown>) {
    if (!(await financialAccess(auth))) throw new ForbiddenError();
    const page = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const where: Prisma.PaymentCaseWhereInput = {
      companyId: auth.companyId,
      ...(typeof query.customerId === 'string' && query.customerId
        ? { customerId: query.customerId }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { customerPhone: { contains: search } },
              { customerEmail: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.paymentCase.findMany({
        where,
        include: { ...caseInclude, payments: true },
        orderBy: [{ updatedAt: 'desc' }],
        ...toPrismaPagination(page),
      }),
      prisma.paymentCase.count({ where }),
    ]);
    return {
      data: rows.map(presentCase),
      pagination: buildPaginationMeta(page, total),
    };
  },

  async caseDetails(auth: AuthContext, caseId: string) {
    if (!(await financialAccess(auth))) throw new ForbiddenError();
    const row = await getCase(auth, caseId);
    const payments = await prisma.customerPayment.findMany({
      where: { caseId: row.id, companyId: auth.companyId },
      include: {
        recordedBy: { select: userSelect },
        reversedBy: { select: userSelect },
        receipt: { select: { id: true, receiptNumber: true, uploadStatus: true } },
      },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      ...presentCase(row),
      payments: payments.map((payment) => {
        const { companyId: _companyId, caseId: _caseId, ...safe } = payment;
        void _companyId;
        void _caseId;
        return { ...safe, amount: decimal(payment.amount) };
      }),
    };
  },

  /**
   * Read-only view of a lead's payment case. Never creates anything: returns
   * the existing case with its payment history, or derivation hints (title,
   * amount, currency, linked quotation) so the caller can ask the user for a
   * missing agreed amount instead of inventing one.
   */
  async byLeadCase(auth: AuthContext, queryId: string) {
    if (!(await financialAccess(auth))) throw new ForbiddenError();
    const derivation = await resolveLeadCaseDerivation(auth, queryId);
    const existing = await prisma.paymentCase.findFirst({
      where: { companyId: auth.companyId, queryId: derivation.lead.id },
      include: { ...caseInclude, payments: true },
    });
    return {
      lead: derivation.lead,
      quotation: derivation.quotation,
      suggestion: derivation.suggestion,
      requiresAmount: existing ? false : derivation.requiresAmount,
      case: existing ? await loadCaseDetails(auth, existing.id) : null,
    };
  },

  /**
   * Find-or-create the payment case for a lead. Reuses the existing case;
   * otherwise derives title/amount/currency from the applicable linked
   * quotation (or caller-supplied overrides) and creates exactly one case.
   * The partial unique index on (companyId, queryId) makes concurrent calls
   * collapse onto a single row via the P2002 catch below.
   */
  async forLeadCase(auth: AuthContext, input: LeadPaymentCaseInput) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_CREATE))) throw new ForbiddenError();
    const derivation = await resolveLeadCaseDerivation(auth, input.queryId, {
      title: input.title,
      tripAmount: input.tripAmount ?? null,
      currency: input.currency,
    });
    const findExisting = () =>
      prisma.paymentCase.findFirst({
        where: { companyId: auth.companyId, queryId: derivation.lead.id },
        select: { id: true },
      });
    if (await findExisting()) {
      const row = await findExisting();
      return {
        lead: derivation.lead,
        quotation: derivation.quotation,
        suggestion: derivation.suggestion,
        requiresAmount: false,
        created: false,
        case: await loadCaseDetails(auth, row!.id),
      };
    }
    if (derivation.requiresAmount || derivation.suggestion.tripAmount == null) {
      return {
        lead: derivation.lead,
        quotation: derivation.quotation,
        suggestion: derivation.suggestion,
        requiresAmount: true,
        created: false,
        case: null,
      };
    }
    const caseInput: PaymentCaseInput = {
      customerId: derivation.customerId,
      queryId: derivation.lead.id,
      customerName: derivation.customerName,
      customerPhone: derivation.customerPhone,
      customerEmail: derivation.customerEmail,
      title: derivation.suggestion.title,
      tripAmount: derivation.suggestion.tripAmount,
      currency: derivation.suggestion.currency,
    };
    let created = true;
    try {
      await paymentsService.createCase(auth, caseInput);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      // Lost the race: another request created this lead's case first.
      created = false;
    }
    const row = await findExisting();
    if (!row) throw new ConflictError('A payment case for this lead already exists.');
    return {
      lead: derivation.lead,
      quotation: derivation.quotation,
      suggestion: derivation.suggestion,
      requiresAmount: false,
      created,
      case: await loadCaseDetails(auth, row.id),
    };
  },

  async createCase(auth: AuthContext, input: PaymentCaseInput) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_CREATE))) throw new ForbiddenError();
    await validateCaseRefs(auth, input);
    let snapshot = {
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone?.trim() || null,
      customerEmail: input.customerEmail?.trim() || null,
    };
    if (input.customerId) {
      const customer = await prisma.customer.findFirstOrThrow({
        where: { id: input.customerId, companyId: auth.companyId },
        select: { displayName: true, primaryPhone: true, email: true },
      });
      snapshot = {
        customerName: customer.displayName,
        customerPhone: customer.primaryPhone,
        customerEmail: customer.email,
      };
    }
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.paymentCase.create({
        data: {
          companyId: auth.companyId,
          customerId: input.customerId ?? null,
          queryId: input.queryId ?? null,
          ...snapshot,
          title: input.title.trim(),
          tripAmount: input.tripAmount,
          currency: input.currency,
          createdById: auth.userId,
        },
      });
      return row;
    });
    const full = await prisma.paymentCase.findUniqueOrThrow({
      where: { id: created.id },
      include: { ...caseInclude, payments: true },
    });
    return presentCase(full);
  },

  async list(auth: AuthContext, query: Record<string, unknown>) {
    if (!(await financialAccess(auth))) throw new ForbiddenError();
    const page = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const where: Prisma.CustomerPaymentWhereInput = {
      companyId: auth.companyId,
      ...(typeof query.paymentMethod === 'string'
        ? { paymentMethod: query.paymentMethod as Prisma.EnumPaymentMethodFilter }
        : {}),
      ...(typeof query.paymentStatus === 'string'
        ? { paymentStatus: query.paymentStatus as Prisma.EnumPaymentRecordStatusFilter }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            receivedAt: {
              ...(query.dateFrom ? { gte: new Date(String(query.dateFrom)) } : {}),
              ...(query.dateTo ? { lte: new Date(String(query.dateTo)) } : {}),
            },
          }
        : {}),
      ...(typeof query.caseId === 'string' && query.caseId ? { caseId: query.caseId } : {}),
      ...(search
        ? {
            OR: [
              { paymentNumber: { contains: search, mode: 'insensitive' } },
              { referenceNumber: { contains: search, mode: 'insensitive' } },
              { bankName: { contains: search, mode: 'insensitive' } },
              {
                paymentCase: {
                  is: {
                    OR: [
                      { title: { contains: search, mode: 'insensitive' } },
                      { customerName: { contains: search, mode: 'insensitive' } },
                      { customerPhone: { contains: search } },
                      { customerEmail: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { timezone: true },
    });
    const { start: dayStart } = localDayBounds(company.timezone);
    const monthParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: company.timezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const monthValue = Object.fromEntries(monthParts.map((part) => [part.type, part.value])) as {
      year?: string;
      month?: string;
    };
    const monthStart = zonedTimeToUtc(
      company.timezone,
      Number(monthValue.year),
      Number(monthValue.month),
      1,
    );
    const [rows, total, collected, todayCollected, monthCollected] = await Promise.all([
      prisma.customerPayment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        ...toPrismaPagination(page),
      }),
      prisma.customerPayment.count({ where }),
      prisma.customerPayment.aggregate({
        where: {
          ...where,
          paymentStatus: { in: [...COLLECTED_STATUSES] },
          reversedAt: null,
        },
        _sum: { amount: true },
      }),
      prisma.customerPayment.aggregate({
        where: {
          companyId: auth.companyId,
          paymentStatus: { in: [...COLLECTED_STATUSES] },
          reversedAt: null,
          receivedAt: { gte: dayStart },
        },
        _sum: { amount: true },
      }),
      prisma.customerPayment.aggregate({
        where: {
          companyId: auth.companyId,
          paymentStatus: { in: [...COLLECTED_STATUSES] },
          reversedAt: null,
          receivedAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
    ]);
    const sum = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? '0.00';
    return {
      data: rows.map((row) => ({
        ...presentLedgerRow(row),
        paymentCase: {
          ...row.paymentCase,
          tripAmount: decimal(row.paymentCase.tripAmount),
        },
      })),
      pagination: buildPaginationMeta(page, total),
      summary: {
        totalCollected: sum(collected._sum.amount),
        paymentCount: total,
        receivedToday: sum(todayCollected._sum.amount),
        receivedThisMonth: sum(monthCollected._sum.amount),
      },
    };
  },

  async details(auth: AuthContext, paymentId: string) {
    if (!(await financialAccess(auth))) throw new ForbiddenError();
    const payment = await getPayment(auth, paymentId);
    const totals = caseTotals({
      tripAmount: payment.paymentCase.tripAmount,
      payments: payment.paymentCase.payments.map((row) => ({
        amount: row.amount,
        paymentStatus: row.paymentStatus,
        reversedAt: row.reversedAt,
      })),
    });
    const { payments: _payments, companyId: _caseCompany, ...caseSafe } = payment.paymentCase;
    void _payments;
    void _caseCompany;
    const { companyId: _companyId, caseId: _caseId, paymentCase: _paymentCase, ...safe } = payment;
    void _companyId;
    void _caseId;
    void _paymentCase;
    return {
      ...safe,
      amount: decimal(payment.amount),
      paymentCase: {
        ...caseSafe,
        tripAmount: decimal(payment.paymentCase.tripAmount),
        collected: totals.collected.toFixed(2),
        outstanding: totals.outstanding.toFixed(2),
        paymentCount: totals.paymentCount,
        status: totals.status,
      },
    };
  },

  async create(auth: AuthContext, input: PaymentInput, context: PaymentsRequestContext) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_CREATE))) throw new ForbiddenError();
    const trip = await getCase(auth, input.caseId);
    if (input.currency !== trip.currency)
      throw new ValidationError('Payment currency must match the trip currency.');
    const totals = caseTotals(trip);
    if (new Prisma.Decimal(input.amount).greaterThan(totals.outstanding))
      throw new ConflictError(
        `Payment exceeds the outstanding balance of ${totals.outstanding.toFixed(2)}.`,
      );
    const created = await prisma.$transaction(async (tx) => {
      const paymentNumber = await nextPaymentNumber(tx, auth.companyId, 'payment');
      const payment = await tx.customerPayment.create({
        data: {
          companyId: auth.companyId,
          caseId: trip.id,
          paymentNumber,
          amount: input.amount,
          currency: input.currency,
          paymentMethod: input.paymentMethod,
          paymentStatus: input.paymentStatus ?? 'RECEIVED',
          receivedAt: input.receivedAt,
          referenceNumber: input.referenceNumber?.trim() || null,
          bankName: input.bankName?.trim() || null,
          notes: input.notes?.trim() || null,
          recordedById: auth.userId,
        },
      });
      await tx.activityLog.create({
        data: {
          companyId: auth.companyId,
          actorUserId: auth.userId,
          action: 'CUSTOMER_PAYMENT_RECORDED',
          entityType: 'CustomerPayment',
          entityId: payment.id,
          metadata: { caseId: trip.id, paymentNumber, amount: String(input.amount) },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return payment;
    });
    return { ...created, amount: decimal(created.amount) };
  },

  async update(auth: AuthContext, paymentId: string, input: PaymentUpdateInput) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_EDIT))) throw new ForbiddenError();
    const payment = await prisma.customerPayment.findFirst({
      where: { id: paymentId, companyId: auth.companyId },
    });
    if (!payment) throw new NotFoundError('Payment not found.');
    if (payment.reversedAt) throw new ConflictError('Reversed payments cannot be edited.');
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.customerPayment.update({
        where: { id: paymentId },
        data: {
          ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
          ...(input.paymentStatus !== undefined ? { paymentStatus: input.paymentStatus } : {}),
          ...(input.receivedAt !== undefined ? { receivedAt: input.receivedAt } : {}),
          ...(input.referenceNumber !== undefined
            ? { referenceNumber: input.referenceNumber?.trim() || null }
            : {}),
          ...(input.bankName !== undefined ? { bankName: input.bankName?.trim() || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        },
      });
      return row;
    });
    return { ...updated, amount: decimal(updated.amount) };
  },

  async reverse(
    auth: AuthContext,
    paymentId: string,
    reason: string,
    context: PaymentsRequestContext,
  ) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_REVERSE))) throw new ForbiddenError();
    const payment = await prisma.customerPayment.findFirst({
      where: { id: paymentId, companyId: auth.companyId },
    });
    if (!payment) throw new NotFoundError('Payment not found.');
    if (payment.reversedAt || payment.paymentStatus === 'REVERSED')
      throw new ConflictError('Payment is already reversed.');
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.customerPayment.update({
        where: { id: paymentId },
        data: {
          paymentStatus: 'REVERSED',
          reversedAt: new Date(),
          reversedById: auth.userId,
          reversalReason: reason,
        },
      });
      await tx.activityLog.create({
        data: {
          companyId: auth.companyId,
          actorUserId: auth.userId,
          action: 'CUSTOMER_PAYMENT_REVERSED',
          entityType: 'CustomerPayment',
          entityId: paymentId,
          metadata: { paymentNumber: payment.paymentNumber },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return row;
    });
    return { ...updated, amount: decimal(updated.amount) };
  },

  async voucher(auth: AuthContext, paymentId: string) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_VIEW_RECEIPTS)))
      throw new ForbiddenError();
    // Existence + visibility check; the receipt row carries the payload.
    await getPayment(auth, paymentId);
    const receipt = await prisma.paymentReceipt.findUnique({ where: { paymentId } });
    if (!receipt || receipt.companyId !== auth.companyId)
      throw new NotFoundError('Payment voucher has not been generated yet.');
    return presentPaymentReceipt(receipt);
  },

  async generateVoucher(auth: AuthContext, paymentId: string, context: PaymentsRequestContext) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_GENERATE_RECEIPTS)))
      throw new ForbiddenError();
    const payment = await getPayment(auth, paymentId);
    assertCollectible(payment);
    const existing = await prisma.paymentReceipt.findUnique({ where: { paymentId } });
    if (existing && existing.companyId !== auth.companyId)
      throw new NotFoundError('Payment not found.');
    if (
      existing &&
      existing.uploadStatus === 'AVAILABLE' &&
      existing.createdAt >= payment.updatedAt &&
      (await storageService.headObject(existing.objectKey))
    ) {
      return { ...presentPaymentReceipt(existing), reused: true };
    }
    const receiptNumber =
      existing?.receiptNumber ??
      (await prisma.$transaction((tx) => nextPaymentNumber(tx, auth.companyId, 'receipt')));
    const totals = caseTotals({
      tripAmount: payment.paymentCase.tripAmount,
      payments: payment.paymentCase.payments.map((row) => ({
        amount: row.amount,
        paymentStatus: row.paymentStatus,
        reversedAt: row.reversedAt,
      })),
    });
    const currency = payment.currency;
    const money = (value: Prisma.Decimal | null | undefined) =>
      value === null || value === undefined
        ? '—'
        : new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value));
    const pdf = await renderPaymentVoucherPdf({
      company: await loadCompanyBranding(auth.companyId),
      receipt: {
        receiptNumber,
        paymentNumber: payment.paymentNumber,
        receivedAt: formatReceiptDate(payment.receivedAt),
        customerName: payment.paymentCase.customerName,
        tripTitle: payment.paymentCase.title,
        amount: money(payment.amount),
        paymentMethod:
          payment.paymentMethod === 'UPI' ? 'UPI' : labelForLookup(payment.paymentMethod),
        referenceNumber: payment.referenceNumber,
        bankName: payment.bankName,
        notes: payment.notes,
        totalTripAmount: money(payment.paymentCase.tripAmount),
        previouslyPaid: money(totals.collected.minus(payment.amount)),
        totalPaid: money(totals.collected),
        outstanding: money(totals.outstanding),
        paymentStatus: labelForLookup(totals.status),
      },
    });
    const fileName = `payment-voucher-${receiptNumber}.pdf`;
    const documentId = existing?.id ?? crypto.randomUUID();
    const objectKey = paymentVoucherObjectKey({
      companyId: auth.companyId,
      paymentId: payment.id,
      documentId,
      fileName,
    });
    const checksum = crypto.createHash('sha256').update(pdf).digest('hex');
    await storageService.putObject({
      key: objectKey,
      body: pdf,
      contentType: 'application/pdf',
      checksum,
    });
    try {
      const saved = await prisma.$transaction(async (tx) => {
        const row = existing
          ? await tx.paymentReceipt.update({
              where: { id: existing.id },
              data: {
                fileName,
                storageProvider: storageService.provider,
                bucket: storageService.bucket,
                objectKey,
                mimeType: 'application/pdf',
                fileSize: pdf.length,
                checksum,
                uploadStatus: 'AVAILABLE',
                uploadedById: auth.userId,
              },
            })
          : await tx.paymentReceipt.create({
              data: {
                id: documentId,
                companyId: auth.companyId,
                paymentId: payment.id,
                receiptNumber,
                fileName,
                storageProvider: storageService.provider,
                bucket: storageService.bucket,
                objectKey,
                mimeType: 'application/pdf',
                fileSize: pdf.length,
                checksum,
                uploadStatus: 'AVAILABLE',
                uploadedById: auth.userId,
              },
            });
        await tx.activityLog.create({
          data: {
            companyId: auth.companyId,
            actorUserId: auth.userId,
            action: 'CUSTOMER_PAYMENT_RECEIPT_GENERATED',
            entityType: 'PaymentReceipt',
            entityId: row.id,
            metadata: { paymentId: payment.id, receiptNumber },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return row;
      });
      return { ...presentPaymentReceipt(saved), reused: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.paymentReceipt.findUnique({ where: { paymentId } });
        if (winner && winner.companyId === auth.companyId)
          return { ...presentPaymentReceipt(winner), reused: true };
      }
      throw error;
    }
  },

  async voucherDownloadUrl(auth: AuthContext, paymentId: string) {
    if (!(await hasPermission(auth, PERMISSIONS.PAYMENTS_VIEW_RECEIPTS)))
      throw new ForbiddenError();
    const payment = await getPayment(auth, paymentId);
    assertCollectible(payment);
    const receipt = await prisma.paymentReceipt.findUnique({ where: { paymentId } });
    if (!receipt || receipt.companyId !== auth.companyId || receipt.uploadStatus !== 'AVAILABLE')
      throw new NotFoundError('Payment voucher has not been generated yet.');
    return {
      url: await storageService.createDownloadUrl(
        receipt.objectKey,
        receipt.fileName,
        env.BOOKING_PRESIGNED_URL_EXPIRY_SECONDS,
        'attachment',
      ),
      fileName: receipt.fileName,
      expiresInSeconds: env.BOOKING_PRESIGNED_URL_EXPIRY_SECONDS,
    };
  },
};
