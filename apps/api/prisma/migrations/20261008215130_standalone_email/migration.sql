-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('CUSTOM_SMTP', 'GMAIL_SMTP', 'MICROSOFT_365_SMTP', 'AMAZON_SES_SMTP', 'OTHER_SMTP');

-- CreateEnum
CREATE TYPE "EmailSecurity" AS ENUM ('NONE', 'SSL_TLS', 'STARTTLS');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "company_email_configurations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'CUSTOM_SMTP',
    "smtpHost" VARCHAR(255) NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "security" "EmailSecurity" NOT NULL DEFAULT 'STARTTLS',
    "smtpUsername" VARCHAR(255) NOT NULL,
    "smtpPasswordEncrypted" TEXT NOT NULL,
    "passwordKeyVersion" VARCHAR(16),
    "passwordSetAt" TIMESTAMP(3),
    "fromName" VARCHAR(160) NOT NULL,
    "fromEmail" VARCHAR(255) NOT NULL,
    "replyTo" VARCHAR(255),
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_email_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fromName" VARCHAR(160),
    "fromEmail" VARCHAR(255) NOT NULL,
    "to" TEXT[],
    "cc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bcc" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" VARCHAR(500) NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'SENDING',
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_email_configurations_companyId_key" ON "company_email_configurations"("companyId");

-- CreateIndex
CREATE INDEX "email_logs_companyId_createdAt_idx" ON "email_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_companyId_status_idx" ON "email_logs"("companyId", "status");

-- AddForeignKey
ALTER TABLE "company_email_configurations" ADD CONSTRAINT "company_email_configurations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_email_configurations" ADD CONSTRAINT "company_email_configurations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_email_configurations" ADD CONSTRAINT "company_email_configurations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Activate standalone Email permissions. Grants are additive and limited to
-- system roles and the four shipped permission templates.
INSERT INTO "permissions" ("id", "key", "module", "action", "description", "isAvailable", "createdAt")
VALUES
  (gen_random_uuid(), 'emails.view', 'emails', 'view', 'View sent emails', true, NOW()),
  (gen_random_uuid(), 'emails.send', 'emails', 'send', 'Send standalone emails', true, NOW()),
  (gen_random_uuid(), 'emails.manage_settings', 'emails', 'manage_settings', 'Manage company email sending settings', true, NOW())
ON CONFLICT ("key") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description",
  "isAvailable" = true;

INSERT INTO "role_permissions" ("roleId", "permissionId", "createdAt")
SELECT r."id", p."id", NOW()
FROM "roles" r
JOIN "permissions" p ON (
  r."name" IN ('Owner', 'Manager')
  OR (r."name" = 'Sales Executive' AND p."key" IN ('emails.view', 'emails.send'))
  OR (r."name" = 'View Only' AND p."key" = 'emails.view')
)
WHERE r."isSystem" = true AND p."key" LIKE 'emails.%'
ON CONFLICT DO NOTHING;

INSERT INTO "permission_template_permissions" ("templateId", "permissionId", "createdAt")
SELECT t."id", p."id", NOW()
FROM "permission_templates" t
JOIN "permissions" p ON (
  t."name" = 'Manager'
  OR (t."name" = 'Sales Executive' AND p."key" IN ('emails.view', 'emails.send'))
  OR (t."name" = 'View Only' AND p."key" = 'emails.view')
)
WHERE t."deletedAt" IS NULL
  AND t."name" IN ('Manager', 'Sales Executive', 'Data Entry', 'View Only')
  AND p."key" LIKE 'emails.%'
ON CONFLICT DO NOTHING;
