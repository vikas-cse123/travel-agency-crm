-- Repeatable pricing options for add-on services, plus quotation-owned pricing
-- snapshots on quotation version/template services. Structured JSON arrays of
-- { id, label, price, currency }; never a formatted string.

-- AddOnService.pricing
ALTER TABLE "add_on_services" ADD COLUMN "pricing" JSONB;

-- QuotationVersionService.pricingSnapshot
ALTER TABLE "quotation_version_services" ADD COLUMN "pricingSnapshot" JSONB;

-- QuotationTemplateService.pricingSnapshot
ALTER TABLE "quotation_template_services" ADD COLUMN "pricingSnapshot" JSONB;

-- Backfill: a legacy single price and/or pricing basis becomes exactly one
-- pricing entry (basis -> label, price -> price, currency -> currency), so no
-- existing data is lost. Rows with neither stay NULL (legacy fallback).
UPDATE "add_on_services"
SET "pricing" = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid(),
    'label', COALESCE("pricingBasis", ''),
    'price', to_jsonb("price"),
    'currency', "currency"
  )
)
WHERE "price" IS NOT NULL OR "pricingBasis" IS NOT NULL;
