import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

interface MobileTokenPayload {
  userId: string;
  companyId: string;
  roleId: string;
  exp: number; // epoch seconds
  iat: number;
  jti: string;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
function base64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signMobileToken(payload: Omit<MobileTokenPayload, 'exp' | 'iat' | 'jti'> & { expiresInSeconds?: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (payload.expiresInSeconds ?? 7 * 24 * 3600); // default 7d for mobile
  const full: MobileTokenPayload = {
    userId: payload.userId,
    companyId: payload.companyId,
    roleId: payload.roleId,
    exp,
    iat: now,
    jti: Math.random().toString(36).slice(2, 10),
  };
  const data = base64urlEncode(JSON.stringify(full));
  const sig = createHmac('sha256', env.TOKEN_PEPPER!).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expected = createHmac('sha256', env.TOKEN_PEPPER!).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(data)) as MobileTokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
    if (!payload.userId || !payload.companyId) return null;
    return payload;
  } catch {
    return null;
  }
}
