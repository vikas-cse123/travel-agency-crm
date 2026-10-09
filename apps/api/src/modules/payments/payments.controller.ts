import type { Request, Response } from 'express';
import { paymentsService } from './payments.service.js';
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

const id = (req: Request, name: string) =>
  (req.params as Record<string, string | undefined>)[name]!;

export const paymentsController = {
  cases: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.cases(auth(req), req.query)),
  caseDetails: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.caseDetails(auth(req), id(req, 'caseId'))),
  byLeadCase: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.byLeadCase(auth(req), id(req, 'queryId'))),
  forLeadCase: async (req: Request, res: Response) => {
    const result = await paymentsService.forLeadCase(auth(req), req.body);
    sendSuccess(
      res,
      result,
      result.created ? 'Payment trip created.' : 'Payment trip ready.',
      result.created ? 201 : 200,
    );
  },
  createCase: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await paymentsService.createCase(auth(req), req.body),
      'Payment trip created.',
      201,
    ),
  list: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.list(auth(req), req.query)),
  details: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.details(auth(req), id(req, 'paymentId'))),
  create: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await paymentsService.create(auth(req), req.body, context(req)),
      'Payment recorded.',
      201,
    ),
  update: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await paymentsService.update(auth(req), id(req, 'paymentId'), req.body),
      'Payment updated.',
    ),
  reverse: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await paymentsService.reverse(auth(req), id(req, 'paymentId'), req.body.reason, context(req)),
      'Payment reversed.',
    ),
  voucher: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.voucher(auth(req), id(req, 'paymentId'))),
  generateVoucher: async (req: Request, res: Response) =>
    sendSuccess(
      res,
      await paymentsService.generateVoucher(auth(req), id(req, 'paymentId'), context(req)),
      'Payment voucher ready.',
    ),
  voucherDownloadUrl: async (req: Request, res: Response) =>
    sendSuccess(res, await paymentsService.voucherDownloadUrl(auth(req), id(req, 'paymentId'))),
};
