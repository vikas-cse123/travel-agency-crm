-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'CUSTOMER_PAYMENT_RECORDED';
ALTER TYPE "ActivityAction" ADD VALUE 'CUSTOMER_PAYMENT_REVERSED';
ALTER TYPE "ActivityAction" ADD VALUE 'CUSTOMER_PAYMENT_RECEIPT_GENERATED';

-- CreateTable
CREATE TABLE "payment_counters" (
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "paymentValue" INTEGER NOT NULL DEFAULT 0,
    "receiptValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_counters_pkey" PRIMARY KEY ("companyId","year")
);

-- CreateTable
CREATE TABLE "payment_cases" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID,
    "queryId" UUID,
    "customerName" VARCHAR(160) NOT NULL,
    "customerPhone" VARCHAR(32),
    "customerEmail" VARCHAR(255),
    "title" VARCHAR(200) NOT NULL,
    "tripAmount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "paymentNumber" VARCHAR(24) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentRecordStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "referenceNumber" VARCHAR(255),
    "bankName" VARCHAR(200),
    "notes" VARCHAR(2000),
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "reversedById" UUID,
    "reversalReason" VARCHAR(2000),

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "receiptNumber" VARCHAR(24) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(1000) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" VARCHAR(128),
    "uploadStatus" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_cases_companyId_customerId_idx" ON "payment_cases"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "payment_cases_companyId_queryId_idx" ON "payment_cases"("companyId", "queryId");

-- CreateIndex
CREATE INDEX "payment_cases_companyId_customerName_idx" ON "payment_cases"("companyId", "customerName");

-- CreateIndex
CREATE INDEX "payment_cases_companyId_createdAt_idx" ON "payment_cases"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_caseId_createdAt_idx" ON "customer_payments"("companyId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_payments_companyId_receivedAt_idx" ON "customer_payments"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_companyId_paymentNumber_key" ON "customer_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_paymentId_key" ON "payment_receipts"("paymentId");

-- CreateIndex
CREATE INDEX "payment_receipts_companyId_createdAt_idx" ON "payment_receipts"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_companyId_receiptNumber_key" ON "payment_receipts"("companyId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_companyId_objectKey_key" ON "payment_receipts"("companyId", "objectKey");

-- AddForeignKey
ALTER TABLE "payment_counters" ADD CONSTRAINT "payment_counters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_cases" ADD CONSTRAINT "payment_cases_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "payment_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activate standalone Payments permissions. Grants are additive and limited
-- to system roles and the four shipped permission templates.
INSERT INTO "permissions" ("id", "key", "module", "action", "description", "isAvailable", "createdAt")
VALUES
  (gen_random_uuid(), 'payments.view', 'payments', 'view', 'View standalone customer payments', true, NOW()),
  (gen_random_uuid(), 'payments.create', 'payments', 'create', 'Record standalone customer payments', true, NOW()),
  (gen_random_uuid(), 'payments.edit', 'payments', 'edit', 'Edit standalone payment details', true, NOW()),
  (gen_random_uuid(), 'payments.reverse', 'payments', 'reverse', 'Reverse standalone customer payments', true, NOW()),
  (gen_random_uuid(), 'payments.view_receipts', 'payments', 'view_receipts', 'View standalone payment vouchers', true, NOW()),
  (gen_random_uuid(), 'payments.generate_receipts', 'payments', 'generate_receipts', 'Generate standalone payment vouchers', true, NOW())
ON CONFLICT ("key") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description",
  "isAvailable" = true;

INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON (
  r."name" IN ('Owner', 'Manager')
  OR (r."name" = 'Sales Executive' AND p."key" IN (
    'payments.view', 'payments.create', 'payments.view_receipts', 'payments.generate_receipts'
  ))
  OR (r."name" = 'View Only' AND p."key" = 'payments.view')
)
WHERE r."isSystem" = true AND p."key" LIKE 'payments.%'
ON CONFLICT DO NOTHING;

INSERT INTO "permission_template_permissions" ("templateId", "permissionId", "createdAt")
SELECT t."id", p."id", NOW()
FROM "permission_templates" t
JOIN "permissions" p ON (
  t."name" = 'Manager'
  OR (t."name" = 'Sales Executive' AND p."key" IN (
    'payments.view', 'payments.create', 'payments.view_receipts', 'payments.generate_receipts'
  ))
  OR (t."name" = 'View Only' AND p."key" = 'payments.view')
)
WHERE t."deletedAt" IS NULL
  AND t."name" IN ('Manager', 'Sales Executive', 'Data Entry', 'View Only')
  AND p."key" LIKE 'payments.%'
ON CONFLICT DO NOTHING;
