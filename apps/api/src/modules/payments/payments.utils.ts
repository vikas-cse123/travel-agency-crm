import type { Prisma } from '@prisma/client';

/**
 * Company-scoped sequential numbers for the standalone Payments module.
 * Same lifetime-counter convention as the booking counters: atomic upsert on
 * [companyId, year=0], zero-padded to six digits. NEVER shares sequences
 * with Booking (BK/PAY/REF) — payment and voucher identities are standalone.
 */
export async function nextPaymentNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: 'payment' | 'receipt',
): Promise<string> {
  const year = 0;
  const counter = await tx.paymentCounter.upsert({
    where: { companyId_year: { companyId, year } },
    create: {
      companyId,
      year,
      paymentValue: kind === 'payment' ? 1 : 0,
      receiptValue: kind === 'receipt' ? 1 : 0,
    },
    update:
      kind === 'payment' ? { paymentValue: { increment: 1 } } : { receiptValue: { increment: 1 } },
    select: { paymentValue: true, receiptValue: true },
  });
  const value = kind === 'payment' ? counter.paymentValue : counter.receiptValue;
  const prefix = kind === 'payment' ? 'PAY' : 'RCP';
  return `${prefix}-${String(value).padStart(6, '0')}`;
}
