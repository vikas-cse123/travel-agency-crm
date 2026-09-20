import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { callsService } from './calls.service.js';
import { UnauthorizedError } from '../../utils/errors.js';

function auth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth as { userId: string; companyId: string };
}

export const callsController = {
  async create(req: Request, res: Response) {
    const body = req.body as { androidCallSessionId: string; phone: string; direction: string; startedAt: string; endedAt?: string; durationSeconds?: number };
    const result = await callsService.createOrGet(auth(req), body);
    sendSuccess(res, result, result.created ? 'Call created.' : 'Call exists.', result.created ? 201 : 200);
  },
};
