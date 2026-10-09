import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  type HotelVoucherEmailInput,
  type HotelVoucherInput,
  type HotelVoucherUpdateInput,
} from '@interscale/shared';
import { prisma } from '../../config/prisma.js';
import type { AuthContext } from '../../middleware/authenticate.js';
import {
  hotelVoucherObjectKey,
  sanitizeFileName,
  storageService,
} from '../../services/storage/storage.service.js';
import { loadCompanyBranding } from '../../services/pdf/company-branding.js';
import { emailService } from '../../services/email/email.service.js';
import { renderHotelVoucherPdf } from './hotel-voucher-pdf.service.js';
import {
  buildPaginationMeta,
  resolvePagination,
  toPrismaPagination,
} from '../../utils/pagination.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';

export type HotelVoucherRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

type HotelVoucherEntity = 'HotelVoucher' | 'HotelVoucherDocument';

function audit(
  auth: AuthContext,
  action: Prisma.ActivityLogUncheckedCreateInput['action'],
  entityType: HotelVoucherEntity,
  entityId: string,
  context: HotelVoucherRequestContext,
  metadata?: Prisma.InputJsonValue,
): Prisma.ActivityLogUncheckedCreateInput {
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    action,
    entityType,
    entityId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

const userSelect = { id: true, fullName: true } as const;
/** Signed download-URL lifetime, mirroring the master-media convention. */
const PRESIGN_TTL_SECONDS = 300;

const dateOnly = (value: Date | null | undefined): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const money = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const num =
    typeof value === 'object' && 'toNumber' in (value as Record<string, unknown>)
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(num) ? num : null;
};

const nightsBetween = (checkIn: Date | null, checkOut: Date | null): number | null => {
  if (!checkIn || !checkOut) return null;
  return Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
};

function presentVoucher(row: Record<string, unknown>) {
  const {
    companyId,
    // Internal status marker only — never exposed, filtered, or branched on.
    status,
    customer,
    query,
    hotel,
    documents,
    pricing,
    guests,
    packageIncludes,
    checkIn,
    checkOut,
    ...safe
  } = row;
  void companyId;
  void status;
  const checkInDate = (checkIn ?? null) as Date | null;
  const checkOutDate = (checkOut ?? null) as Date | null;
  return {
    ...safe,
    checkIn: dateOnly(checkInDate),
    checkOut: dateOnly(checkOutDate),
    issueDate: dateOnly((row.issueDate ?? null) as Date | null),
    nights: nightsBetween(checkInDate, checkOutDate),
    customer,
    query,
    hotel,
    pricing: Array.isArray(pricing)
      ? (pricing as Record<string, unknown>[]).map((entry) => {
          const { companyId: _companyId, voucherId: _voucherId, ...safeEntry } = entry;
          return {
            ...safeEntry,
            gst: money(entry.gst),
            amount: money(entry.amount),
            taxablePay: money(entry.taxablePay),
            gstService: money(entry.gstService),
          };
        })
      : [],
    guests: Array.isArray(guests) ? guests : [],
    packageIncludes: Array.isArray(packageIncludes)
      ? (packageIncludes as Record<string, unknown>[])
          .map((entry) => (typeof entry.item === 'string' ? entry.item : ''))
          .filter((item) => item.length > 0)
      : [],
    documents: Array.isArray(documents)
      ? (documents as Record<string, unknown>[]).map((document) => {
          const {
            objectKey: _objectKey,
            bucket: _bucket,
            companyId: _companyId,
            ...safeDocument
          } = document;
          return safeDocument;
        })
      : [],
  };
}

/**
 * Tenant-scoped voucher number: HV-000001…, one lifetime sequence per
 * company. Atomic upsert inside the caller's transaction; the
 * @@unique([companyId, voucherNumber]) constraint is the backstop.
 */
async function nextHotelVoucherNumber(tx: Prisma.TransactionClient, companyId: string) {
  const year = 0;
  const counter = await tx.hotelVoucherCounter.upsert({
    where: { companyId_year: { companyId, year } },
    create: { companyId, year, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return `HV-${String(counter.value).padStart(6, '0')}`;
}

async function getVoucher(auth: AuthContext, voucherId: string) {
  const voucher = await prisma.hotelVoucher.findFirst({
    where: { id: voucherId, companyId: auth.companyId, deletedAt: null },
    include: {
      customer: { select: { id: true, displayName: true, primaryPhone: true, email: true } },
      query: {
        select: { id: true, queryNumber: true, customerName: true, phone: true, email: true },
      },
      hotel: {
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          email: true,
          starCategory: true,
          status: true,
        },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
      pricing: { orderBy: { sequence: 'asc' as const } },
      guests: { orderBy: { sequence: 'asc' as const } },
      packageIncludes: { orderBy: { sequence: 'asc' as const } },
      createdBy: { select: userSelect },
      updatedBy: { select: userSelect },
    },
  });
  if (!voucher) throw new NotFoundError('Hotel voucher not found.');
  return voucher;
}

/** Optional references must exist inside the caller's company (or be global hotel masters). */
async function validateVoucherRefs(
  auth: AuthContext,
  input: {
    customerId?: string | null | undefined;
    queryId?: string | null | undefined;
    hotelId?: string | null | undefined;
  },
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
  if (input.hotelId) {
    const hotel = await prisma.hotel.findFirst({
      where: { id: input.hotelId },
      select: { id: true, companyId: true, status: true, company: { select: { isSystem: true } } },
    });
    const visible = hotel && (hotel.companyId === auth.companyId || hotel.company.isSystem);
    if (!visible) throw new ValidationError('Selected hotel was not found.');
    if (hotel.status !== 'ACTIVE') throw new ValidationError('Selected hotel is not active.');
  }
}

/**
 * Quotation provenance for vouchers created from a quotation. Every id is
 * re-resolved server-side: the quotation must belong to the caller's company,
 * the hotel option must sit on the quotation's applicable version
 * (currentVersionId, else the latest version), and any lead/customer/hotel
 * refs must agree with the quotation's real relationships. Provenance is
 * validation-only — nothing here is persisted beyond the existing refs.
 */
async function validateQuotationRefs(
  auth: AuthContext,
  input: {
    customerId?: string | null | undefined;
    queryId?: string | null | undefined;
    hotelId?: string | null | undefined;
    quotationId?: string | null | undefined;
    quotationHotelOptionId?: string | null | undefined;
  },
) {
  if (input.quotationHotelOptionId && !input.quotationId) {
    throw new ValidationError('Select a quotation before choosing its hotel.');
  }
  if (!input.quotationId) return;
  const quotation = await prisma.quotation.findFirst({
    where: { id: input.quotationId, companyId: auth.companyId, deletedAt: null },
    select: { id: true, queryId: true, customerId: true, currentVersionId: true },
  });
  if (!quotation) throw new ValidationError('Selected quotation was not found.');
  if (input.queryId && input.queryId !== quotation.queryId) {
    throw new ValidationError('Selected lead does not belong to the selected quotation.');
  }
  if (input.customerId && quotation.customerId && input.customerId !== quotation.customerId) {
    throw new ValidationError('Selected customer does not belong to the selected quotation.');
  }
  if (!input.quotationHotelOptionId) return;
  const option = await prisma.quotationVersionHotelOption.findFirst({
    where: { id: input.quotationHotelOptionId, companyId: auth.companyId },
    select: {
      id: true,
      hotelId: true,
      quotationVersionId: true,
      quotationVersion: { select: { quotationId: true } },
    },
  });
  if (!option || option.quotationVersion.quotationId !== quotation.id) {
    throw new ValidationError('Selected hotel does not belong to the selected quotation.');
  }
  const latestVersion = await prisma.quotationVersion.findFirst({
    where: { quotationId: quotation.id, companyId: auth.companyId },
    orderBy: { versionNumber: 'desc' },
    select: { id: true },
  });
  const applicableVersionId = quotation.currentVersionId ?? latestVersion?.id ?? null;
  if (!applicableVersionId || option.quotationVersionId !== applicableVersionId) {
    throw new ValidationError('Selected hotel does not belong to the selected quotation.');
  }
  if (option.hotelId && input.hotelId && input.hotelId !== option.hotelId) {
    throw new ValidationError('Selected hotel does not match the quotation hotel entry.');
  }
}

export const hotelVouchersService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const pagination = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || 10,
    });
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const hotelId = typeof query.hotelId === 'string' && query.hotelId ? query.hotelId : undefined;
    const from =
      typeof query.from === 'string' && query.from ? new Date(`${query.from}T00:00:00`) : null;
    const to = typeof query.to === 'string' && query.to ? new Date(`${query.to}T00:00:00`) : null;
    const sortBy = String(query.sortBy ?? 'createdAt');
    const order: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.HotelVoucherOrderByWithRelationInput =
      sortBy === 'checkIn'
        ? { checkIn: order }
        : sortBy === 'guestName'
          ? { guestName: order }
          : sortBy === 'voucherNumber'
            ? { voucherNumber: order }
            : { createdAt: order };
    const where: Prisma.HotelVoucherWhereInput = {
      companyId: auth.companyId,
      deletedAt: null,
      ...(hotelId ? { hotelId } : {}),
      ...(from || to
        ? {
            checkIn: {
              ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
              ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { voucherNumber: { contains: search, mode: 'insensitive' } },
              { guestName: { contains: search, mode: 'insensitive' } },
              { hotelName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.hotelVoucher.findMany({
        where,
        ...toPrismaPagination(pagination),
        orderBy,
        include: {
          _count: { select: { documents: { where: { deletedAt: null } } } },
        },
      }),
      prisma.hotelVoucher.count({ where }),
    ]);
    return {
      data: rows.map((row) => presentVoucher(row as unknown as Record<string, unknown>)),
      pagination: buildPaginationMeta(pagination, total),
    };
  },

  async details(auth: AuthContext, voucherId: string) {
    return presentVoucher(
      (await getVoucher(auth, voucherId)) as unknown as Record<string, unknown>,
    );
  },

  async create(auth: AuthContext, input: HotelVoucherInput, context: HotelVoucherRequestContext) {
    await validateVoucherRefs(auth, input);
    await validateQuotationRefs(auth, input);
    // Vouchers are created directly usable: there is no draft step. The
    // input schema already enforces issuance readiness (guest/hotel names,
    // valid date order), mirroring the old issue() guards.
    const issuedAt = new Date();
    try {
      const voucher = await prisma.$transaction(async (tx) => {
        const voucherNumber = await nextHotelVoucherNumber(tx, auth.companyId);
        const created = await tx.hotelVoucher.create({
          data: {
            companyId: auth.companyId,
            voucherNumber,
            status: 'ISSUED',
            issueDate: issuedAt,
            customerId: input.customerId ?? null,
            queryId: input.queryId ?? null,
            hotelId: input.hotelId ?? null,
            guestName: input.guestName.trim(),
            guestPhone: input.guestPhone?.trim() || null,
            guestEmail: input.guestEmail?.trim() || null,
            adults: input.adults ?? 1,
            children: input.children ?? 0,
            hotelName: input.hotelName.trim(),
            hotelAddress: input.hotelAddress?.trim() || null,
            hotelCity: input.hotelCity?.trim() || null,
            hotelPhone: input.hotelPhone?.trim() || null,
            hotelEmail: input.hotelEmail?.trim() || null,
            hotelStarRating: input.hotelStarRating?.trim() || null,
            checkIn: new Date(`${input.checkIn}T00:00:00`),
            checkOut: new Date(`${input.checkOut}T00:00:00`),
            roomTypeName: input.roomTypeName?.trim() || null,
            rooms: input.rooms ?? 1,
            mealPlanName: input.mealPlanName?.trim() || null,
            confirmationNumber: input.confirmationNumber?.trim() || null,
            bookingId: input.bookingId?.trim() || null,
            confirmationNumberLabel: input.confirmationNumberLabel?.trim() || null,
            bookingIdLabel: input.bookingIdLabel?.trim() || null,
            specialRequests: input.specialRequests?.trim() || null,
            remarks: input.remarks?.trim() || null,
            termsSnapshot: input.termsSnapshot?.trim() || null,
            createdById: auth.userId,
            pricing: {
              create: (input.pricing ?? []).map((row, index) => ({
                companyId: auth.companyId,
                sequence: index,
                roomType: row.roomType.trim(),
                unit: row.unit ?? 1,
                quantity: row.quantity ?? 1,
                gst: row.gst ?? null,
                amount: row.amount ?? null,
                taxablePay: row.taxablePay ?? null,
                gstService: row.gstService ?? null,
              })),
            },
            guests: {
              create: (input.guests ?? []).map((row, index) => ({
                companyId: auth.companyId,
                sequence: index,
                guestName: row.guestName.trim(),
                age: row.age ?? null,
                sex: row.sex,
                paxType: row.paxType,
              })),
            },
            packageIncludes: {
              create: (input.packageIncludes ?? []).map((item, index) => ({
                companyId: auth.companyId,
                sequence: index,
                item: item.trim(),
              })),
            },
          },
        });
        await tx.activityLog.create({
          data: audit(auth, 'HOTEL_VOUCHER_CREATED', 'HotelVoucher', created.id, context, {
            voucherNumber,
          }),
        });
        return created;
      });
      return presentVoucher(
        (await getVoucher(auth, voucher.id)) as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictError('Voucher number already issued, please retry.');
      throw error;
    }
  },

  async update(
    auth: AuthContext,
    voucherId: string,
    input: HotelVoucherUpdateInput,
    context: HotelVoucherRequestContext,
  ) {
    const current = await getVoucher(auth, voucherId);
    // Every voucher is editable regardless of status (draft, issued,
    // cancelled): partial updates only touch supplied fields, each change is
    // audited, and regenerating the PDF picks up the latest snapshot.
    await validateVoucherRefs(auth, {
      customerId: 'customerId' in input ? (input.customerId ?? null) : undefined,
      queryId: 'queryId' in input ? (input.queryId ?? null) : undefined,
      hotelId: 'hotelId' in input ? (input.hotelId ?? null) : undefined,
    });
    // Provenance fields are validation-only (never persisted — see create);
    // a tampered update must pass the same relationship checks against the
    // effective refs (incoming values, else the stored ones).
    await validateQuotationRefs(auth, {
      customerId: 'customerId' in input ? (input.customerId ?? null) : current.customerId,
      queryId: 'queryId' in input ? (input.queryId ?? null) : current.queryId,
      hotelId: 'hotelId' in input ? (input.hotelId ?? null) : current.hotelId,
      quotationId: 'quotationId' in input ? (input.quotationId ?? null) : undefined,
      quotationHotelOptionId:
        'quotationHotelOptionId' in input ? (input.quotationHotelOptionId ?? null) : undefined,
    });
    const checkIn = input.checkIn ? new Date(`${input.checkIn}T00:00:00`) : current.checkIn;
    const checkOut = input.checkOut ? new Date(`${input.checkOut}T00:00:00`) : current.checkOut;
    if (checkOut <= checkIn) throw new ValidationError('Check-out must be after check-in.');
    // Relation-backed ids must be written through relation operations:
    // Prisma accepts only `customer`/`query`/`hotel` (never the scalar
    // `customerId`/`queryId`/`hotelId`) in a checked update. Passing the
    // scalars throws PrismaClientValidationError (HTTP 500), which is why
    // every edit-form save failed — the form always submits these keys.
    const data: Prisma.HotelVoucherUpdateInput = {
      ...(input.customerId !== undefined
        ? {
            customer:
              input.customerId === null
                ? { disconnect: true }
                : { connect: { id: input.customerId } },
          }
        : {}),
      ...(input.queryId !== undefined
        ? {
            query: input.queryId === null ? { disconnect: true } : { connect: { id: input.queryId } },
          }
        : {}),
      ...(input.hotelId !== undefined
        ? {
            hotel: input.hotelId === null ? { disconnect: true } : { connect: { id: input.hotelId } },
          }
        : {}),
      ...(input.guestName !== undefined ? { guestName: input.guestName.trim() } : {}),
      ...(input.guestPhone !== undefined ? { guestPhone: input.guestPhone?.trim() || null } : {}),
      ...(input.guestEmail !== undefined ? { guestEmail: input.guestEmail?.trim() || null } : {}),
      ...(input.adults !== undefined ? { adults: input.adults } : {}),
      ...(input.children !== undefined ? { children: input.children } : {}),
      ...(input.hotelName !== undefined ? { hotelName: input.hotelName.trim() } : {}),
      ...(input.hotelAddress !== undefined
        ? { hotelAddress: input.hotelAddress?.trim() || null }
        : {}),
      ...(input.hotelCity !== undefined ? { hotelCity: input.hotelCity?.trim() || null } : {}),
      ...(input.hotelPhone !== undefined ? { hotelPhone: input.hotelPhone?.trim() || null } : {}),
      ...(input.hotelEmail !== undefined ? { hotelEmail: input.hotelEmail?.trim() || null } : {}),
      ...(input.hotelStarRating !== undefined
        ? { hotelStarRating: input.hotelStarRating?.trim() || null }
        : {}),
      ...(input.checkIn ? { checkIn } : {}),
      ...(input.checkOut ? { checkOut } : {}),
      ...(input.roomTypeName !== undefined
        ? { roomTypeName: input.roomTypeName?.trim() || null }
        : {}),
      ...(input.rooms !== undefined ? { rooms: input.rooms } : {}),
      ...(input.mealPlanName !== undefined
        ? { mealPlanName: input.mealPlanName?.trim() || null }
        : {}),
      ...(input.confirmationNumber !== undefined
        ? { confirmationNumber: input.confirmationNumber?.trim() || null }
        : {}),
      ...(input.bookingId !== undefined
        ? { bookingId: input.bookingId?.trim() || null }
        : {}),
      ...(input.confirmationNumberLabel !== undefined
        ? { confirmationNumberLabel: input.confirmationNumberLabel?.trim() || null }
        : {}),
      ...(input.bookingIdLabel !== undefined
        ? { bookingIdLabel: input.bookingIdLabel?.trim() || null }
        : {}),
      ...(input.specialRequests !== undefined
        ? { specialRequests: input.specialRequests?.trim() || null }
        : {}),
      ...(input.remarks !== undefined ? { remarks: input.remarks?.trim() || null } : {}),
      ...(input.termsSnapshot !== undefined
        ? { termsSnapshot: input.termsSnapshot?.trim() || null }
        : {}),
      updatedBy: { connect: { id: auth.userId } },
    };
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.hotelVoucher.update({ where: { id: current.id }, data });
      // Child rows are replaced wholesale when present in the payload (absent
      // means untouched), so removed rows leave no stale records behind.
      if (input.pricing !== undefined) {
        await tx.hotelVoucherPricing.deleteMany({ where: { voucherId: current.id } });
        if (input.pricing.length > 0) {
          await tx.hotelVoucherPricing.createMany({
            data: input.pricing.map((pricingRow, index) => ({
              companyId: auth.companyId,
              voucherId: current.id,
              sequence: index,
              roomType: pricingRow.roomType.trim(),
              unit: pricingRow.unit ?? 1,
              quantity: pricingRow.quantity ?? 1,
              gst: pricingRow.gst ?? null,
              amount: pricingRow.amount ?? null,
              taxablePay: pricingRow.taxablePay ?? null,
              gstService: pricingRow.gstService ?? null,
            })),
          });
        }
      }
      if (input.guests !== undefined) {
        await tx.hotelVoucherGuest.deleteMany({ where: { voucherId: current.id } });
        if (input.guests.length > 0) {
          await tx.hotelVoucherGuest.createMany({
            data: input.guests.map((guestRow, index) => ({
              companyId: auth.companyId,
              voucherId: current.id,
              sequence: index,
              guestName: guestRow.guestName.trim(),
              age: guestRow.age ?? null,
              sex: guestRow.sex,
              paxType: guestRow.paxType,
            })),
          });
        }
      }
      if (input.packageIncludes !== undefined) {
        await tx.hotelVoucherPackageInclude.deleteMany({ where: { voucherId: current.id } });
        if (input.packageIncludes.length > 0) {
          await tx.hotelVoucherPackageInclude.createMany({
            data: input.packageIncludes.map((item, index) => ({
              companyId: auth.companyId,
              voucherId: current.id,
              sequence: index,
              item: item.trim(),
            })),
          });
        }
      }
      await tx.activityLog.create({
        data: audit(auth, 'HOTEL_VOUCHER_UPDATED', 'HotelVoucher', current.id, context, {
          voucherNumber: current.voucherNumber,
          changedFields: Object.keys(input),
        }),
      });
      return row;
    });
    return presentVoucher(
      (await getVoucher(auth, updated.id)) as unknown as Record<string, unknown>,
    );
  },

  async remove(auth: AuthContext, voucherId: string, context: HotelVoucherRequestContext) {
    const current = await getVoucher(auth, voucherId);
    await prisma.$transaction(async (tx) => {
      await tx.hotelVoucherDocument.updateMany({
        where: { voucherId: current.id, companyId: auth.companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.hotelVoucher.update({
        where: { id: current.id },
        data: { deletedAt: new Date(), updatedBy: { connect: { id: auth.userId } } },
      });
      await tx.activityLog.create({
        data: audit(auth, 'HOTEL_VOUCHER_DELETED', 'HotelVoucher', current.id, context, {
          voucherNumber: current.voucherNumber,
        }),
      });
    });
    return { id: current.id, deleted: true };
  },

  /**
   * Render the voucher PDF from its stored snapshot and persist it as a
   * reusable HotelVoucherDocument (matched by exact file name). Never reads
   * live Hotel Master rows — issued vouchers stay historically accurate.
   */
  async generatePdf(auth: AuthContext, voucherId: string, context: HotelVoucherRequestContext) {
    const current = await getVoucher(auth, voucherId);
    const company = await loadCompanyBranding(auth.companyId);
    const pdf = await renderHotelVoucherPdf({
      company,
      voucher: {
        guestName: current.guestName,
        guestPhone: current.guestPhone,
        guestEmail: current.guestEmail,
        adults: current.adults,
        children: current.children,
        hotelName: current.hotelName,
        hotelAddress: current.hotelAddress,
        hotelCity: current.hotelCity,
        hotelPhone: current.hotelPhone,
        hotelEmail: current.hotelEmail,
        confirmationNumber: current.confirmationNumber,
        bookingId: current.bookingId,
        confirmationNumberLabel: current.confirmationNumberLabel,
        bookingIdLabel: current.bookingIdLabel,
        checkIn: current.checkIn,
        checkOut: current.checkOut,
        roomTypeName: current.roomTypeName,
        rooms: current.rooms,
        mealPlanName: current.mealPlanName,
        pricing: current.pricing.map((row) => ({
          roomType: row.roomType,
          unit: Number(row.unit),
          quantity: row.quantity,
          gst: row.gst === null ? null : Number(row.gst),
          amount: row.amount === null ? null : Number(row.amount),
          taxablePay: row.taxablePay === null ? null : Number(row.taxablePay),
          gstService: row.gstService === null ? null : Number(row.gstService),
        })),
        guests: current.guests.map((guest) => ({
          guestName: guest.guestName,
          age: guest.age,
          sex: guest.sex,
          paxType: guest.paxType,
        })),
        termsSnapshot: current.termsSnapshot,
        packageIncludes:
          current.packageIncludes.length > 0
            ? current.packageIncludes.map((entry) => entry.item)
            : null,
      },
    });
    const fileName = hotelVoucherFileName(current.voucherNumber);
    const existing = current.documents.find(
      (document) =>
        document.fileName === fileName &&
        document.mimeType === 'application/pdf' &&
        document.uploadStatus === 'AVAILABLE',
    );
    if (existing && (await storageService.headObject(existing.objectKey))) {
      const { objectKey: _objectKey, bucket: _bucket, companyId: _companyId, ...safe } = existing;
      return { ...safe, reused: true };
    }
    const checksum = crypto.createHash('sha256').update(pdf).digest('hex');
    const documentId = crypto.randomUUID();
    const objectKey = hotelVoucherObjectKey({
      companyId: auth.companyId,
      voucherId: current.id,
      documentId,
      fileName,
    });
    await storageService.putObject({
      key: objectKey,
      body: pdf,
      contentType: 'application/pdf',
      checksum,
    });
    const document = await prisma.$transaction(async (tx) => {
      const row = await tx.hotelVoucherDocument.create({
        data: {
          id: documentId,
          companyId: auth.companyId,
          voucherId: current.id,
          documentType: 'VOUCHER',
          storageProvider: storageService.provider,
          bucket: storageService.bucket,
          objectKey,
          fileName,
          mimeType: 'application/pdf',
          fileSize: pdf.length,
          checksum,
          uploadStatus: 'AVAILABLE',
          visibility: 'CUSTOMER_VISIBLE',
          uploadedById: auth.userId,
        },
      });
      await tx.activityLog.create({
        data: audit(
          auth,
          'HOTEL_VOUCHER_PDF_GENERATED',
          'HotelVoucherDocument',
          documentId,
          context,
          {
            voucherId: current.id,
            voucherNumber: current.voucherNumber,
          },
        ),
      });
      return row;
    });
    const { objectKey: _objectKey, bucket: _bucket, companyId: _companyId, ...safe } = document;
    return { ...safe, reused: false };
  },

  async downloadUrl(auth: AuthContext, voucherId: string, documentId: string) {
    const current = await getVoucher(auth, voucherId);
    const document = current.documents.find(
      (row) =>
        row.id === documentId &&
        row.uploadStatus === 'AVAILABLE' &&
        row.mimeType === 'application/pdf',
    );
    if (!document) throw new NotFoundError('Voucher document not found.');
    // User-facing filename only — storage keys and stored rows keep the
    // internal document name.
    const fileName = hotelVoucherDownloadFileName(
      current.query?.customerName ?? current.customer?.displayName ?? current.guestName,
      current.hotelName,
    );
    const url = await storageService.createDownloadUrl(
      document.objectKey,
      fileName,
      PRESIGN_TTL_SECONDS,
      'attachment',
    );
    return { url, fileName, expiresInSeconds: PRESIGN_TTL_SECONDS };
  },

  /**
   * Email the latest generated PDF (generating it first when missing).
   */
  async sendEmail(
    auth: AuthContext,
    voucherId: string,
    input: HotelVoucherEmailInput,
    context: HotelVoucherRequestContext,
  ) {
    const current = await getVoucher(auth, voucherId);
    const generated = (await this.generatePdf(auth, voucherId, context)) as { id: string };
    const document = await prisma.hotelVoucherDocument.findFirst({
      where: { id: generated.id, companyId: auth.companyId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Voucher document not found.');
    const body = await storageService.getObject(document.objectKey);
    if (!body) throw new NotFoundError('Voucher file is no longer available.');
    const subject =
      input.subject?.trim() || `Hotel Voucher ${current.voucherNumber} - ${current.hotelName}`;
    const message =
      input.message?.trim() ||
      `Dear ${current.guestName},\n\nPlease find attached your hotel voucher ${current.voucherNumber} for ${current.hotelName} (${current.checkIn.toISOString().slice(0, 10)} to ${current.checkOut.toISOString().slice(0, 10)}).\n\nPlease present this voucher at check-in along with a valid photo ID.`;
    await emailService.sendMessage({
      to: input.recipientEmail,
      subject,
      text: `${message}\n\n${current.hotelName} • ${current.hotelCity ?? ''}`.trim(),
      html: `<p>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`,
      attachments: [{ fileName: document.fileName, content: body, contentType: 'application/pdf' }],
    });
    return { sent: true, recipientEmail: input.recipientEmail, documentId: document.id };
  },
};

export function hotelVoucherFileName(voucherNumber: string): string {
  return sanitizeFileName(`hotel-voucher-${voucherNumber}.pdf`);
}

/**
 * User-facing download filename: `{Lead Name} - {Hotel Name}.pdf`.
 * Names come from the voucher's linked lead (else customer, else guest) and
 * its hotel snapshot. Invalid filename characters are removed, whitespace
 * is collapsed, and blanks fall back so the result is never empty.
 */
export function hotelVoucherDownloadFileName(
  leadName: string | null | undefined,
  hotelName: string | null | undefined,
): string {
  const clean = (value: string | null | undefined): string => {
    const printable = Array.from(value ?? '')
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 32;
        return code >= 32 && code !== 127;
      })
      .join('');
    return printable
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 120);
  };
  const lead = clean(leadName) || 'Hotel Voucher';
  const hotel = clean(hotelName) || 'Hotel Voucher';
  return `${lead} - ${hotel}.pdf`;
}

export { PRESIGN_TTL_SECONDS };
