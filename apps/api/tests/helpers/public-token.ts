import type { PrismaClient } from '@prisma/client';

/**
 * The public-link endpoint now prefers the auto-generated friendly slug, so a
 * quotation's public URL is no longer guaranteed to contain the raw `/q/<token>`
 * form. Tests that need the raw (unguessable) token should read it from the
 * database instead of parsing the returned URL.
 */
export async function fetchPublicToken(
  db: PrismaClient,
  quotationId: string,
): Promise<string> {
  const row = await db.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: { publicToken: true },
  });
  if (!row.publicToken) {
    throw new Error(`Quotation ${quotationId} has no public token`);
  }
  return row.publicToken;
}
