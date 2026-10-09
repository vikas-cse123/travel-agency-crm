import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@interscale/shared';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  hotelVoucherEmailInputSchema,
  hotelVoucherInputSchema,
  hotelVoucherUpdateSchema,
} from '@interscale/shared';
import { hotelVouchersController as vouchers } from './hotel-vouchers.controller.js';

const router = Router();

const voucherId = z.object({ voucherId: z.string().uuid() });
const voucherDocumentId = voucherId.extend({ documentId: z.string().uuid() });
const voucherList = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(160).optional(),
  hotelId: z.string().uuid().optional(),
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  sortBy: z.enum(['createdAt', 'checkIn', 'guestName', 'voucherNumber']).optional(),
});

router.use(requireAuth, requireVerifiedEmail);

router.get(
  '/',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_VIEW),
  validateRequest({ query: voucherList }),
  asyncHandler(vouchers.list),
);
router.post(
  '/',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_CREATE),
  validateRequest({ body: hotelVoucherInputSchema }),
  asyncHandler(vouchers.create),
);
router.get(
  '/:voucherId',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_VIEW),
  validateRequest({ params: voucherId }),
  asyncHandler(vouchers.details),
);
router.patch(
  '/:voucherId',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_UPDATE),
  validateRequest({ params: voucherId, body: hotelVoucherUpdateSchema }),
  asyncHandler(vouchers.update),
);
router.delete(
  '/:voucherId',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_DELETE),
  validateRequest({ params: voucherId }),
  asyncHandler(vouchers.remove),
);
router.post(
  '/:voucherId/generate-pdf',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_EXPORT),
  validateRequest({ params: voucherId }),
  asyncHandler(vouchers.generatePdf),
);
router.get(
  '/:voucherId/documents/:documentId/download-url',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_EXPORT),
  validateRequest({ params: voucherDocumentId }),
  asyncHandler(vouchers.downloadUrl),
);
router.post(
  '/:voucherId/send-email',
  requirePermission(PERMISSIONS.HOTEL_VOUCHERS_SEND),
  validateRequest({ params: voucherId, body: hotelVoucherEmailInputSchema }),
  asyncHandler(vouchers.sendEmail),
);

export { router as hotelVouchersRoutes };
