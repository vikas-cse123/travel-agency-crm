import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { prisma } from '../../config/prisma.js';
import { storageService } from '../../services/storage/storage.service.js';

export interface StoredMasterImage {
  id: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  confirmedAt: string;
}

export interface LegacyImageFields {
  images?: unknown;
  imageObjectKey: string | null;
  imageFileName: string | null;
  imageMimeType: string | null;
  imageFileSize: number | null;
  imageConfirmedAt: Date | null;
}

const isStoredImage = (value: unknown): value is StoredMasterImage => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.objectKey === 'string' &&
    typeof row.fileName === 'string' &&
    typeof row.mimeType === 'string' &&
    typeof row.fileSize === 'number' &&
    Number.isFinite(row.fileSize) &&
    typeof row.confirmedAt === 'string' &&
    Number.isFinite(Date.parse(row.confirmedAt))
  );
};

/** Ordered gallery with a lossless fallback for records created before galleries. */
export function effectiveMasterImages(row: LegacyImageFields): StoredMasterImage[] {
  if (Array.isArray(row.images)) {
    const images = row.images.filter(isStoredImage);
    if (images.length > 0) return images;
    // An explicitly empty array with no legacy columns is an intentional
    // removal. If legacy columns still exist, the row is in an inconsistent
    // state (e.g. older import that never wrote the gallery) — fall through
    // to the legacy fallback so the existing image is not hidden.
    if (row.images.length === 0 && !row.imageObjectKey) return images;
  }
  if (row.imageObjectKey && row.imageFileName && row.imageConfirmedAt) {
    return [
      {
        id: `legacy-${crypto
          .createHash('sha256')
          .update(row.imageObjectKey)
          .digest('hex')
          .slice(0, 32)}`,
        objectKey: row.imageObjectKey,
        fileName: row.imageFileName,
        mimeType: row.imageMimeType ?? 'image/jpeg',
        fileSize: row.imageFileSize ?? 0,
        confirmedAt: row.imageConfirmedAt.toISOString(),
      },
    ];
  }
  return [];
}

export function presentMasterImages(row: LegacyImageFields) {
  return effectiveMasterImages(row).map(({ id, fileName, mimeType, fileSize }, index) => ({
    id,
    fileName,
    mimeType,
    fileSize,
    isPrimary: index === 0,
  }));
}

export function appendMasterImage(
  row: LegacyImageFields,
  pending: { objectKey: string; fileName: string; mimeType: string; fileSize: number },
  confirmedAt = new Date(),
): StoredMasterImage[] {
  return [
    ...effectiveMasterImages(row),
    {
      id: crypto.randomUUID(),
      objectKey: pending.objectKey,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      fileSize: pending.fileSize,
      confirmedAt: confirmedAt.toISOString(),
    },
  ];
}

/**
 * Keeps the retained single-image columns aligned with the ordered gallery.
 * Those columns are intentionally not removed: older application versions and
 * legacy quotation code still read them as the primary-image fallback.
 */
export function masterImageWriteData(images: StoredMasterImage[]) {
  const primary = images[0] ?? null;
  return {
    images: images as unknown as Prisma.InputJsonValue,
    imageObjectKey: primary?.objectKey ?? null,
    imageFileName: primary?.fileName ?? null,
    imageMimeType: primary?.mimeType ?? null,
    imageFileSize: primary?.fileSize ?? null,
    imageConfirmedAt: primary ? new Date(primary.confirmedAt) : null,
  };
}

export function findMasterImage(row: LegacyImageFields, imageId?: string) {
  const images = effectiveMasterImages(row);
  return imageId ? images.find((image) => image.id === imageId) : images[0];
}

export function reorderMasterImages(row: LegacyImageFields, imageIds: string[]) {
  const images = effectiveMasterImages(row);
  if (imageIds.length !== images.length || new Set(imageIds).size !== images.length) return null;
  const byId = new Map(images.map((image) => [image.id, image]));
  const ordered = imageIds.map((id) => byId.get(id));
  return ordered.every(Boolean) ? (ordered as StoredMasterImage[]) : null;
}

export function removeMasterImage(row: LegacyImageFields, imageId?: string) {
  const images = effectiveMasterImages(row);
  const target = imageId ? images.find((image) => image.id === imageId) : images[0];
  if (!target) return null;
  return { target, images: images.filter((image) => image.id !== target.id) };
}

export interface MasterStorageRow {
  images?: unknown;
  imageObjectKey?: string | null;
  imageFileName?: string | null;
  imageMimeType?: string | null;
  imageFileSize?: number | null;
  imageConfirmedAt?: Date | null;
  pendingImageObjectKey?: string | null;
}

/** Normalize a possibly-partial row (e.g. airline logo rows) for image math. */
function asLegacyImageFields(row: MasterStorageRow): LegacyImageFields {
  return {
    images: row.images,
    imageObjectKey: row.imageObjectKey ?? null,
    imageFileName: row.imageFileName ?? null,
    imageMimeType: row.imageMimeType ?? null,
    imageFileSize: row.imageFileSize ?? null,
    imageConfirmedAt: row.imageConfirmedAt ?? null,
  };
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/**
 * Collect every S3 object key owned by a master row: confirmed gallery
 * images, the legacy single-image column and pending (unconfirmed) uploads.
 * Extra keys (e.g. airline logo columns) can be passed explicitly. Only keys
 * under this company's `masters/` prefix are returned, so quotation snapshot
 * objects or unrelated files can never be collected by mistake.
 */
export function collectMasterStorageKeys(
  row: Record<string, unknown>,
  companyId: string,
  extraKeys: Array<string | null | undefined> = [],
): string[] {
  const prefix = `companies/${companyId}/masters/`;
  const normalized = asLegacyImageFields({
    images: row.images,
    imageObjectKey: stringOrNull(row.imageObjectKey),
    imageFileName: stringOrNull(row.imageFileName),
    imageMimeType: stringOrNull(row.imageMimeType),
    imageFileSize: typeof row.imageFileSize === 'number' ? row.imageFileSize : null,
    imageConfirmedAt: row.imageConfirmedAt instanceof Date ? row.imageConfirmedAt : null,
  });
  const keys = new Set<string>();
  for (const image of effectiveMasterImages(normalized)) {
    if (image.objectKey?.trim()) keys.add(image.objectKey.trim());
  }
  if (normalized.imageObjectKey?.trim()) keys.add(normalized.imageObjectKey.trim());
  const pending = stringOrNull(row.pendingImageObjectKey);
  if (pending?.trim()) keys.add(pending.trim());
  for (const key of extraKeys) {
    if (key?.trim()) keys.add(key.trim());
  }
  return [...keys].filter((key) => key.startsWith(prefix));
}

/**
 * Delete owned storage objects BEFORE the database row is removed (the
 * project's S3-first compensation pattern: any failure aborts the operation
 * with the database left intact). Returns the keys that failed.
 */
export async function deleteMasterStorageKeys(
  keys: string[],
  context: { masterType: string; masterId: string },
): Promise<string[]> {
  const failures: string[] = [];
  for (const key of keys) {
    try {
      await storageService.deleteObject(key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error({ key, reason, ...context }, 'S3 delete failed during master hard delete');
      failures.push(key);
    }
  }
  return failures;
}

const escapeLikePattern = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * Split master-owned keys into deletable vs retained-by-quotations.
 *
 * Quotation snapshots store the MASTER's S3 key by reference (no byte copy),
 * so deleting a referenced object would silently break saved quotations,
 * weblinks and PDFs. Referenced objects are retained (exactly like today's
 * gallery-delete behavior, which already orphans S3 objects for this reason);
 * only unreferenced objects are removed.
 *
 * Scanned snapshot carriers: quotation hotel-option images, version service
 * images, and version-level hotel/flight/sightseeing snapshots. The scan is
 * deliberately company-agnostic: a System Global master's key can be
 * referenced by any tenant's quotation, and keys are globally unique by
 * company prefix so cross-tenant false matches are impossible.
 */
export async function partitionKeysBySnapshotReferences(
  keys: string[],
): Promise<{ deletable: string[]; retained: string[] }> {
  if (keys.length === 0) return { deletable: [], retained: [] };
  const patterns = keys.map((key) => `%${escapeLikePattern(key)}%`);
  const patternList = Prisma.join(patterns.map((pattern) => Prisma.sql`${pattern}`));
  const [hotelOptions, services, versions] = await Promise.all([
    prisma.$queryRaw<Array<{ images: unknown }>>`
      SELECT "images" AS "images" FROM "quotation_version_hotel_options"
      WHERE "images" IS NOT NULL
        AND "images"::text LIKE ANY (ARRAY[${patternList}])
    `,
    prisma.$queryRaw<Array<{ images: unknown }>>`
      SELECT "images" AS "images" FROM "quotation_version_services"
      WHERE "images" IS NOT NULL
        AND "images"::text LIKE ANY (ARRAY[${patternList}])
    `,
    prisma.$queryRaw<Array<{ hotelDetails: unknown; flightDetails: unknown; sightseeingDetails: unknown }>>`
      SELECT "hotelDetails" AS "hotelDetails", "flightDetails" AS "flightDetails",
        "sightseeingDetails" AS "sightseeingDetails"
      FROM "quotation_versions"
      WHERE "hotelDetails"::text LIKE ANY (ARRAY[${patternList}])
        OR "flightDetails"::text LIKE ANY (ARRAY[${patternList}])
        OR "sightseeingDetails"::text LIKE ANY (ARRAY[${patternList}])
    `,
  ]);
  const haystacks = [
    ...hotelOptions.map((row) => JSON.stringify(row.images)),
    ...services.map((row) => JSON.stringify(row.images)),
    ...versions.map((row) => JSON.stringify(row)),
  ];
  const retained = keys.filter((key) => haystacks.some((haystack) => haystack.includes(key)));
  const retainedSet = new Set(retained);
  return { deletable: keys.filter((key) => !retainedSet.has(key)), retained };
}
