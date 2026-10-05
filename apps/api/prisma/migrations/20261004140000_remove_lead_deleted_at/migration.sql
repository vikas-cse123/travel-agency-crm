-- Lead hard delete: the Lead archive concept is removed entirely.
-- `queries.deletedAt` existed only for Lead soft-delete, so the column and
-- the indexes built on it are dropped. Rows are preserved: previously
-- archived leads (deletedAt != NULL) become regular visible leads again.
-- No data is deleted by this migration; no other table is touched.

ALTER TYPE "ActivityAction" ADD VALUE 'QUERY_DELETED';

DROP INDEX IF EXISTS "queries_companyId_customerId_deletedAt_idx";
DROP INDEX IF EXISTS "queries_companyId_leadStage_deletedAt_idx";
DROP INDEX IF EXISTS "queries_companyId_leadType_deletedAt_idx";
DROP INDEX IF EXISTS "queries_companyId_priority_deletedAt_idx";
DROP INDEX IF EXISTS "queries_companyId_assignedToId_deletedAt_idx";

ALTER TABLE "queries" DROP COLUMN IF EXISTS "deletedAt";

CREATE INDEX "queries_companyId_customerId_idx" ON "queries"("companyId", "customerId");
CREATE INDEX "queries_companyId_leadStage_idx" ON "queries"("companyId", "leadStage");
CREATE INDEX "queries_companyId_leadType_idx" ON "queries"("companyId", "leadType");
CREATE INDEX "queries_companyId_priority_idx" ON "queries"("companyId", "priority");
CREATE INDEX "queries_companyId_assignedToId_idx" ON "queries"("companyId", "assignedToId");
