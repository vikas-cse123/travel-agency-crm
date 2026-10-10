-- CreateTable
CREATE TABLE "hotel_voucher_stay_rooms" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "roomType" VARCHAR(160) NOT NULL,
    "rooms" INTEGER NOT NULL DEFAULT 1,
    "extraBedQuantity" INTEGER,
    "childWithoutBedQuantity" INTEGER,
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_voucher_stay_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hotel_voucher_stay_meals" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "mealPlan" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hotel_voucher_stay_meals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_voucher_stay_rooms_companyId_voucherId_sequence_idx" ON "hotel_voucher_stay_rooms"("companyId", "voucherId", "sequence");

-- CreateIndex
CREATE INDEX "hotel_voucher_stay_meals_companyId_voucherId_sequence_idx" ON "hotel_voucher_stay_meals"("companyId", "voucherId", "sequence");

-- AddForeignKey
ALTER TABLE "hotel_voucher_stay_rooms" ADD CONSTRAINT "hotel_voucher_stay_rooms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_stay_rooms" ADD CONSTRAINT "hotel_voucher_stay_rooms_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_stay_meals" ADD CONSTRAINT "hotel_voucher_stay_meals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotel_voucher_stay_meals" ADD CONSTRAINT "hotel_voucher_stay_meals_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "hotel_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
