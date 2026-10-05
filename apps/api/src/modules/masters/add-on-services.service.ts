import crypto from 'node:crypto';
import { Prisma, type MasterStatus } from '@prisma/client';
import {
  MASTER_TYPE,
  MAX_ADD_ON_PRICING_ENTRIES,
  PERMISSIONS,
  PRICING_LABEL_MAX,
  type AddOnServiceImageUploadInput,
  type AddOnServiceInput,
  type AddOnServiceUpdateInput,
} from '@interscale/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import type { AuthContext } from '../../middleware/authenticate.js';
import {
  addOnServiceImageObjectKey,
  storageService,
} from '../../services/storage/storage.service.js';
import { normalizeCustomerName } from '../../utils/normalize.js';
import {
  buildPaginationMeta,
  resolvePagination,
  toPrismaPagination,
} from '../../utils/pagination.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { permissionsService } from '../auth/permissions.service.js';
import {
  assertCanModifyMaster,
  buildVisibleWhere,
  masterRecordMeta,
  resolveMasterScope,
  type MasterScope,
} from './master-visibility.js';
import type { MastersRequestContext } from './airlines.service.js';
import { sanitizeRichText } from './masters.service.js';
import {
  appendMasterImage,
  collectMasterStorageKeys,
  deleteMasterStorageKeys,
  findMasterImage,
  masterImageWriteData,
  partitionKeysBySnapshotReferences,
  presentMasterImages,
  removeMasterImage,
  reorderMasterImages,
} from './master-images.js';

/**
 * Add-On Services Master.
 *
 * Reusable optional extras (visa assistance, insurance, arrival cards…). The
 * reference form has exactly four fields — name, description, price and an
 * active toggle — so this module deliberately has no category, pricing basis,
 * tax or internal cost, and therefore no costing permissions. Gallery images
 * mirror the hotel/sightseeing multi-image implementation.
 */

const PRESIGN_TTL = env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS;

const userSelect = { id: true, fullName: true } as const;
const has = (auth: AuthContext, permission: string) =>
  permissionsService.userHasPermission(auth.userId, permission);
const serviceInclude = {
  createdBy: { select: userSelect },
  updatedBy: { select: userSelect },
  destinations: {
    orderBy: { sequence: 'asc' as const },
    select: { destination: { select: { id: true, name: true } }, isDefault: true },
  },
} as const;

/** Maximum default add-on services per destination (each destination independent). */
export const MAX_DEFAULT_ADD_ONS_PER_DESTINATION = 20;

export type AddOnServiceDestinationLink = {
  destinationId: string;
  isDefault: boolean;
};

/**
 * Validate + normalize destination links: deduped (order preserved), every id
 * referencing a destination visible to this company. IDs stay authoritative;
 * names are always resolved through the link.
 */
async function resolveAddOnServiceDestinations(
  auth: AuthContext,
  destinations: unknown,
): Promise<AddOnServiceDestinationLink[]> {
  const seen = new Set<string>();
  const links: AddOnServiceDestinationLink[] = [];
  for (const entry of Array.isArray(destinations) ? destinations : []) {
    const destinationId =
      entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>).destinationId
        : undefined;
    if (typeof destinationId !== 'string' || !destinationId) continue;
    if (seen.has(destinationId)) continue;
    seen.add(destinationId);
    links.push({
      destinationId,
      isDefault:
        (entry as Record<string, unknown>).isDefault === true,
    });
  }
  if (!links.length) return [];
  const scope = await resolveMasterScope(auth, MASTER_TYPE.DESTINATION);
  const rows = await prisma.destination.findMany({
    where: { id: { in: links.map((link) => link.destinationId) }, ...buildVisibleWhere(scope) },
    select: { id: true },
  });
  if (rows.length !== links.length) {
    throw new ValidationError('One or more selected destinations are invalid.');
  }
  return links;
}

/** Flatten the ordered destination links for API responses. */
function presentAddOnServiceDestinations(
  row: Record<string, unknown>,
): Array<{ id: string; name: string; isDefault: boolean }> {
  const links = row.destinations;
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    const destination = (link as Record<string, unknown>)?.destination as
      | { id?: unknown; name?: unknown }
      | undefined;
    if (typeof destination?.id !== 'string' || typeof destination?.name !== 'string') return [];
    return [
      {
        id: destination.id,
        name: destination.name,
        isDefault: (link as Record<string, unknown>).isDefault === true,
      },
    ];
  });
}

/** One repeatable pricing option as stored in the `pricing` JSON column. */
export type StoredAddOnPricing = {
  id: string;
  label: string;
  price: number | null;
  currency: string;
};

const PRICING_PRICE_MAX = 99_999_999.99;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCurrencyCode(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'INR';
}

function normalizePriceValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > PRICING_PRICE_MAX) return null;
  return parsed;
}

/**
 * Normalize pricing entries for storage: stable UUID per entry (server fills
 * missing/invalid/duplicate ids), trimmed labels, validated prices and
 * currencies. Order preserved; capped at MAX_ADD_ON_PRICING_ENTRIES.
 */
export function normalizeAddOnPricing(entries: unknown): StoredAddOnPricing[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.slice(0, MAX_ADD_ON_PRICING_ENTRIES).map((entry) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    let id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : crypto.randomUUID();
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return {
      id,
      label: String(raw.label ?? '').trim().slice(0, PRICING_LABEL_MAX),
      price: normalizePriceValue(raw.price),
      currency: normalizeCurrencyCode(raw.currency),
    };
  });
}

/**
 * Read path: validated pricing entries from the JSON column. Falls back to a
 * single synthesized entry from the legacy price/currency/pricingBasis
 * columns so pre-migration rows (and any missed backfill) keep working.
 */
export function presentAddOnPricing(row: Record<string, unknown>): StoredAddOnPricing[] {
  const stored = normalizeAddOnPricing(row.pricing);
  if (stored.length) return stored;
  const priceRaw = row.price as unknown;
  let price: number | null = null;
  if (priceRaw != null) {
    const candidate =
      typeof (priceRaw as { toNumber?: unknown }).toNumber === 'function'
        ? Number((priceRaw as { toNumber(): number }).toNumber())
        : normalizePriceValue(priceRaw);
    price = Number.isFinite(candidate) ? (candidate as number) : null;
  }
  const basis = typeof row.pricingBasis === 'string' ? row.pricingBasis.trim() : '';
  if (price == null && !basis) return [];
  return [
    {
      id: crypto.randomUUID(),
      label: basis.slice(0, PRICING_LABEL_MAX),
      price: price != null && Number.isFinite(price) ? price : null,
      currency: normalizeCurrencyCode(row.currency),
    },
  ];
}

/** Legacy single-price columns mirror the first pricing entry (or clear). */
function legacyPricingColumns(entries: StoredAddOnPricing[]): {
  price: number | null;
  currency: string;
  pricingBasis: string | null;
} {
  const first = entries[0];
  if (!first) return { price: null, currency: 'INR', pricingBasis: null };
  return {
    price: first.price,
    currency: first.currency,
    pricingBasis: first.label ? first.label : null,
  };
}

/**
 * Enforce the per-destination default cap inside the write transaction. A
 * per-destination advisory lock serializes concurrent writers so two requests
 * cannot jointly exceed the cap.
 */
async function assertAddOnDefaultLimit(
  tx: Prisma.TransactionClient,
  companyId: string,
  destinationId: string,
  excludeServiceId?: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${destinationId}))`;
  const existing = await tx.addOnServiceDestination.count({
    where: {
      companyId,
      destinationId,
      isDefault: true,
      addOnService: { status: 'ACTIVE' },
      ...(excludeServiceId ? { addOnServiceId: { not: excludeServiceId } } : {}),
    },
  });
  if (existing >= MAX_DEFAULT_ADD_ONS_PER_DESTINATION) {
    throw new ValidationError(
      `This destination already has the maximum of ${MAX_DEFAULT_ADD_ONS_PER_DESTINATION} default add-on services. Unmark an existing default first.`,
    );
  }
}

function audit(
  auth: AuthContext,
  action: Prisma.ActivityLogUncheckedCreateInput['action'],
  entityId: string,
  context: MastersRequestContext,
  metadata?: Prisma.InputJsonValue,
): Prisma.ActivityLogUncheckedCreateInput {
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    action,
    entityType: 'AddOnService',
    entityId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Drop tenant internals; convert Decimal to a plain number for JSON. */
function present<T extends Record<string, unknown>>(row: T, scope: MasterScope) {
  const {
    companyId,
    normalizedName,
    imageBucket,
    imageObjectKey,
    imageStorageProvider,
    pendingImageObjectKey,
    pendingImageFileName,
    pendingImageMimeType,
    pendingImageFileSize,
    ...safe
  } = row;
  void companyId;
  void normalizedName;
  void imageBucket;
  void imageStorageProvider;
  void pendingImageObjectKey;
  void pendingImageFileName;
  void pendingImageMimeType;
  void pendingImageFileSize;
  const priceRaw = safe.price as Prisma.Decimal | null | undefined;
  return {
    ...safe,
    ...masterRecordMeta({ companyId: String(companyId) }, scope),
    price: priceRaw == null ? null : Number(priceRaw),
    hasImage: Boolean(imageObjectKey && row.imageConfirmedAt),
    images: presentMasterImages(row as unknown as Parameters<typeof presentMasterImages>[0]),
    destinations: presentAddOnServiceDestinations(row as Record<string, unknown>),
    pricing: presentAddOnPricing(row as Record<string, unknown>),
  };
}

/**
 * Resolve the stored pricing list for a write. An explicit `pricing` array
 * wins; legacy-only input synthesizes a single entry; otherwise undefined
 * ("leave untouched", update path).
 */
function resolvePricingForWrite(
  input: AddOnServiceInput | AddOnServiceUpdateInput,
): StoredAddOnPricing[] | undefined {
  if ('pricing' in input && input.pricing !== undefined)
    return normalizeAddOnPricing(input.pricing);
  if (!('price' in input || 'currency' in input || 'pricingBasis' in input)) return undefined;
  const price = normalizePriceValue((input as { price?: unknown }).price);
  const rawBasis = (input as { pricingBasis?: unknown }).pricingBasis;
  const basis = typeof rawBasis === 'string' ? rawBasis.trim().slice(0, PRICING_LABEL_MAX) : '';
  if (price == null && !basis) return [];
  return [
    {
      id: crypto.randomUUID(),
      label: basis,
      price,
      currency: normalizeCurrencyCode((input as { currency?: unknown }).currency),
    },
  ];
}

/** Persisted pricing columns (JSON list + legacy mirror) for create/update. */
function pricingWriteData(entries: StoredAddOnPricing[] | undefined) {
  if (entries === undefined) return {};
  return {
    pricing: (entries.length ? entries : null) as unknown as Prisma.InputJsonValue,
    ...legacyPricingColumns(entries),
  };
}

function duplicateError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    throw new ConflictError('An add-on service with that name already exists.');
  throw error;
}

async function canManage(auth: AuthContext) {
  return has(auth, PERMISSIONS.MASTER_ADD_ON_SERVICES_UPDATE);
}

async function getService(
  auth: AuthContext,
  serviceId: string,
  scope: MasterScope,
  forManage = false,
) {
  const canManageRows = forManage ? true : await canManage(auth);
  const row = await prisma.addOnService.findFirst({
    where: {
      id: serviceId,
      ...buildVisibleWhere(scope),
      ...(canManageRows ? {} : { status: 'ACTIVE' }),
    },
    include: serviceInclude,
  });
  if (!row) throw new NotFoundError('Add-on service not found.');
  return row;
}

function writeData(input: AddOnServiceInput | AddOnServiceUpdateInput) {
  const key = <K extends keyof (AddOnServiceInput & AddOnServiceUpdateInput)>(k: K) => k in input;
  return {
    ...(key('name')
      ? { name: input.name!.trim(), normalizedName: normalizeCustomerName(input.name!) }
      : {}),
    ...(key('description') ? { description: sanitizeRichText(input.description) } : {}),
    ...(key('price') ? { price: input.price ?? null } : {}),
    ...(key('currency') ? { currency: input.currency ?? 'INR' } : {}),
    ...(key('pricingBasis') ? { pricingBasis: input.pricingBasis?.trim() || null } : {}),
  };
}

export const addOnServicesService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const pagination = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || 10,
    });
    const canManageRows = await canManage(auth);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const status = query.status ? (String(query.status) as MasterStatus) : undefined;
    const destinationId =
      typeof query.destinationId === 'string' && query.destinationId ? query.destinationId : undefined;
    const defaultOnly = query.isDefault === true || query.isDefault === 'true';

    const where: Prisma.AddOnServiceWhereInput = {
      ...buildVisibleWhere(scope),
      ...(canManageRows ? { ...(status ? { status } : {}) } : { status: 'ACTIVE' }),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      ...(destinationId
        ? {
            destinations: {
              some: {
                destinationId,
                ...(defaultOnly ? { isDefault: true } : {}),
              },
            },
          }
        : defaultOnly
          ? { destinations: { some: { isDefault: true } } }
          : {}),
    };

    const order = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = String(query.sortBy ?? 'createdAt');
    const orderBy: Prisma.AddOnServiceOrderByWithRelationInput =
      sortBy === 'price'
        ? { price: order }
        : sortBy === 'createdAt'
          ? { createdAt: order }
          : sortBy === 'updatedAt'
            ? { updatedAt: order }
            : { name: order };

    const [rows, total] = await Promise.all([
      prisma.addOnService.findMany({
        where,
        ...toPrismaPagination(pagination),
        orderBy,
        include: serviceInclude,
      }),
      prisma.addOnService.count({ where }),
    ]);
    return {
      data: rows.map((row) => present(row as unknown as Record<string, unknown>, scope)),
      pagination: buildPaginationMeta(pagination, total),
    };
  },

  /** Lightweight selector feed: active services only. */
  async lookups(auth: AuthContext, query: Record<string, unknown>) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const services = await prisma.addOnService.findMany({
      where: {
        ...buildVisibleWhere(scope),
        status: 'ACTIVE',
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
      select: { id: true, name: true, price: true, currency: true },
    });
    return {
      addOnServices: services.map((row) => ({ ...row, price: row.price == null ? null : Number(row.price) })),
    };
  },

  async details(auth: AuthContext, serviceId: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    return present(
      (await getService(auth, serviceId, scope)) as unknown as Record<string, unknown>,
      scope,
    );
  },

  async create(auth: AuthContext, input: AddOnServiceInput, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const links =
      'destinations' in input ? await resolveAddOnServiceDestinations(auth, input.destinations) : [];
    const pricingEntries = resolvePricingForWrite(input) ?? [];
    try {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.addOnService.create({
          data: {
            companyId: auth.companyId,
            name: input.name.trim(),
            normalizedName: normalizeCustomerName(input.name),
            status: input.status,
            createdById: auth.userId,
            ...writeData(input),
            ...pricingWriteData(pricingEntries),
          },
          include: serviceInclude,
        });
        for (const link of links.filter((entry) => entry.isDefault)) {
          await assertAddOnDefaultLimit(tx, auth.companyId, link.destinationId);
        }
        if (links.length) {
          await tx.addOnServiceDestination.createMany({
            data: links.map((link, index) => ({
              companyId: auth.companyId,
              addOnServiceId: created.id,
              destinationId: link.destinationId,
              isDefault: link.isDefault,
              sequence: index,
            })),
          });
        }
        await tx.activityLog.create({
          data: audit(auth, 'ADD_ON_SERVICE_CREATED', created.id, context, {
            price: Number(created.price),
            currency: created.currency,
            sourceGlobal: scope.isSystemAdmin,
            ...('destinations' in input ? { destinations: links } : {}),
          }),
        });
        return tx.addOnService.findUniqueOrThrow({
          where: { id: created.id },
          include: serviceInclude,
        });
      });
      return present(row as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error);
    }
  },

  async update(
    auth: AuthContext,
    serviceId: string,
    input: AddOnServiceUpdateInput,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const current = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(current, scope);
    const links =
      'destinations' in input
        ? await resolveAddOnServiceDestinations(auth, input.destinations)
        : undefined;
    const pricingEntries = resolvePricingForWrite(input);
    try {
      const row = await prisma.$transaction(async (tx) => {
        await tx.addOnService.update({
          where: { id: current.id },
          data: {
            ...writeData(input),
            ...pricingWriteData(pricingEntries),
            updatedById: auth.userId,
            ...(input.status ? { status: input.status } : {}),
          },
          include: serviceInclude,
        });
        if (links !== undefined) {
          for (const link of links.filter((entry) => entry.isDefault)) {
            await assertAddOnDefaultLimit(tx, auth.companyId, link.destinationId, current.id);
          }
          await tx.addOnServiceDestination.deleteMany({ where: { addOnServiceId: current.id } });
          if (links.length) {
            await tx.addOnServiceDestination.createMany({
              data: links.map((link, index) => ({
                companyId: auth.companyId,
                addOnServiceId: current.id,
                destinationId: link.destinationId,
                isDefault: link.isDefault,
                sequence: index,
              })),
            });
          }
        }
        await tx.activityLog.create({
          data: audit(auth, 'ADD_ON_SERVICE_UPDATED', current.id, context, {
            changedFields: Object.keys(input),
          }),
        });
        return tx.addOnService.findUniqueOrThrow({
          where: { id: current.id },
          include: serviceInclude,
        });
      });
      return present(row as unknown as Record<string, unknown>, scope);
    } catch (error) {
      duplicateError(error);
    }
  },

  async status(
    auth: AuthContext,
    serviceId: string,
    status: MasterStatus,
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const current = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(current, scope);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.addOnService.update({
        where: { id: current.id },
        data: {
          status,
          updatedById: auth.userId,
        },
        include: serviceInclude,
      });
      await tx.activityLog.create({
        data: audit(auth, 'ADD_ON_SERVICE_STATUS_CHANGED', current.id, context, {
          previousStatus: current.status,
          status,
        }),
      });
      return updated;
    });
    return present(row as unknown as Record<string, unknown>, scope);
  },

  async createImageUpload(
    auth: AuthContext,
    serviceId: string,
    input: AddOnServiceImageUploadInput,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const row = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(row, scope);
    const max = env.ADD_ON_SERVICE_IMAGE_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (input.fileSize > max)
      throw new ValidationError(
        `Add-on service images must be ${env.ADD_ON_SERVICE_IMAGE_MAX_UPLOAD_SIZE_MB} MB or smaller.`,
      );
    const key = addOnServiceImageObjectKey({
      companyId: auth.companyId,
      addOnServiceId: serviceId,
      imageId: crypto.randomUUID(),
      fileName: input.fileName,
    });
    const oldPending = row.pendingImageObjectKey;
    await prisma.addOnService.update({
      where: { id: row.id },
      data: {
        pendingImageObjectKey: key,
        pendingImageFileName: input.fileName,
        pendingImageMimeType: input.mimeType,
        pendingImageFileSize: input.fileSize,
      },
    });
    if (oldPending && oldPending !== key) await storageService.deleteObject(oldPending);
    return {
      uploadUrl: await storageService.createUploadUrl(
        key,
        input.mimeType,
        input.fileSize,
        PRESIGN_TTL,
      ),
      expiresInSeconds: PRESIGN_TTL,
    };
  },

  async confirmImage(auth: AuthContext, serviceId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const row = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(row, scope);
    const key = row.pendingImageObjectKey;
    if (!key || !row.pendingImageFileName || !row.pendingImageMimeType || !row.pendingImageFileSize)
      throw new ValidationError('No add-on service image upload is awaiting confirmation.');
    const metadata = await storageService.headObject(key);
    if (!metadata) throw new ValidationError('The uploaded add-on service image could not be found.');
    if (
      metadata.size !== row.pendingImageFileSize ||
      metadata.contentType !== row.pendingImageMimeType
    )
      throw new ValidationError('Uploaded image metadata does not match the approved file.');
    const confirmedAt = new Date();
    const images = appendMasterImage(
      row,
      {
        objectKey: key,
        fileName: row.pendingImageFileName,
        mimeType: row.pendingImageMimeType,
        fileSize: row.pendingImageFileSize,
      },
      confirmedAt,
    );
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.addOnService.update({
        where: { id: row.id },
        data: {
          imageStorageProvider: storageService.provider,
          imageBucket: storageService.bucket,
          ...masterImageWriteData(images),
          pendingImageObjectKey: null,
          pendingImageFileName: null,
          pendingImageMimeType: null,
          pendingImageFileSize: null,
        },
        include: serviceInclude,
      });
      await tx.activityLog.create({
        data: audit(auth, 'ADD_ON_SERVICE_IMAGE_UPLOADED', row.id, context, {
          imageId: images.at(-1)!.id,
          mimeType: row.pendingImageMimeType,
          fileSize: row.pendingImageFileSize,
        }),
      });
      return saved;
    });
    return present(updated as unknown as Record<string, unknown>, scope);
  },

  async imageDownload(auth: AuthContext, serviceId: string, imageId?: string) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const row = await getService(auth, serviceId, scope);
    const image = findMasterImage(row, imageId);
    if (!image) throw new NotFoundError('Add-on service image not found.');
    return {
      url: await storageService.createDownloadUrl(image.objectKey, image.fileName, PRESIGN_TTL),
      expiresInSeconds: PRESIGN_TTL,
    };
  },

  async deleteImage(
    auth: AuthContext,
    serviceId: string,
    context: MastersRequestContext,
    imageId?: string,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const row = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(row, scope);
    const removed = removeMasterImage(row, imageId);
    if (!removed) throw new NotFoundError('Add-on service image not found.');
    await prisma.$transaction(async (tx) => {
      await tx.addOnService.update({
        where: { id: row.id },
        data: {
          ...masterImageWriteData(removed.images),
          imageStorageProvider: removed.images.length ? row.imageStorageProvider : null,
          imageBucket: removed.images.length ? row.imageBucket : null,
        },
      });
      await tx.activityLog.create({
        data: audit(auth, 'ADD_ON_SERVICE_IMAGE_DELETED', row.id, context, {
          imageId: removed.target.id,
          remainingImageCount: removed.images.length,
        }),
      });
    });
    return { deleted: true };
  },

  async reorderImages(
    auth: AuthContext,
    serviceId: string,
    imageIds: string[],
    context: MastersRequestContext,
  ) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const row = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(row, scope);
    const images = reorderMasterImages(row, imageIds);
    if (!images) throw new ValidationError('Image order must contain every current image once.');
    await prisma.$transaction(async (tx) => {
      await tx.addOnService.update({
        where: { id: row.id },
        data: masterImageWriteData(images),
      });
      await tx.activityLog.create({
        data: audit(auth, 'ADD_ON_SERVICE_UPDATED', row.id, context, {
          change: 'IMAGE_ORDER',
          imageIds,
        }),
      });
    });
    return this.details(auth, serviceId);
  },

  async remove(auth: AuthContext, serviceId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const current = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(current, scope);
    // Master-owned images only (gallery + legacy + pending). Quotation
    // snapshot images and pricing data live on quotations and are untouched;
    // keys still referenced by quotation snapshots are retained.
    const storageKeys = collectMasterStorageKeys(current, auth.companyId);
    const { deletable, retained } = await partitionKeysBySnapshotReferences(storageKeys);
    const s3Failures = await deleteMasterStorageKeys(deletable, {
      masterType: 'ADD_ON_SERVICE',
      masterId: current.id,
    });
    if (s3Failures.length > 0)
      throw new ValidationError(
        `Failed to delete ${s3Failures.length} associated file(s) from storage. Add-on service not deleted. Please retry.`,
      );
    const metadata = { name: current.name, retainedStorageFiles: retained.length };
    try {
      await prisma.$transaction(async (tx) => {
        // Destination/default mappings cascade automatically;
        // quotation/booking links are SetNull.
        await tx.addOnService.delete({ where: { id: current.id } });
        await tx.activityLog.create({
          data: audit(auth, 'ADD_ON_SERVICE_DELETED', current.id, context, metadata),
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003')
        throw new ConflictError(
          'Cannot delete this add-on service because it is being used by existing records.',
        );
      throw error;
    }
    return { deleted: true, id: current.id };
  },
};
