import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { hotelVouchersService } from './hotel-vouchers.service.js';

const auth = (req: Request) => {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
};
const context = (req: Request) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const hotelVouchersController = {
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await hotelVouchersService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await hotelVouchersService.details(auth(req), req.params.voucherId!)),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.create(auth(req), req.body, context(req)),
      'Hotel voucher created.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.update(auth(req), req.params.voucherId!, req.body, context(req)),
      'Hotel voucher updated.',
    ),
  remove: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.remove(auth(req), req.params.voucherId!, context(req)),
      'Hotel voucher deleted.',
    ),
  generatePdf: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.generatePdf(auth(req), req.params.voucherId!, context(req)),
      'Hotel voucher PDF ready.',
    ),
  downloadUrl: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.downloadUrl(
        auth(req),
        req.params.voucherId!,
        req.params.documentId!,
      ),
    ),
  sendEmail: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await hotelVouchersService.sendEmail(
        auth(req),
        req.params.voucherId!,
        req.body,
        context(req),
      ),
      'Hotel voucher emailed.',
    ),
};
