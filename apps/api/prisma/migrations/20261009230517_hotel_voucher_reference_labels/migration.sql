-- AlterTable
-- This migration adds optional staff-customized display labels for the hotel
-- voucher reference fields. NULL means the built-in default label.
-- Existing rows are unaffected.
ALTER TABLE "hotel_vouchers" ADD COLUMN "confirmationNumberLabel" VARCHAR(80);
ALTER TABLE "hotel_vouchers" ADD COLUMN "bookingIdLabel" VARCHAR(80);
