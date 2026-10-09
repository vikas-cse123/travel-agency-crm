-- CreateTable
CREATE TABLE "hotel_voucher_package_includes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "item" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_voucher_package_includes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_voucher_package_includes_companyId_voucherId_sequence_idx" ON "hotel_voucher_package_includes"("companyId", "voucherId", "sequence");

-- AddForeignKey
ALTER TABLE "hotel_voucher_package_includes" ADD CONSTRAINT "hotel_voucher_package_includes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_package_includes" ADD CONSTRAINT "hotel_voucher_package_includes_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
