-- CreateEnum
CREATE TYPE "HotelVoucherStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_UPDATED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_ISSUED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_CANCELLED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE 'HOTEL_VOUCHER_PDF_GENERATED';

-- AlterTable
ALTER TABLE "add_on_services" ALTER COLUMN "images" SET DATA TYPE JSON,
ALTER COLUMN "pricing" SET DATA TYPE JSON;

-- AlterTable
ALTER TABLE "quotation_template_services" ALTER COLUMN "pricingSnapshot" SET DATA TYPE JSON;

-- AlterTable
ALTER TABLE "quotation_version_services" ALTER COLUMN "pricingSnapshot" SET DATA TYPE JSON;

-- CreateTable
CREATE TABLE "hotel_voucher_counters" (
    "companyId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hotel_voucher_counters_pkey" PRIMARY KEY ("companyId","year")
);

-- CreateTable
CREATE TABLE "hotel_vouchers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherNumber" VARCHAR(24) NOT NULL,
    "status" "HotelVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATE,
    "customerId" UUID,
    "queryId" UUID,
    "hotelId" UUID,
    "guestName" VARCHAR(160) NOT NULL,
    "guestPhone" VARCHAR(32),
    "guestEmail" VARCHAR(255),
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "hotelName" VARCHAR(200) NOT NULL,
    "hotelAddress" VARCHAR(1000),
    "hotelCity" VARCHAR(100),
    "hotelPhone" VARCHAR(40),
    "hotelEmail" VARCHAR(255),
    "hotelStarRating" VARCHAR(20),
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "roomTypeName" VARCHAR(160),
    "rooms" INTEGER NOT NULL DEFAULT 1,
    "mealPlanName" VARCHAR(160),
    "confirmationNumber" VARCHAR(80),
    "specialRequests" VARCHAR(2000),
    "remarks" VARCHAR(2000),
    "termsSnapshot" TEXT,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hotel_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_voucher_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "documentType" VARCHAR(40) NOT NULL DEFAULT 'VOUCHER',
    "storageProvider" "StorageProvider" NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(1000) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" VARCHAR(128),
    "uploadStatus" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hotel_voucher_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_vouchers_companyId_status_deletedAt_idx" ON "hotel_vouchers"("companyId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "hotel_vouchers_companyId_guestName_idx" ON "hotel_vouchers"("companyId", "guestName");

-- CreateIndex
CREATE INDEX "hotel_vouchers_companyId_hotelName_idx" ON "hotel_vouchers"("companyId", "hotelName");

-- CreateIndex
CREATE INDEX "hotel_vouchers_companyId_checkIn_idx" ON "hotel_vouchers"("companyId", "checkIn");

-- CreateIndex
CREATE INDEX "hotel_vouchers_createdById_idx" ON "hotel_vouchers"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_vouchers_companyId_voucherNumber_key" ON "hotel_vouchers"("companyId", "voucherNumber");

-- CreateIndex
CREATE INDEX "hotel_voucher_documents_companyId_voucherId_deletedAt_idx" ON "hotel_voucher_documents"("companyId", "voucherId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hotel_voucher_documents_companyId_objectKey_key" ON "hotel_voucher_documents"("companyId", "objectKey");

-- AddForeignKey
ALTER TABLE "hotel_voucher_counters" ADD CONSTRAINT "hotel_voucher_counters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "hotels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_vouchers" ADD CONSTRAINT "hotel_vouchers_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_documents" ADD CONSTRAINT "hotel_voucher_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_documents" ADD CONSTRAINT "hotel_voucher_documents_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_documents" ADD CONSTRAINT "hotel_voucher_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
