import { Router } from 'express';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATUSES,
  PERMISSIONS,
  leadPaymentCaseInputSchema,
  paymentCaseInputSchema,
  paymentInputSchema,
  paymentReversalSchema,
  paymentUpdateSchema,
} from '@interscale/shared';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { paymentsController as c } from './payments.controller.js';

const router = Router();
const caseId = z.object({ caseId: z.string().uuid() });
const paymentId = z.object({ paymentId: z.string().uuid() });
const leadId = z.object({ queryId: z.string().uuid() });

const caseQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(120).optional(),
  customerId: z.string().uuid().optional(),
});

const ledgerQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  paymentStatus: z.enum(PAYMENT_RECORD_STATUSES).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  caseId: z.string().uuid().optional(),
});

router.use(requireAuth, requireVerifiedEmail);

router.get(
  '/cases',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validateRequest({ query: caseQuery }),
  asyncHandler(c.cases),
);
router.post(
  '/cases',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  validateRequest({ body: paymentCaseInputSchema }),
  asyncHandler(c.createCase),
);
router.get(
  '/cases/by-lead/:queryId',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validateRequest({ params: leadId }),
  asyncHandler(c.byLeadCase),
);
router.post(
  '/cases/for-lead',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  validateRequest({ body: leadPaymentCaseInputSchema }),
  asyncHandler(c.forLeadCase),
);
router.get(
  '/cases/:caseId',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validateRequest({ params: caseId }),
  asyncHandler(c.caseDetails),
);

router.get(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validateRequest({ query: ledgerQuery }),
  asyncHandler(c.list),
);
router.post(
  '/',
  requirePermission(PERMISSIONS.PAYMENTS_CREATE),
  validateRequest({ body: paymentInputSchema }),
  asyncHandler(c.create),
);
router.get(
  '/:paymentId',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW),
  validateRequest({ params: paymentId }),
  asyncHandler(c.details),
);
router.patch(
  '/:paymentId',
  requirePermission(PERMISSIONS.PAYMENTS_EDIT),
  validateRequest({ params: paymentId, body: paymentUpdateSchema }),
  asyncHandler(c.update),
);
router.post(
  '/:paymentId/reverse',
  requirePermission(PERMISSIONS.PAYMENTS_REVERSE),
  validateRequest({ params: paymentId, body: paymentReversalSchema }),
  asyncHandler(c.reverse),
);
router.get(
  '/:paymentId/receipt',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW_RECEIPTS),
  validateRequest({ params: paymentId }),
  asyncHandler(c.voucher),
);
router.post(
  '/:paymentId/receipt',
  requirePermission(PERMISSIONS.PAYMENTS_GENERATE_RECEIPTS),
  validateRequest({ params: paymentId }),
  asyncHandler(c.generateVoucher),
);
router.get(
  '/:paymentId/receipt/download-url',
  requirePermission(PERMISSIONS.PAYMENTS_VIEW_RECEIPTS),
  validateRequest({ params: paymentId }),
  asyncHandler(c.voucherDownloadUrl),
);

export { router as paymentsRoutes };
