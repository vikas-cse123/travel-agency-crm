-- Staff-entered TOTAL ROOMS override for hotel options. NULL means automatic
-- (the total is the live sum of the room allocations), so every existing row
-- keeps working unchanged with no backfill.
ALTER TABLE "quotation_template_hotel_options" ADD COLUMN "roomsOverride" INTEGER;
ALTER TABLE "quotation_version_hotel_options" ADD COLUMN "roomsOverride" INTEGER;
