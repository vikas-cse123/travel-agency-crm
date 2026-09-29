-- AlterTable
ALTER TABLE "destinations" ADD COLUMN     "childPolicy" TEXT;

-- AlterTable
ALTER TABLE "quotation_versions" ADD COLUMN     "childPolicy" VARCHAR(8000);
