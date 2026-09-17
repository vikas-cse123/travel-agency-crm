-- Multi-default hotels per destination (max 10).
--
-- Drops the one-default-per-city partial unique index. Default status is now
-- destination-scoped with a maximum of 10 defaults per destination, enforced
-- in the service layer on create/update. Existing default flags are preserved
-- untouched: hotels already marked as default remain default.
DROP INDEX IF EXISTS "hotels_default_per_city_unique";
