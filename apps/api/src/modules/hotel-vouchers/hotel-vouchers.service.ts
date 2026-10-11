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
  hotelVoucherCurrentObjectKey,
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

/**
 * Date-only `YYYY-MM-DD` form/API value → instant for a DATE column.
 *
 * The form, contracts, and snapshots all carry calendar days, never moments
 * in time. Parsing as server-local midnight (`T00:00:00`) lands on the
 * previous UTC day east of Greenwich, and Postgres casts that instant to
 * DATE in the session timezone — silently storing the wrong day
 * (e.g. `2026-11-01` became `2026-10-31`). Noon UTC keeps the calendar day
 * for every realistic server/session timezone pairing, so saves, re-edits,
 * list filters, and night counts all stay on the selected day.
 */
const voucherDateOnly = (value: string): Date => new Date(`${value}T12:00:00Z`);

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

/**
 * Mirror the first stay row onto the legacy scalar columns (`roomTypeName`,
 * `mealPlanName`) when rows are supplied but the scalars are absent — the
 * same first-line-mirror convention quotations use for older readers (list
 * fallbacks, exports, any code path still reading the scalars). An
 * explicitly supplied scalar (including null) is never overwritten, and the
 * `rooms` total is always the caller's stated document total, never a
 * recomputed sum.
 */
function withStayScalarMirror<
  T extends {
    stayRooms?: Array<{ roomType?: string | null }> | undefined;
    stayMeals?: Array<{ mealPlan?: string | null }> | undefined;
    roomTypeName?: string | null | undefined;
    mealPlanName?: string | null | undefined;
  },
>(input: T): T {
  const rooms = Array.isArray(input.stayRooms) ? input.stayRooms : null;
  const meals = Array.isArray(input.stayMeals) ? input.stayMeals : null;
  const firstRoom = rooms && rooms.length > 0 ? rooms[0]?.roomType?.trim() : '';
  const firstMeal = meals && meals.length > 0 ? meals[0]?.mealPlan?.trim() : '';
  return {
    ...input,
    ...(rooms && rooms.length > 0 && input.roomTypeName === undefined
      ? { roomTypeName: firstRoom ? firstRoom : null }
      : {}),
    ...(meals && meals.length > 0 && input.mealPlanName === undefined
      ? { mealPlanName: firstMeal ? firstMeal : null }
      : {}),
  };
}

/** Mirror of the voucher form's star label: category wins, else rating. */
function voucherHotelStarLabel(
  starCategory: number | null | undefined,
  starRating: unknown,
): string | null {
  if (starCategory) return `${starCategory} Star`;
  const numeric =
    typeof starRating === 'object' && starRating !== null && 'toNumber' in starRating
      ? (starRating as { toNumber: () => number }).toNumber()
      : Number(starRating);
  if (starRating !== null && starRating !== undefined && Number.isFinite(numeric)) {
    return `${numeric} Star`;
  }
  return null;
}

type LinkedHotel = {
  companyId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  starCategory: number | null;
  starRating: unknown;
  city: { name: string } | null;
  company: { isSystem: boolean };
} | null;

/**
 * Live-linked hotel data for display and PDF generation.
 *
 * When a voucher links a hotel master visible to the caller's company (own
 * record or system-global), contact fields resolve from that current record
 * so legitimate master updates are reflected without a new voucher version.
 * Standalone vouchers (no link) and links whose master is missing, moved to
 * another tenant, or deleted keep their stored snapshot values, so existing
 * vouchers always stay usable. Voucher-owned fields (guests, stay dates,
 * confirmation/booking refs and labels, inclusions, terms) are never
 * overlaid — they have no authoritative external source.
 */
function applyLiveHotel<
  T extends {
    hotelId: string | null;
    hotelName: string;
    hotelAddress: string | null;
    hotelCity: string | null;
    hotelPhone: string | null;
    hotelEmail: string | null;
    hotelStarRating: string | null;
    hotel: LinkedHotel;
  },
>(row: T, authCompanyId: string): T {
  const hotel = row.hotelId ? row.hotel : null;
  if (!hotel) return row;
  const visible = hotel.companyId === authCompanyId || hotel.company.isSystem;
  // An invisible link (e.g. a foreign key set outside validation) must not
  // leak the other tenant's master through the joined relation either.
  if (!visible) return { ...row, hotel: null };
  return {
    ...row,
    hotelName: hotel.name,
    hotelAddress: hotel.address,
    hotelCity: hotel.city?.name ?? row.hotelCity,
    hotelPhone: hotel.phone,
    hotelEmail: hotel.email,
    hotelStarRating: voucherHotelStarLabel(hotel.starCategory, hotel.starRating),
  };
}

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
    stayRooms,
    stayMeals,
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
    stayRooms: Array.isArray(stayRooms)
      ? (stayRooms as Record<string, unknown>[]).map((entry) => {
          const {
            companyId: _companyId,
            voucherId: _voucherId,
            notes: _notes,
            ...safeEntry
          } = entry;
          return {
            ...safeEntry,
            // Historical rows predate the Extra Bed column (NULL) — read as 0.
            extraBedQuantity:
              typeof entry.extraBedQuantity === 'number' ? entry.extraBedQuantity : 0,
          };
        })
      : [],
    stayMeals: Array.isArray(stayMeals)
      ? (stayMeals as Record<string, unknown>[]).map((entry) => {
          const { companyId: _companyId, voucherId: _voucherId, ...safeEntry } = entry;
          return safeEntry;
        })
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
          companyId: true,
          name: true,
          address: true,
          phone: true,
          email: true,
          starCategory: true,
          starRating: true,
          status: true,
          city: { select: { name: true } },
          company: { select: { isSystem: true } },
        },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' as const },
      },
      pricing: { orderBy: { sequence: 'asc' as const } },
      guests: { orderBy: { sequence: 'asc' as const } },
      packageIncludes: { orderBy: { sequence: 'asc' as const } },
      stayRooms: { orderBy: { sequence: 'asc' as const } },
      stayMeals: { orderBy: { sequence: 'asc' as const } },
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
      // No explicit default: resolvePagination falls back to the shared
      // DEFAULT_PAGE_SIZE (20), matching every other server-paginated list.
      pageSize: Number(query.pageSize) || undefined,
    });
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const hotelId = typeof query.hotelId === 'string' && query.hotelId ? query.hotelId : undefined;
    const from =
      typeof query.from === 'string' && query.from ? voucherDateOnly(query.from) : null;
    const to = typeof query.to === 'string' && query.to ? voucherDateOnly(query.to) : null;
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
          createdBy: { select: userSelect },
          hotel: {
            select: {
              companyId: true,
              name: true,
              address: true,
              phone: true,
              email: true,
              starCategory: true,
              starRating: true,
              city: { select: { name: true } },
              company: { select: { isSystem: true } },
            },
          },
        },
      }),
      prisma.hotelVoucher.count({ where }),
    ]);
    return {
      data: rows.map((row) => presentVoucher(applyLiveHotel(row, auth.companyId))),
      pagination: buildPaginationMeta(pagination, total),
    };
  },

  async details(auth: AuthContext, voucherId: string) {
    return presentVoucher(applyLiveHotel(await getVoucher(auth, voucherId), auth.companyId));
  },

  async create(auth: AuthContext, input: HotelVoucherInput, context: HotelVoucherRequestContext) {
    await validateVoucherRefs(auth, input);
    await validateQuotationRefs(auth, input);
    // First stay row mirrors onto the legacy scalar columns when the caller
    // supplies rows without scalars (see withStayScalarMirror).
    const stay = withStayScalarMirror(input);
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
            checkIn: voucherDateOnly(input.checkIn),
            checkOut: voucherDateOnly(input.checkOut),
            roomTypeName: stay.roomTypeName?.trim() || null,
            rooms: input.rooms ?? 1,
            mealPlanName: stay.mealPlanName?.trim() || null,
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
            stayRooms: {
              create: (input.stayRooms ?? []).map((row, index) => ({
                companyId: auth.companyId,
                sequence: index,
                roomType: row.roomType.trim(),
                rooms: row.rooms ?? 1,
                extraBedQuantity: row.extraBedQuantity ?? 0,
              })),
            },
            stayMeals: {
              create: (input.stayMeals ?? []).map((row, index) => ({
                companyId: auth.companyId,
                sequence: index,
                mealPlan: row.mealPlan.trim(),
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
    const checkIn = input.checkIn ? voucherDateOnly(input.checkIn) : current.checkIn;
    const checkOut = input.checkOut ? voucherDateOnly(input.checkOut) : current.checkOut;
    if (checkOut <= checkIn) throw new ValidationError('Check-out must be after check-in.');
    // Same first-row scalar mirror as create; explicit scalars still win.
    const stay = withStayScalarMirror(input);
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
      ...(stay.roomTypeName !== undefined
        ? { roomTypeName: stay.roomTypeName?.trim() || null }
        : {}),
      ...(input.rooms !== undefined ? { rooms: input.rooms } : {}),
      ...(stay.mealPlanName !== undefined
        ? { mealPlanName: stay.mealPlanName?.trim() || null }
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
      if (input.stayRooms !== undefined) {
        await tx.hotelVoucherStayRoom.deleteMany({ where: { voucherId: current.id } });
        if (input.stayRooms.length > 0) {
          await tx.hotelVoucherStayRoom.createMany({
            data: input.stayRooms.map((stayRow, index) => ({
              companyId: auth.companyId,
              voucherId: current.id,
              sequence: index,
              roomType: stayRow.roomType.trim(),
              rooms: stayRow.rooms ?? 1,
              extraBedQuantity: stayRow.extraBedQuantity ?? 0,
            })),
          });
        }
      }
      if (input.stayMeals !== undefined) {
        await tx.hotelVoucherStayMeal.deleteMany({ where: { voucherId: current.id } });
        if (input.stayMeals.length > 0) {
          await tx.hotelVoucherStayMeal.createMany({
            data: input.stayMeals.map((stayRow, index) => ({
              companyId: auth.companyId,
              voucherId: current.id,
              sequence: index,
              mealPlan: stayRow.mealPlan.trim(),
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
      // The stored PDF would otherwise keep showing pre-edit content: retire
      // the voucher's live documents so the next Open/Download regenerates
      // from the just-saved data into the single current object.
      await tx.hotelVoucherDocument.updateMany({
        where: { voucherId: current.id, companyId: auth.companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return row;
    });
    // Drop retired bytes after commit (voucher-scoped keys only), so at most
    // one stored PDF exists per voucher and a failed save never loses the PDF.
    for (const stale of current.documents) {
      try {
        await storageService.deleteObject(stale.objectKey);
      } catch {
        // Storage already missing the key: the database row is already gone.
      }
    }
    return presentVoucher(
      applyLiveHotel(await getVoucher(auth, updated.id), auth.companyId),
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
    // No stored PDF may outlive its voucher: drop the retired bytes
    // (voucher-scoped keys only) after the delete commits.
    for (const stale of current.documents) {
      try {
        await storageService.deleteObject(stale.objectKey);
      } catch {
        // Storage already missing the key: the database row is already gone.
      }
    }
    return { id: current.id, deleted: true };
  },

  /**
   * Render the voucher PDF from current data and persist it as the voucher's
   * single current document. Linked hotel fields resolve live (see
   * applyLiveHotel); voucher-owned fields come from the stored snapshot.
   * Regenerations overwrite one stable object and one live database row, so
   * no historical PDF copies accumulate.
   */
  async generatePdf(auth: AuthContext, voucherId: string, context: HotelVoucherRequestContext) {
    const current = applyLiveHotel(await getVoucher(auth, voucherId), auth.companyId);
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
        // Room/meal rows, falling back to the legacy scalars for vouchers
        // saved before stay rows existed (single room/meal snapshots).
        stayRooms:
          current.stayRooms.length > 0
            ? current.stayRooms.map((row) => ({
                roomType: row.roomType,
                rooms: row.rooms,
                extraBedQuantity: row.extraBedQuantity ?? 0,
              }))
            : current.roomTypeName
              ? [
                  {
                    roomType: current.roomTypeName,
                    rooms: current.rooms,
                    extraBedQuantity: 0,
                  },
                ]
              : [],
        stayMeals:
          current.stayMeals.length > 0
            ? current.stayMeals.map((row) => ({ mealPlan: row.mealPlan }))
            : current.mealPlanName
              ? [{ mealPlan: current.mealPlanName }]
              : [],
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
    // Single current PDF: every generation renders fresh (live linked data)
    // into one stable object. The live database row for that key is revived
    // in place (stable id); every other row for the voucher — current or
    // retired, including legacy version-specific keys — is hard-deleted, so
    // exactly one live document exists afterwards. Unique constraints count
    // soft-deleted rows, so resurrecting the keeper (rather than creating
    // alongside it) is what keeps the key collision-free.
    const objectKey = hotelVoucherCurrentObjectKey({
      companyId: auth.companyId,
      voucherId: current.id,
    });
    const checksum = crypto.createHash('sha256').update(pdf).digest('hex');
    await storageService.putObject({
      key: objectKey,
      body: pdf,
      contentType: 'application/pdf',
      checksum,
    });
    const document = await prisma.$transaction(async (tx) => {
      const prior = await tx.hotelVoucherDocument.findMany({
        where: { voucherId: current.id, companyId: auth.companyId },
      });
      const keeper = prior.find((row) => row.objectKey === objectKey) ?? null;
      const stale = prior.filter((row) => (keeper ? row.id !== keeper.id : true));
      if (stale.length > 0) {
        await tx.hotelVoucherDocument.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
      }
      const row = keeper
        ? await tx.hotelVoucherDocument.update({
            where: { id: keeper.id },
            data: {
              deletedAt: null,
              fileName,
              mimeType: 'application/pdf',
              fileSize: pdf.length,
              checksum,
              uploadStatus: 'AVAILABLE',
              visibility: 'CUSTOMER_VISIBLE',
              uploadedById: auth.userId,
            },
          })
        : await tx.hotelVoucherDocument.create({
            data: {
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
          row.id,
          context,
          {
            voucherId: current.id,
            voucherNumber: current.voucherNumber,
          },
        ),
      });
      return { row, staleKeys: stale.map((entry) => entry.objectKey) };
    });
    // Remove superseded bytes only after the new object and row commit, so a
    // failed generation never leaves the voucher without a PDF. Scoped to
    // this voucher's own retired keys — never bucket-wide, never the live key.
    for (const key of document.staleKeys) {
      if (key === objectKey) continue;
      try {
        await storageService.deleteObject(key);
      } catch {
        // Storage already missing the key: the database row is already gone.
      }
    }
    const { objectKey: _objectKey, bucket: _bucket, companyId: _companyId, ...safe } = document.row;
    return { ...safe, reused: false };
  },

  async downloadUrl(auth: AuthContext, voucherId: string, documentId: string) {
    const current = applyLiveHotel(await getVoucher(auth, voucherId), auth.companyId);
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
