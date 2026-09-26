import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  deriveIntegrationCredentialParts,
  mintIntegrationToken,
} from '../../middleware/wacrm-auth.middleware.js';
import type { WacrmCredentialMint } from '@interscale/shared';

/**
 * Integration credential lifecycle (session-authed admins only —
 * the Bearer surface below never mints). Secrets are shown once
 * at creation; afterwards only metadata is readable.
 */
export const credentialsService = {
  async mint(auth: AuthContext, input: WacrmCredentialMint) {
    const user = await prisma.user.findFirst({
      where: {
        id: input.userId,
        companyId: auth.companyId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, fullName: true },
    });
    if (!user) {
      throw new ValidationError('The service user must be an active user in this company.');
    }
    // One permanent WACRM credential per account/company: the secret is
    // shown once and then reused for every integration call (it lives in
    // the database, so it survives deployments and restarts). Minting
    // while a live credential exists would silently orphan the stored
    // secret, so refuse with 409 — rotate explicitly via revoke + mint.
    // Expired or revoked rows do not block: they can no longer
    // authenticate, so replacing them is safe.
    const existing = await prisma.integrationCredential.findFirst({
      where: {
        companyId: auth.companyId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(
        'This account already has an active WACRM credential. Revoke it before creating a replacement.',
      );
    }
    const { presented, prefix, hash } = mintIntegrationToken();
    const created = await prisma.integrationCredential.create({
      data: {
        companyId: auth.companyId,
        name: input.name,
        keyPrefix: prefix,
        keyHash: hash,
        userId: user.id,
        createdById: auth.userId,
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 24 * 3600_000)
          : null,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        userId: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    return { ...created, token: presented };
  },

  async list(auth: AuthContext) {
    return prisma.integrationCredential.findMany({
      where: { companyId: auth.companyId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async revoke(auth: AuthContext, id: string) {
    const credential = await prisma.integrationCredential.findFirst({
      where: { id, companyId: auth.companyId, revokedAt: null },
      select: { id: true },
    });
    if (!credential) throw new NotFoundError('Integration credential not found.');
    await prisma.integrationCredential.update({
      where: { id: credential.id },
      data: { revokedAt: new Date() },
    });
    return { id: credential.id, revoked: true };
  },

  /**
   * One-time reconciliation of a caller-owned secret (e.g. the permanent
   * WACRM secret already configured on the caller side).
   *
   * Script/admin use ONLY — deliberately not exposed through any HTTP
   * route, so no endpoint ever ingests a plaintext secret. Derives the
   * storable `{ prefix, hash }` with the same implementation Bearer
   * verification uses, stores hash-only, and enforces the
   * one-live-credential-per-company rule:
   *
   * - a live row whose hash already matches → idempotent success
   *   (`created: false`), no duplicate row;
   * - a live row with a different hash → 409 (revoke it first, then
   *   reconcile the replacement);
   * - otherwise the row is created and the secret authenticates from
   *   then on.
   *
   * Never returns or logs the plaintext. Company isolation, service-user
   * liveness, expiry, revocation, and permission checks all stay in the
   * request-time middleware untouched.
   */
  async reconcile(
    input: {
      companyId: string;
      userId: string;
      presented: string;
      name: string;
      createdById?: string | null;
    },
  ): Promise<{ id: string; name: string; companyId: string; userId: string; created: boolean }> {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId },
      select: { id: true, status: true },
    });
    if (!company) throw new ValidationError('The company was not found.');
    if (company.status !== 'ACTIVE') {
      throw new ValidationError('The company must be active to hold a WACRM credential.');
    }
    const user = await prisma.user.findFirst({
      where: {
        id: input.userId,
        companyId: company.id,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!user) {
      throw new ValidationError('The service user must be an active user in this company.');
    }
    const { prefix, hash } = deriveIntegrationCredentialParts(input.presented);
    const live = await prisma.integrationCredential.findMany({
      where: {
        companyId: company.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, keyHash: true },
    });
    const matching = live.find((row) => row.keyHash === hash);
    if (matching) return { id: matching.id, name: input.name, companyId: company.id, userId: user.id, created: false };
    if (live.length > 0) {
      throw new ConflictError(
        'This account already has an active WACRM credential for a different secret. Revoke it before reconciling a replacement.',
      );
    }
    try {
      const created = await prisma.integrationCredential.create({
        data: {
          companyId: company.id,
          name: input.name.trim() || 'wacrm-sync',
          keyPrefix: prefix,
          keyHash: hash,
          userId: user.id,
          createdById: input.createdById ?? user.id,
          expiresAt: null,
        },
        select: { id: true, name: true, companyId: true, userId: true },
      });
      return { ...created, created: true };
    } catch (err) {
      // Creation race or prefix reuse (`companyId,keyPrefix` is unique):
      // another instance created a row first, or a dead row already holds
      // this prefix. Resolve by hash — never by guessing:
      // - same hash + live → return the winner (no duplicate);
      // - same hash + dead (revoked/expired) → revive it for the same
      //   secret instead of failing on the unique constraint;
      // - different hash → refuse (a different secret owns this prefix).
      if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        const rivals = await prisma.integrationCredential.findMany({
          where: { companyId: company.id, keyPrefix: prefix },
          select: { id: true, name: true, companyId: true, userId: true, keyHash: true, revokedAt: true, expiresAt: true },
        });
        const sameSecret = rivals.find((row) => row.keyHash === hash);
        if (sameSecret && (sameSecret.revokedAt !== null || (sameSecret.expiresAt !== null && sameSecret.expiresAt.getTime() <= Date.now()))) {
          // Same secret, dead row: revive it bound to the freshly
          // validated service user (the previous binding may belong to
          // a user who is no longer active).
          const revived = await prisma.integrationCredential.update({
            where: { id: sameSecret.id },
            data: { revokedAt: null, expiresAt: null, userId: user.id },
            select: { id: true, name: true, companyId: true, userId: true },
          });
          return { ...revived, created: false };
        }
        if (sameSecret) {
          return {
            id: sameSecret.id,
            name: sameSecret.name,
            companyId: sameSecret.companyId,
            userId: sameSecret.userId,
            created: false,
          };
        }
        throw new ConflictError(
          'This account already has an active WACRM credential for a different secret. Revoke it before reconciling a replacement.',
        );
      }
      throw err;
    }
  },

  /**
   * Email-based entry point for one-time reconciliation: resolves the
   * company and service user automatically from the WACRM owner's email
   * (no company/user ids, no hardcoded mappings) and delegates to
   * `reconcile()`, so every rule there — hash-only storage,
   * one-live-credential-per-company, idempotent rematch, 409 on a
   * different live secret — applies unchanged.
   *
   * Resolution: exactly one non-deleted Travel CRM user may carry the
   * normalized email. Whether that user is the company owner or a
   * regular member, its own company becomes the credential scope and the
   * user itself becomes the service identity (liveness is re-validated
   * by `reconcile()`). Zero matches fail with a clear error; more than
   * one match fails safely instead of guessing (unreachable while
   * `normalizedEmail` stays globally unique — defense in depth).
   */
  async reconcileByOwnerEmail(
    input: {
      ownerEmail: string;
      presented: string;
      name: string;
      createdById?: string | null;
    },
  ): Promise<{ id: string; name: string; companyId: string; userId: string; created: boolean }> {
    const normalized = normalizeEmail(input.ownerEmail ?? '');
    if (!normalized) throw new ValidationError('A WACRM owner email is required.');
    const matches = await prisma.user.findMany({
      where: { normalizedEmail: normalized, deletedAt: null },
      select: { id: true, companyId: true, status: true },
    });
    if (matches.length === 0) {
      throw new NotFoundError('No Travel CRM user matches the WACRM owner email.');
    }
    if (matches.length > 1) {
      throw new ValidationError(
        'The WACRM owner email matches multiple Travel CRM users; refusing to guess. Resolve the correct account first.',
      );
    }
    const match = matches[0]!;
    return credentialsService.reconcile({
      companyId: match.companyId,
      userId: match.id,
      presented: input.presented,
      name: input.name,
      createdById: input.createdById ?? match.id,
    });
  },
};
