-- Destination assignments for vehicle masters (0–10 destinations per vehicle).
-- Ordered links preserve the user's selection order; IDs stay authoritative.
CREATE TABLE "vehicle_destinations" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "destinationId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_destinations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_destinations_vehicleId_destinationId_key" ON "vehicle_destinations"("vehicleId", "destinationId");
CREATE INDEX "vehicle_destinations_companyId_destinationId_idx" ON "vehicle_destinations"("companyId", "destinationId");

ALTER TABLE "vehicle_destinations" ADD CONSTRAINT "vehicle_destinations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_destinations" ADD CONSTRAINT "vehicle_destinations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_destinations" ADD CONSTRAINT "vehicle_destinations_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
