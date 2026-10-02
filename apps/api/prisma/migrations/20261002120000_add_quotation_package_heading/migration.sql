-- Add an optional custom package heading for the third line of the public quotation weblink hero.
ALTER TABLE "quotation_versions" ADD COLUMN "packageHeading" VARCHAR(200);
