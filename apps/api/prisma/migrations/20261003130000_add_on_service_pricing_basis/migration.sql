-- Add-On Service free-text pricing basis plus its quotation snapshot column.
-- AlterTable
ALTER TABLE "add_on_services" ADD COLUMN     "pricingBasis" VARCHAR(80);
-- AlterTable
ALTER TABLE "quotation_version_services" ADD COLUMN     "pricingBasisLabel" VARCHAR(80);
