import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { recordingService } from './recording.service.js';
import { UnauthorizedError } from '../../utils/errors.js';

function auth(req: Request){ if(!req.auth) throw new UnauthorizedError(); return req.auth as { userId: string; companyId: string }; }

export const recordingController = {
  async upload(req: Request, res: Response) {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new Error('Missing file');
    const sha = req.headers['x-sha256'] as string | undefined;
    const result = await recordingService.upload(auth(req), req.params.callId!, file, sha, file.originalname, file.mimetype);
    sendSuccess(res, result);
  },
  async play(req: Request, res: Response) {
    const result = await recordingService.presignedUrl(auth(req) as { companyId: string }, req.params.callId!);
    sendSuccess(res, result);
  },
};
