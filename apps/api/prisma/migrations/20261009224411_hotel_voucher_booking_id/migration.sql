-- AlterTable
-- This migration adds an optional free-text booking reference to hotel
-- vouchers. It is not a relation to Booking. Existing rows keep NULL.
ALTER TABLE "hotel_vouchers" ADD COLUMN "bookingId" VARCHAR(80);
