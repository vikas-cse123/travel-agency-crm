import { prisma } from '../../config/prisma.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { verifyPassword } from '../../utils/crypto.js';
import { signMobileToken } from '../../utils/mobile-token.js';

export const mobileService = {
  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { normalizedEmail: email },
      select: { id: true, companyId: true, roleId: true, passwordHash: true, status: true, emailVerifiedAt: true, deletedAt: true, company: { select: { status: true } } },
    });
    if (!user || user.deletedAt) throw new UnauthorizedError('Invalid email or password.');
    if (user.status !== 'ACTIVE') throw new UnauthorizedError('Account not active.');
    if (user.company.status !== 'ACTIVE') throw new UnauthorizedError('Company not active.');
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedError('Invalid email or password.');
    // Optional: require verified email — keep same as web
    // if (!user.emailVerifiedAt) throw new UnauthorizedError('Verify your email.');

    const token = signMobileToken({ userId: user.id, companyId: user.companyId, roleId: user.roleId, expiresInSeconds: 7 * 24 * 3600 });
    return { token, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), userId: user.id, companyId: user.companyId };
  },
};
