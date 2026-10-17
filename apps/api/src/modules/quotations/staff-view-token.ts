import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { safeCompare } from '../../utils/crypto.js';

/**
 * Signed "staff view" signal for weblink analytics classification.
 *
 * Background: the CRM session cookie is host-only, so a staff member signed in
 * on the CRM app host does not present that cookie to a public weblink served
 * from the apex marketing domain (`travelagencycrm.in`) or a customer custom
 * domain. Without another signal such a visit is (correctly) unauthenticated
 * and would be classified EXTERNAL. This token lets the CRM explicitly mark a
 * staff member's own visit as HOME across hosts.
 *
 * Security properties:
 *  - Minted server-side only, for an already-authenticated same-company user.
 *  - HMAC-SHA256 over a versioned context string with SESSION_SECRET, so the
 *    payload cannot be tampered with and the token cannot be confused with any
 *    other signed value. Only the signature input differs across uses.
 *  - Bound to the user, owning company and quotation; the company/quotation
 *    binding is re-checked against the quotation being viewed on every request.
 *  - Short expiry. It is NOT an authentication credential: verifying it can at
 *    most change an analytics label (HOME vs EXTERNAL). It grants no data any
 *    visitor could not already see on the public link, so replay within its
 *    short lifetime is a bounded, low-impact concern.
 */

const CONTEXT = 'weblink-staff-view:v1';

/** How long a minted signal stays valid. Kept short to bound replay. */
export const STAFF_VIEW_TTL_SECONDS = 15 * 60;

interface StaffViewClaims {
  /** Authenticated user id (binding). */
  u: string;
  /** Owning company id (binding). */
  c: string;
  /** Quotation id (binding). */
  q: string;
  /** Expiry, Unix seconds. */
  e: number;
}

export interface StaffViewBinding {
  companyId: string;
  quotationId: string;
}

function sign(body: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`${CONTEXT}:${body}`).digest('base64url');
}

/** Mint a staff-view signal for an authenticated, same-company user. */
export function mintStaffViewToken(claims: {
  userId: string;
  companyId: string;
  quotationId: string;
  now?: Date;
}): string {
  const payload: StaffViewClaims = {
    u: claims.userId,
    c: claims.companyId,
    q: claims.quotationId,
    e: Math.floor((claims.now ?? new Date()).getTime() / 1000) + STAFF_VIEW_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Verify a staff-view signal against a quotation. Returns true only when the
 * signature is intact, the token is unexpired, and it is bound to exactly this
 * company and quotation. Any malformed/tampered/wrong-binding input returns
 * false — callers must treat a false result as an ordinary (EXTERNAL) visit.
 */
export function verifyStaffViewToken(
  token: string | null | undefined,
  binding: StaffViewBinding,
  now: Date = new Date(),
): boolean {
  if (!token || typeof token !== 'string') return false;
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return false;
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  // Constant-time compare; a length mismatch short-circuits to false.
  if (!safeCompare(signature, sign(body))) return false;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return false;
  }
  if (!claims || typeof claims !== 'object') return false;
  const { u, c, q, e } = claims as Partial<StaffViewClaims>;
  if (typeof u !== 'string' || !u) return false;
  if (typeof c !== 'string' || c !== binding.companyId) return false;
  if (typeof q !== 'string' || q !== binding.quotationId) return false;
  if (typeof e !== 'number' || !Number.isFinite(e)) return false;
  if (e * 1000 < now.getTime()) return false;
  return true;
}
