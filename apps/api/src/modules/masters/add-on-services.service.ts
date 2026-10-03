import crypto from 'node:crypto';
import { Prisma, type MasterStatus } from '@prisma/client';
import {
  MASTER_TYPE,
  PERMISSIONS,
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
  findMasterImage,
  masterImageWriteData,
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
} as const;

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
    deletedAt,
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
  void deletedAt;
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
      ...(canManageRows ? {} : { status: 'ACTIVE', deletedAt: null }),
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

    const where: Prisma.AddOnServiceWhereInput = {
      ...buildVisibleWhere(scope),
      ...(canManageRows
        ? status === 'ARCHIVED'
          ? { status: 'ARCHIVED' }
          : { deletedAt: null, ...(status ? { status } : {}) }
        : { status: 'ACTIVE', deletedAt: null }),
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
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
        deletedAt: null,
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
          },
          include: serviceInclude,
        });
        await tx.activityLog.create({
          data: audit(auth, 'ADD_ON_SERVICE_CREATED', created.id, context, {
            price: Number(created.price),
            currency: created.currency,
            sourceGlobal: scope.isSystemAdmin,
          }),
        });
        return created;
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
    try {
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.addOnService.update({
          where: { id: current.id },
          data: {
            ...writeData(input),
            updatedById: auth.userId,
            ...(input.status
              ? { status: input.status, deletedAt: input.status === 'ARCHIVED' ? new Date() : null }
              : {}),
          },
          include: serviceInclude,
        });
        await tx.activityLog.create({
          data: audit(auth, 'ADD_ON_SERVICE_UPDATED', current.id, context, {
            changedFields: Object.keys(input),
          }),
        });
        return updated;
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
          deletedAt: status === 'ARCHIVED' ? new Date() : null,
        },
        include: serviceInclude,
      });
      const action =
        current.status === 'ARCHIVED' && status !== 'ARCHIVED'
          ? 'ADD_ON_SERVICE_RESTORED'
          : 'ADD_ON_SERVICE_STATUS_CHANGED';
      await tx.activityLog.create({
        data: audit(auth, action, current.id, context, {
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

  async archive(auth: AuthContext, serviceId: string, context: MastersRequestContext) {
    const scope = await resolveMasterScope(auth, MASTER_TYPE.ADD_ON_SERVICE);
    const current = await getService(auth, serviceId, scope, true);
    assertCanModifyMaster(current, scope);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.addOnService.update({
        where: { id: current.id },
        data: { status: 'ARCHIVED', deletedAt: new Date(), updatedById: auth.userId },
        include: serviceInclude,
      });
      await tx.activityLog.create({
        data: audit(auth, 'ADD_ON_SERVICE_ARCHIVED', current.id, context),
      });
      return updated;
    });
    return present(row as unknown as Record<string, unknown>, scope);
  },
};
