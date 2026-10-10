-- AlterTable
ALTER TABLE "queries" ADD COLUMN     "adultNames" JSONB,
ADD COLUMN     "childWithBedNames" JSONB,
ADD COLUMN     "childWithoutBedNames" JSONB,
ADD COLUMN     "infantNames" JSONB;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "adultNames" JSONB,
ADD COLUMN     "childWithBedNames" JSONB,
ADD COLUMN     "childWithoutBedNames" JSONB,
ADD COLUMN     "infantNames" JSONB;
