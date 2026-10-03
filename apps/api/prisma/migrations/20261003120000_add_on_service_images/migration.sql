-- Add-On Service gallery images mirror the hotel/sightseeing multi-image columns.
-- AlterTable
ALTER TABLE "add_on_services" ADD COLUMN     "imageStorageProvider" "StorageProvider",
ADD COLUMN     "imageBucket" VARCHAR(255),
ADD COLUMN     "imageObjectKey" VARCHAR(1000),
ADD COLUMN     "imageFileName" VARCHAR(255),
ADD COLUMN     "imageMimeType" VARCHAR(120),
ADD COLUMN     "imageFileSize" INTEGER,
ADD COLUMN     "imageConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "pendingImageObjectKey" VARCHAR(1000),
ADD COLUMN     "pendingImageFileName" VARCHAR(255),
ADD COLUMN     "pendingImageMimeType" VARCHAR(120),
ADD COLUMN     "pendingImageFileSize" INTEGER,
ADD COLUMN     "images" JSONB;

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ADD_ON_SERVICE_IMAGE_UPLOADED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ADD_ON_SERVICE_IMAGE_REPLACED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ADD_ON_SERVICE_IMAGE_DELETED';

-- Register and grant the add-on-service image permission.
-- Mirrors the Phase 13D activation migration. Idempotent.

INSERT INTO "permissions" ("id", "key", "module", "action", "description", "isAvailable", "createdAt") VALUES
  (gen_random_uuid(), 'masters.add_on_services.manage_media', 'masters.add_on_services', 'manage_media', 'Manage add-on service images', true, NOW())
ON CONFLICT ("key") DO UPDATE SET "module" = EXCLUDED."module", "action" = EXCLUDED."action", "description" = EXCLUDED."description", "isAvailable" = true;

-- Owner/Manager get everything; Data Entry maintains master data like the
-- sightseeing image grant; view-only roles stay view-only.
INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW() FROM "roles" r JOIN "permissions" p ON (
  r."name" IN ('Owner', 'Manager')
  OR (r."name" = 'Data Entry' AND p."key" IN ('masters.add_on_services.manage_media'))
)
WHERE r."isSystem" = true AND p."module" IN ('masters.add_on_services') ON CONFLICT DO NOTHING;

INSERT INTO "permission_template_permissions" ("templateId", "permissionId", "createdAt")
SELECT t."id", p."id", NOW() FROM "permission_templates" t JOIN "permissions" p ON (
  t."name" = 'Manager'
  OR (t."name" = 'Data Entry' AND p."key" IN ('masters.add_on_services.manage_media'))
)
WHERE t."deletedAt" IS NULL AND t."name" IN ('Manager', 'Data Entry')
  AND p."module" IN ('masters.add_on_services') ON CONFLICT DO NOTHING;
