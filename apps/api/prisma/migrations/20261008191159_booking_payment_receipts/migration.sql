-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'BOOKING_PAYMENT_RECEIPT_GENERATED';

-- AlterTable
ALTER TABLE "booking_counters" ADD COLUMN     "receiptValue" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "booking_payment_receipts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
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

    CONSTRAINT "booking_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_receipts_paymentId_key" ON "booking_payment_receipts"("paymentId");

-- CreateIndex
CREATE INDEX "booking_payment_receipts_companyId_bookingId_createdAt_idx" ON "booking_payment_receipts"("companyId", "bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_receipts_companyId_receiptNumber_key" ON "booking_payment_receipts"("companyId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "booking_payment_receipts_companyId_objectKey_key" ON "booking_payment_receipts"("companyId", "objectKey");

-- AddForeignKey
ALTER TABLE "booking_payment_receipts" ADD CONSTRAINT "booking_payment_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment_receipts" ADD CONSTRAINT "booking_payment_receipts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment_receipts" ADD CONSTRAINT "booking_payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "booking_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_payment_receipts" ADD CONSTRAINT "booking_payment_receipts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
