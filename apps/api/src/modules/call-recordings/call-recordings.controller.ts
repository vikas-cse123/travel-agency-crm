import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { callRecordingsService } from './call-recordings.service.js';
import { UnauthorizedError } from '../../utils/errors.js';

function auth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export const callRecordingsController = {
  async list(req: Request, res: Response) {
    sendSuccess(res, await callRecordingsService.list(auth(req), req.query as Record<string, unknown>));
  },
  async play(req: Request, res: Response) {
    sendSuccess(res, await callRecordingsService.play(auth(req), req.params.callId!));
  },
};
