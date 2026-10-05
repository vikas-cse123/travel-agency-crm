-- Agency-level Google Maps link (Settings → Company Profile), surfaced as
-- "View on Google Maps" in the public weblink Contact Us section.

ALTER TABLE "companies" ADD COLUMN "googleMapsUrl" VARCHAR(2000);
