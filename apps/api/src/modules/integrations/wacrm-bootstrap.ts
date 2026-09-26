import { logger } from '../../config/logger.js';
import { AppError } from '../../utils/errors.js';
import { credentialsService } from './credentials.service.js';

/**
 * Automatic WACRM credential reconciliation at API startup.
 *
 * Deployment contract (ZERO manual commands after deploy): the Travel CRM
 * runtime environment supplies the caller-owned permanent secret plus its
 * owner email; on every boot this module resolves the company/service
 * user from the email and creates (or rematches) the single live
 * `IntegrationCredential` for that company.
 *
 *   WACRM_RECONCILE_TOKEN  the existing WACRM secret (source of truth —
 *                          never generated here, never changed here)
 *   WACRM_OWNER_EMAIL      owner email identifying the Travel CRM account
 *
 * Guarantees:
 * - absent configuration → silent `skipped` (deployments without the
 *   integration are unaffected);
 * - idempotent restarts (same secret rematches, no duplicates);
 * - revoked/expired rows are replaced by the configured secret;
 * - a live row for a DIFFERENT secret is never overwritten (`conflict`);
 * - concurrent boots cannot duplicate: `keyHash` is globally unique and
 *   the loser of a creation race re-reads the winner;
 * - never throws: every failure becomes a logged, secret-free result so
 *   unrelated startup is never blocked;
 * - the plaintext exists only in process memory while deriving the hash —
 *   results, logs, and errors carry ids and static text only.
 *
 * No HTTP endpoint is involved; request-time authentication,
 * company isolation, permissions, expiry, and revocation stay in
 * `wacrm-auth.middleware.ts` untouched.
 */

export const WACRM_RECONCILE_TOKEN_ENV = 'WACRM_RECONCILE_TOKEN';
export const WACRM_OWNER_EMAIL_ENV = 'WACRM_OWNER_EMAIL';

export type WacrmStartupReconcileStatus =
  | 'skipped'
  | 'created'
  | 'already-matched'
  | 'conflict'
  | 'error';

export interface WacrmStartupReconcileResult {
  status: WacrmStartupReconcileStatus;
  credentialId?: string;
  companyId?: string;
  /** Static, secret-free human summary. Never contains credential material. */
  message: string;
}

export async function reconcileWacrmCredentialAtStartup(
  env: Record<string, string | undefined> = process.env,
): Promise<WacrmStartupReconcileResult> {
  const presented = (env[WACRM_RECONCILE_TOKEN_ENV] ?? '').trim();
  const ownerEmail = (env[WACRM_OWNER_EMAIL_ENV] ?? '').trim();
  if (!presented || !ownerEmail) {
    return {
      status: 'skipped',
      message:
        'WACRM credential auto-reconciliation skipped: WACRM_RECONCILE_TOKEN/WACRM_OWNER_EMAIL not configured.',
    };
  }
  try {
    const result = await credentialsService.reconcileByOwnerEmail({
      ownerEmail,
      presented,
      name: 'wacrm-sync',
    });
    if (result.created) {
      logger.info(
        { credentialId: result.id, companyId: result.companyId },
        'Reconciled WACRM integration credential at startup.',
      );
      return {
        status: 'created',
        credentialId: result.id,
        companyId: result.companyId,
        message: 'WACRM integration credential created at startup.',
      };
    }
    return {
      status: 'already-matched',
      credentialId: result.id,
      companyId: result.companyId,
      message: 'WACRM integration credential already matches at startup.',
    };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      logger.error(
        'WACRM credential auto-reconciliation refused: the account already has an active credential for a different secret. Revoke it before reconciling a replacement.',
      );
      return {
        status: 'conflict',
        message:
          'WACRM credential auto-reconciliation refused: the account already has an active credential for a different secret.',
      };
    }
    // Static failure text: underlying messages are code constants, but
    // operational errors (e.g. connectivity) can carry environment
    // details, so only the failure fact is returned.
    const reason = error instanceof AppError ? error.message : 'unexpected reconciliation error';
    logger.error({ reason }, 'WACRM credential auto-reconciliation failed.');
    return { status: 'error', message: `WACRM credential auto-reconciliation failed: ${reason}` };
  }
}
