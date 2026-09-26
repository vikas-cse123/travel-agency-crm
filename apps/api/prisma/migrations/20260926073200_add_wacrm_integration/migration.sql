-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "keyPrefix" VARCHAR(16) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "createdById" UUID,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wacrm_lead_links" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "wacrmAccountId" VARCHAR(64) NOT NULL,
    "flowRunId" VARCHAR(64) NOT NULL,
    "queryId" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wacrm_lead_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_keyHash_key" ON "integration_credentials"("keyHash");

-- CreateIndex
CREATE INDEX "integration_credentials_companyId_revokedAt_idx" ON "integration_credentials"("companyId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_companyId_keyPrefix_key" ON "integration_credentials"("companyId", "keyPrefix");

-- CreateIndex
CREATE INDEX "wacrm_lead_links_companyId_status_idx" ON "wacrm_lead_links"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wacrm_lead_links_companyId_wacrmAccountId_flowRunId_key" ON "wacrm_lead_links"("companyId", "wacrmAccountId", "flowRunId");

-- AddForeignKey
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wacrm_lead_links" ADD CONSTRAINT "wacrm_lead_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wacrm_lead_links" ADD CONSTRAINT "wacrm_lead_links_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
