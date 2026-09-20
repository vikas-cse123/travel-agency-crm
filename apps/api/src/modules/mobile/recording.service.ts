import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { storageService } from '../../services/storage/storage.service.js';
import { callRecordingObjectKey } from '../../services/storage/storage.service.js';
import { env } from '../../config/env.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

export const recordingService = {
  async upload(auth: { userId: string; companyId: string }, callId: string, file: Express.Multer.File, headerSha: string | undefined, originalFilename: string, mimeType: string) {
    const call = await prisma.call.findFirst({ where: { id: callId, companyId: auth.companyId } });
    if (!call) throw new NotFoundError('Call not found.');

    const allowed = ['audio/mp4','audio/m4a','audio/aac','audio/mpeg','audio/wav','audio/x-m4a','video/mp4'];
    if (!allowed.includes(mimeType)) throw new ValidationError(`Unsupported MIME ${mimeType}`);

    const max = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
    if (file.size > max) throw new ValidationError(`File too large ${file.size} > ${max}`);

    const calcSha = crypto.createHash('sha256').update(file.buffer).digest('hex');
    if (headerSha && headerSha.toLowerCase() !== calcSha.toLowerCase()) throw new ValidationError('Checksum mismatch');

    // idempotent: if existing recording same sha return
    const existing = await prisma.callRecording.findUnique({ where: { callId } });
    if (existing && existing.sha256 === calcSha) {
      return { s3Key: existing.s3Key, sha256: calcSha, reused: true };
    }

    const s3Key = callRecordingObjectKey({ companyId: auth.companyId, callId });
    const bucket = env.AWS_S3_BUCKET;
    await storageService.putObject({ key: s3Key, body: file.buffer, contentType: mimeType, checksum: calcSha });

    const rec = await prisma.callRecording.upsert({
      where: { callId },
      update: { s3Key, s3Bucket: bucket, mimeType, sizeBytes: file.size, sha256: calcSha, originalFilename, durationMs: null },
      create: { callId, companyId: auth.companyId, s3Key, s3Bucket: bucket, mimeType, sizeBytes: file.size, sha256: calcSha, originalFilename },
    });
    await prisma.call.update({ where: { id: callId }, data: { recordingStatus: 'UPLOADED' } });
    return { s3Key: rec.s3Key, sha256: calcSha, reused: false };
  },

  async presignedUrl(auth: { companyId: string }, callId: string) {
    const call = await prisma.call.findFirst({ where: { id: callId, companyId: auth.companyId } });
    if (!call) throw new NotFoundError('Call not found.');
    const rec = await prisma.callRecording.findUnique({ where: { callId } });
    if (!rec) throw new NotFoundError('Recording not found.');
    const url = await storageService.createDownloadUrl(rec.s3Key, rec.originalFilename, 300, 'inline');
    return { url, expiresAt: new Date(Date.now() + 300*1000).toISOString(), s3Key: rec.s3Key };
  },
};
