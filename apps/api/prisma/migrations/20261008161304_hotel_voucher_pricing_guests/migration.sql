-- CreateEnum
CREATE TYPE "HotelVoucherGuestSex" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "HotelVoucherGuestPaxType" AS ENUM ('ADULT', 'CHILD');

-- CreateTable
CREATE TABLE "hotel_voucher_pricing" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "roomType" VARCHAR(160) NOT NULL,
    "unit" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "gst" DECIMAL(5,2),
    "amount" DECIMAL(14,2),
    "taxablePay" DECIMAL(14,2),
    "gstService" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_voucher_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_voucher_guests" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "guestName" VARCHAR(160) NOT NULL,
    "age" INTEGER,
    "sex" "HotelVoucherGuestSex" NOT NULL,
    "paxType" "HotelVoucherGuestPaxType" NOT NULL DEFAULT 'ADULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_voucher_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_voucher_pricing_companyId_voucherId_sequence_idx" ON "hotel_voucher_pricing"("companyId", "voucherId", "sequence");

-- CreateIndex
CREATE INDEX "hotel_voucher_guests_companyId_voucherId_sequence_idx" ON "hotel_voucher_guests"("companyId", "voucherId", "sequence");

-- AddForeignKey
ALTER TABLE "hotel_voucher_pricing" ADD CONSTRAINT "hotel_voucher_pricing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_pricing" ADD CONSTRAINT "hotel_voucher_pricing_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_guests" ADD CONSTRAINT "hotel_voucher_guests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_guests" ADD CONSTRAINT "hotel_voucher_guests_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
