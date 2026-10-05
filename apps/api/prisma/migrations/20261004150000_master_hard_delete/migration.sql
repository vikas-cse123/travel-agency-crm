-- Master hard delete: remove the Master archive/soft-delete model.
-- `status='ARCHIVED' + deletedAt` is replaced by permanent row deletion.
-- Rows are preserved: historical ARCHIVED masters are normalized to INACTIVE
-- (still hidden from ACTIVE-only selectors) instead of being deleted.
-- No data is deleted by this migration; no other table is touched.

ALTER TYPE "ActivityAction" ADD VALUE 'CITY_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'DESTINATION_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'AIRLINE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'CRUISE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'VEHICLE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'SIGHTSEEING_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'ADD_ON_SERVICE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'VISA_TYPE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'TESTIMONIAL_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'FAQ_DELETED';

-- Normalize historical archive state to INACTIVE. Rows stay in the database.
UPDATE "cities" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "destinations" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "hotels" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "airlines" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "cruises" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "vehicles" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "sightseeings" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "add_on_services" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "visa_types" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "testimonials" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "faqs" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "hotel_room_types" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "hotel_meal_plans" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';
UPDATE "cruise_room_types" SET "status" = 'INACTIVE' WHERE "status" = 'ARCHIVED';

DROP INDEX IF EXISTS "cities_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "destinations_companyId_destinationType_status_deletedAt_idx";
DROP INDEX IF EXISTS "hotels_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "airlines_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "sightseeings_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "add_on_services_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "visa_types_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "testimonials_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "faqs_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "cruises_companyId_status_deletedAt_idx";
DROP INDEX IF EXISTS "vehicles_companyId_status_deletedAt_idx";

ALTER TABLE "cities" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "destinations" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "hotels" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "airlines" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "cruises" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "vehicles" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "sightseeings" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "add_on_services" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "visa_types" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "testimonials" DROP COLUMN IF EXISTS "deletedAt";
ALTER TABLE "faqs" DROP COLUMN IF EXISTS "deletedAt";

CREATE INDEX "cities_companyId_status_idx" ON "cities"("companyId", "status");
CREATE INDEX "destinations_companyId_destinationType_status_idx" ON "destinations"("companyId", "destinationType", "status");
CREATE INDEX "hotels_companyId_status_idx" ON "hotels"("companyId", "status");
CREATE INDEX "airlines_companyId_status_idx" ON "airlines"("companyId", "status");
CREATE INDEX "cruises_companyId_status_idx" ON "cruises"("companyId", "status");
CREATE INDEX "vehicles_companyId_status_idx" ON "vehicles"("companyId", "status");
CREATE INDEX "sightseeings_companyId_status_idx" ON "sightseeings"("companyId", "status");
CREATE INDEX "add_on_services_companyId_status_idx" ON "add_on_services"("companyId", "status");
CREATE INDEX "visa_types_companyId_status_idx" ON "visa_types"("companyId", "status");
CREATE INDEX "testimonials_companyId_status_idx" ON "testimonials"("companyId", "status");
CREATE INDEX "faqs_companyId_status_idx" ON "faqs"("companyId", "status");
