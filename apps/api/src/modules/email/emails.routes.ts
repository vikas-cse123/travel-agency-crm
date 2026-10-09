import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, emailSendInputSchema } from '@interscale/shared';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { emailController as c } from './email.controller.js';

const router = Router();
const emailId = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED']).optional(),
});

router.use(requireAuth, requireVerifiedEmail);

router.get(
  '/',
  requirePermission(PERMISSIONS.EMAILS_VIEW),
  validateRequest({ query: listQuery }),
  asyncHandler(c.list),
);
router.post(
  '/',
  requirePermission(PERMISSIONS.EMAILS_SEND),
  validateRequest({ body: emailSendInputSchema }),
  asyncHandler(c.send),
);
router.get(
  '/:id',
  requirePermission(PERMISSIONS.EMAILS_VIEW),
  validateRequest({ params: emailId }),
  asyncHandler(c.details),
);

export { router as emailsRoutes };
