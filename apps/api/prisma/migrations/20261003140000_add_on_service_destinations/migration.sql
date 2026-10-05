-- Add-On Service destination assignments with per-destination default flags.
-- CreateTable
CREATE TABLE "add_on_service_destinations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "addOnServiceId" UUID NOT NULL,
    "destinationId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "add_on_service_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "add_on_service_destinations_addOnServiceId_destinationId_key" ON "add_on_service_destinations"("addOnServiceId", "destinationId");

-- CreateIndex
CREATE INDEX "add_on_service_destinations_companyId_destinationId_idx" ON "add_on_service_destinations"("companyId", "destinationId");

-- AddForeignKey
ALTER TABLE "add_on_service_destinations" ADD CONSTRAINT "add_on_service_destinations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on_service_destinations" ADD CONSTRAINT "add_on_service_destinations_addOnServiceId_fkey" FOREIGN KEY ("addOnServiceId") REFERENCES "add_on_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_on_service_destinations" ADD CONSTRAINT "add_on_service_destinations_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
