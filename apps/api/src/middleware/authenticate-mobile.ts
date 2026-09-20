import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { asyncHandler } from '../utils/async-handler.js';
import { createTenantContext } from '../db/tenant.js';
import { verifyMobileToken } from '../utils/mobile-token.js';
import type { AuthContext } from './authenticate.js';

export const authenticateMobile = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization as string | undefined;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!bearer) throw new UnauthorizedError('Missing mobile authorization token.');

  const payload = verifyMobileToken(bearer);
  if (!payload) throw new UnauthorizedError('Invalid or expired mobile token.');

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, companyId: true, roleId: true, status: true, emailVerifiedAt: true, deletedAt: true, company: { select: { status: true } } },
  });
  if (!user || user.deletedAt) throw new UnauthorizedError('Account not found.');
  if (user.status !== 'ACTIVE' || user.company.status !== 'ACTIVE') throw new ForbiddenError('Account not active.');
  // Enforce token company binding — token company must match persisted user company
  if (user.companyId !== payload.companyId) throw new UnauthorizedError('Token company mismatch.');

  // Populate same shape as web authenticate so downstream code can reuse
  (req as unknown as { auth: AuthContext }).auth = {
    userId: user.id,
    companyId: user.companyId,
    sessionId: `mobile:${payload.jti}`,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    tenant: createTenantContext(user.companyId),
    session: { expiresAt: new Date(payload.exp * 1000), csrfToken: '' },
  } as unknown as AuthContext;

  next();
});
