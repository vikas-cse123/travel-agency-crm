-- AlterTable
-- Quotation Builder "Booking Terms & Conditions" legitimately exceeds 8000
-- characters (detailed travel terms + rich-text HTML markup). TEXT removes the
-- artificial DB cap; the 20,000 app-level limit is enforced identically by the
-- frontend form and the API via QUOTATION_BOOKING_TERMS_MAX_LENGTH in
-- packages/shared/src/quotations.ts. VARCHAR -> TEXT is safe and preserves all
-- existing quotation records.
ALTER TABLE "quotation_versions" ALTER COLUMN "bookingTerms" SET DATA TYPE TEXT;
