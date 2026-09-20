import { prisma } from '../../config/prisma.js';
import { normalizeCustomerPhone } from '../../utils/normalize.js';
import { env } from '../../config/env.js';

export const callsService = {
  async createOrGet(auth: { userId: string; companyId: string }, input: {
    androidCallSessionId: string;
    phone: string;
    direction: string;
    startedAt: string;
    endedAt?: string | null;
    durationSeconds?: number | null;
  }) {
    const normalized = normalizeCustomerPhone(input.phone, env.DEFAULT_PHONE_COUNTRY) || input.phone.replace(/\D/g, '').slice(-10);
    const direction = (['INCOMING','OUTGOING','UNKNOWN'].includes(input.direction) ? input.direction : 'UNKNOWN') as 'INCOMING'|'OUTGOING'|'UNKNOWN';
    const startedAt = new Date(input.startedAt);
    const endedAt = input.endedAt ? new Date(input.endedAt) : null;

    // Idempotency: unique(companyId, androidCallSessionId)
    const existing = await prisma.call.findUnique({
      where: { companyId_androidCallSessionId: { companyId: auth.companyId, androidCallSessionId: input.androidCallSessionId } },
      include: { customer: { select: { id: true } }, query: { select: { id: true, queryNumber: true, customerName: true, customerId: true } } },
    });
    if (existing) {
      const lead = (existing as unknown as { query?: { id: string; queryNumber: string; customerName: string; customerId: string | null }; customer?: { id: string } }).query ? { queryId: (existing as unknown as { query: { id: string; queryNumber: string; customerName: string; customerId: string | null } }).query.id, queryNumber: (existing as unknown as { query: { queryNumber: string } }).query.queryNumber, displayName: (existing as unknown as { query: { customerName: string } }).query.customerName, customerId: (existing as unknown as { customer?: { id: string }; query: { customerId: string | null } }).customer?.id ?? (existing as unknown as { query: { customerId: string | null } }).query.customerId ?? null } : (existing as unknown as { customer?: { id: string } }).customer ? { queryId: null, queryNumber: null, displayName: null, customerId: (existing as unknown as { customer: { id: string } }).customer.id } : null;
      return { callId: existing.id, matchStatus: existing.matchStatus, lead, recordingStatus: existing.recordingStatus, created: false };
    }

    // Matching: search Customer normalizedPhone then Query normalizedPhone within company
    const phoneNormForQuery = normalizeCustomerPhone(input.phone, env.DEFAULT_PHONE_COUNTRY);
    let customerId: string | null = null;
    let queryId: string | null = null;
    let matchStatus: 'EXACT_MATCH'|'NEEDS_REVIEW'|'NO_MATCH' = 'NO_MATCH';

    if (phoneNormForQuery) {
      const customers = await prisma.customer.findMany({
        where: { companyId: auth.companyId, normalizedPhone: phoneNormForQuery, deletedAt: null, status: { not: 'MERGED' } },
        select: { id: true },
        take: 3,
      });
      const queries = await prisma.query.findMany({
        where: { companyId: auth.companyId, normalizedPhone: phoneNormForQuery, deletedAt: null },
        select: { id: true, customerId: true, queryNumber: true, customerName: true },
        take: 3,
      });
      const totalMatches = customers.length + queries.length;
      if (totalMatches === 1) {
        matchStatus = 'EXACT_MATCH';
        if (customers[0]) customerId = customers[0].id;
        if (queries[0]) { queryId = queries[0].id; if (!customerId) customerId = queries[0].customerId; }
      } else if (totalMatches > 1) {
        matchStatus = 'NEEDS_REVIEW';
      }
    }

    const call = await prisma.call.create({
      data: {
        companyId: auth.companyId,
        userId: auth.userId,
        androidCallSessionId: input.androidCallSessionId,
        phone: input.phone,
        normalizedPhone: phoneNormForQuery || normalized,
        direction,
        startedAt,
        endedAt,
        durationSeconds: input.durationSeconds ?? (endedAt ? Math.round((endedAt.getTime() - startedAt.getTime())/1000) : null),
        matchStatus,
        recordingStatus: 'NOT_UPLOADED',
        customerId,
        queryId,
      },
      include: { query: { select: { queryNumber: true, customerName: true } } },
    });

    const lead = queryId ? { queryId, queryNumber: (call as unknown as { query?: { queryNumber: string } }).query?.queryNumber ?? null, displayName: (call as unknown as { query?: { customerName: string } }).query?.customerName ?? null, customerId } : customerId ? { queryId: null, queryNumber: null, displayName: null, customerId } : null;
    return { callId: call.id, matchStatus, lead, recordingStatus: call.recordingStatus, created: true };
  },
};
