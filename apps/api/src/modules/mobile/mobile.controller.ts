import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { mobileService } from './mobile.service.js';

export const mobileController = {
  async login(req: Request, res: Response) {
    const { email, password } = req.body as { email: string; password: string };
    const result = await mobileService.login({ email, password });
    sendSuccess(res, result);
  },
};
