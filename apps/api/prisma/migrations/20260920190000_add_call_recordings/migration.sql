-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INCOMING', 'OUTGOING', 'UNKNOWN');
-- CreateEnum
CREATE TYPE "CallMatchStatus" AS ENUM ('EXACT_MATCH', 'NEEDS_REVIEW', 'NO_MATCH');
-- CreateEnum
CREATE TYPE "CallRecordingStatus" AS ENUM ('NOT_UPLOADED', 'UPLOADING', 'UPLOADED', 'FAILED', 'RETRY_REQUIRED');
-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "customerId" UUID,
    "queryId" UUID,
    "androidCallSessionId" VARCHAR(64) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "normalizedPhone" VARCHAR(24) NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "matchStatus" "CallMatchStatus" NOT NULL DEFAULT 'NO_MATCH',
    "recordingStatus" "CallRecordingStatus" NOT NULL DEFAULT 'NOT_UPLOADED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "call_recordings" (
    "id" UUID NOT NULL,
    "callId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "s3Key" VARCHAR(1000) NOT NULL,
    "s3Bucket" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "sha256" VARCHAR(128) NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "call_recordings_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "calls_companyId_androidCallSessionId_key" ON "calls"("companyId", "androidCallSessionId");
-- CreateIndex
CREATE INDEX "calls_companyId_normalizedPhone_idx" ON "calls"("companyId", "normalizedPhone");
-- CreateIndex
CREATE INDEX "calls_companyId_startedAt_idx" ON "calls"("companyId", "startedAt");
-- CreateIndex
CREATE INDEX "calls_companyId_queryId_idx" ON "calls"("companyId", "queryId");
-- CreateIndex
CREATE INDEX "calls_companyId_customerId_idx" ON "calls"("companyId", "customerId");
-- CreateIndex
CREATE UNIQUE INDEX "call_recordings_callId_key" ON "call_recordings"("callId");
-- CreateIndex
CREATE INDEX "call_recordings_companyId_s3Key_idx" ON "call_recordings"("companyId", "s3Key");
-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
