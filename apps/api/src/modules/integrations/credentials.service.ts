import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { mintIntegrationToken } from '../../middleware/wacrm-auth.middleware.js';
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
};
