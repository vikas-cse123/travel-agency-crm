-- One payment case per lead per company, so concurrent "record payment from
-- lead" requests can never create duplicates. Nullable queryId rows are
-- unaffected: PostgreSQL treats NULLs as distinct in unique constraints.
CREATE UNIQUE INDEX "payment_cases_companyId_queryId_key" ON "payment_cases"("companyId", "queryId");
