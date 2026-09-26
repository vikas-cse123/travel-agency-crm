import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { createTenantContext } from '../db/tenant.js';
import { UnauthorizedError } from '../utils/errors.js';
import { asyncHandler } from '../utils/async-handler.js';
import type { AuthContext } from './authenticate.js';

/**
 * Server-to-server integration authentication (e.g. WACRM lead sync).
 *
 * The caller presents `Authorization: Bearer wacrm_<secret>` where only
 * the SHA-256 hash is stored (Session convention — a database leak
 * cannot be replayed). Row selection uses a short public prefix;
 * verification is constant-time. Tenant and actor derive from the
 * credential's bound service user — never from the request — and
 * the same user/company liveness rules as interactive sessions
 * apply. Cookie CSRF does not apply: like the mobile exemption, a
 * Bearer token is an explicit credential, not ambient authority.
 */

export const INTEGRATION_TOKEN_PREFIX = 'wacrm_';
const PREFIX_CHARS = 12;

export function hashIntegrationToken(presented: string): string {
  return createHash('sha256').update(presented, 'utf8').digest('hex');
}

/** Mint a fresh token. The secret is returned once and never stored. */
export function mintIntegrationToken(): { presented: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  const presented = `${INTEGRATION_TOKEN_PREFIX}${secret}`;
  return { presented, prefix: secret.slice(0, PREFIX_CHARS), hash: hashIntegrationToken(presented) };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith(INTEGRATION_TOKEN_PREFIX) || token.length > 160) return null;
  return token;
}

function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const authenticateIntegration = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const presented = bearerToken(req);
    if (!presented) {
      throw new UnauthorizedError('Missing integration authorization token.');
    }
    const prefix = presented.slice(INTEGRATION_TOKEN_PREFIX.length, INTEGRATION_TOKEN_PREFIX.length + PREFIX_CHARS);
    const credential = await prisma.integrationCredential.findFirst({
      where: { keyPrefix: prefix, revokedAt: null },
      include: {
        user: {
          select: {
            id: true,
            companyId: true,
            status: true,
            emailVerifiedAt: true,
            deletedAt: true,
          },
        },
        company: { select: { id: true, status: true } },
      },
    });
    if (!credential || !hashesEqual(hashIntegrationToken(presented), credential.keyHash)) {
      throw new UnauthorizedError('Invalid integration token.');
    }
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Integration token has expired.');
    }
    const user = credential.user;
    if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Integration service user is not active.');
    }
    if (user.companyId !== credential.companyId || credential.company.status !== 'ACTIVE') {
      throw new UnauthorizedError('Integration company is not active.');
    }
    try {
      await prisma.integrationCredential.update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (err) {
      // Audit touch only — never fail authentication on it.
      console.error('[integrations] lastUsedAt update failed:', err);
    }
    const auth: AuthContext = {
      userId: user.id,
      companyId: credential.companyId,
      sessionId: `integration:${credential.id}`,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      tenant: createTenantContext(credential.companyId),
      session: { expiresAt: credential.expiresAt ?? new Date(8640000000000000), csrfToken: '' },
    };
    req.auth = auth;
    next();
  },
);
