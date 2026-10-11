-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailProvider" ADD VALUE 'HOSTINGER_SMTP';
ALTER TYPE "EmailProvider" ADD VALUE 'GODADDY_M365_SMTP';
ALTER TYPE "EmailProvider" ADD VALUE 'GODADDY_WORKSPACE_SMTP';
ALTER TYPE "EmailProvider" ADD VALUE 'ZOHO_SMTP';
ALTER TYPE "EmailProvider" ADD VALUE 'CLOUDFLARE_EMAIL';
