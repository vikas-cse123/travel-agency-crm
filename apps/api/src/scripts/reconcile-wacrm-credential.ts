import { PrismaClient } from '@prisma/client';
import { credentialsService } from '../modules/integrations/credentials.service.js';

/**
 * One-time reconciliation of the caller-owned permanent WACRM secret.
 *
 * The operator provides ONLY the existing secret (plus the WACRM owner's
 * email); the company and service user resolve automatically from that
 * email — no ids, no hardcoded mappings.
 *
 * The plaintext secret is NEVER committed, logged, or stored: it is read
 * exclusively from the `WACRM_RECONCILE_TOKEN` environment variable, its
 * SHA-256 hash (+ public prefix) is derived with the same implementation
 * Bearer verification uses, and only the hash is persisted.
 *
 * Usage (run manually, once, with the secret exported locally):
 *
 *   WACRM_RECONCILE_TOKEN='<existing-secret>' \
 *   WACRM_OWNER_EMAIL='<owner-email>' \
 *     npm run db:reconcile-wacrm-credential --workspace @interscale/api
 *
 * (`--owner-email <email>` also works instead of the env var; the secret
 * itself is accepted ONLY via the environment.)
 *
 * Behavior:
 * - owner email resolves to exactly one user → its company is scoped and
 *   the user becomes the service identity (owner or regular member alike);
 * - no match / several matches → clear failure, nothing is created;
 * - no live credential for the company → creates it (exit 0);
 * - live credential already matches the secret → idempotent success (exit 0);
 * - live credential for a DIFFERENT secret → refuses with exit 2
 *   (revoke it first via the admin credentials UI/API, then re-run);
 * - unknown/inactive company or service user → exit 1.
 *
 * Output contains ids only — never the secret, hash, or prefix.
 */
const prisma = new PrismaClient();

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function run(): Promise<void> {
  const presented = process.env.WACRM_RECONCILE_TOKEN;
  if (!presented || !presented.trim()) {
    throw new Error(
      'WACRM_RECONCILE_TOKEN is not set. Export the existing caller-owned secret for this run only; it is never stored.',
    );
  }
  const ownerEmail = argValue('--owner-email') ?? process.env.WACRM_OWNER_EMAIL;
  const name = argValue('--name') ?? 'wacrm-sync';
  if (!ownerEmail || !ownerEmail.trim()) {
    throw new Error(
      'Missing owner email. Pass --owner-email <email> or set WACRM_OWNER_EMAIL.',
    );
  }

  const result = await credentialsService.reconcileByOwnerEmail({
    ownerEmail,
    presented,
    name,
    createdById: null,
  });
  console.log(
    result.created
      ? `Reconciled WACRM credential ${result.id} for company ${result.companyId} (service user ${result.userId}).`
      : `WACRM credential ${result.id} for company ${result.companyId} already matches. No change made.`,
  );
}

run()
  .then(() => prisma.$disconnect())
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('already has an active WACRM credential') ? 2 : 1;
    // Never echo input: argv/env may carry the secret in this process.
    console.error(`WACRM credential reconciliation failed: ${message}`);
    return prisma.$disconnect().then(() => process.exit(status));
  });
