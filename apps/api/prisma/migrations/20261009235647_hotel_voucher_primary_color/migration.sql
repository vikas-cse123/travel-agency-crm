-- AlterTable
-- This migration adds an optional per-company primary color for hotel
-- voucher PDFs. NULL keeps the built-in purple theme; existing companies
-- and vouchers render exactly as before.
ALTER TABLE "companies" ADD COLUMN "hotelVoucherPrimaryColor" VARCHAR(7);
