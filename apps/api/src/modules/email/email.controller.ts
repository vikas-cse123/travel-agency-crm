import type { Request, Response } from 'express';
import { emailService } from './email.service.js';
import { sendSuccess } from '../../utils/api-response.js';
import { UnauthorizedError } from '../../utils/errors.js';

const auth = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};
const context = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const emailController = {
  settings: async (req: Request, res: Response) =>
    sendSuccess(res, await emailService.settings(auth(req))),
  saveSettings: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await emailService.saveSettings(auth(req), req.body, context(req)),
      'Email configuration saved.',
    ),
  sendTest: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await emailService.sendTest(auth(req), req.body.to),
      'Test email sent successfully.',
    ),
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await emailService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await emailService.details(auth(req), req.params.id!)),
  send: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await emailService.send(auth(req), req.body, context(req)),
      'Email sent successfully.',
      201,
    ),
};
