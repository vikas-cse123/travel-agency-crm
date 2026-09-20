import { prisma } from '../../config/prisma.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { storageService } from '../../services/storage/storage.service.js';
import type { AuthContext } from '../../middleware/authenticate.js';

export const callRecordingsService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const { search, direction, page, limit } = query as { search?: string; direction?: string; page?: string; limit?: string };
    const where: Record<string, unknown> = { companyId: auth.companyId };
    if (direction && direction !== 'ALL') (where as Record<string, unknown>).direction = direction;
    // Search across phone, queryNumber, customerName via relation
    let ids: string[] | undefined;
    if (search) {
      const s = String(search).trim();
      const calls = await prisma.call.findMany({
        where: {
          companyId: auth.companyId,
          OR: [
            { phone: { contains: s, mode: 'insensitive' as const } },
            { query: { queryNumber: { contains: s, mode: 'insensitive' as const } } },
            { query: { customerName: { contains: s, mode: 'insensitive' as const } } },
            { customer: { displayName: { contains: s, mode: 'insensitive' as const } } },
          ],
        },
        select: { id: true },
        take: 500,
      });
      ids = calls.map((c) => c.id);
      if (ids.length === 0) return { data: [], total: 0 };
      (where as Record<string, unknown>).id = { in: ids };
    }
    const take = Math.min(Number(limit) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const data = await prisma.call.findMany({
      where: where as never,
      include: {
        query: { select: { id: true, queryNumber: true, customerName: true } },
        customer: { select: { id: true, displayName: true } },
        recording: { select: { id: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
      },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    });
    // Only return calls that have recordings? Spec says page should display all Call records that have recordings available.
    const filtered = data.filter((c) => c.recording != null || c.recordingStatus === 'UPLOADED');
    return { data: filtered, total: filtered.length, page: Number(page) || 1, limit: take };
  },

  async play(auth: AuthContext, callId: string) {
    const call = await prisma.call.findFirst({ where: { id: callId, companyId: auth.companyId } });
    if (!call) throw new NotFoundError('Call not found');
    // Verify query belongs to company if linked
    if (call.queryId) {
      const q = await prisma.query.findFirst({ where: { id: call.queryId, companyId: auth.companyId } });
      if (!q) throw new ForbiddenError('Not authorized for this call');
    }
    const rec = await prisma.callRecording.findUnique({ where: { callId } });
    if (!rec) throw new NotFoundError('Recording not found');
    if (rec.companyId !== auth.companyId) throw new ForbiddenError('Not authorized');
    const url = await storageService.createDownloadUrl(rec.s3Key, rec.originalFilename, 300, 'inline');
    return { url, expiresAt: new Date(Date.now() + 300 * 1000).toISOString(), s3Key: rec.s3Key };
  },
};
