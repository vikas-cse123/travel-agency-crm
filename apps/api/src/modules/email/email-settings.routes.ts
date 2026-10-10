import { Router } from 'express';
import { PERMISSIONS, emailSettingsInputSchema, emailTestInputSchema } from '@interscale/shared';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { validateRequest } from '../../middleware/validate-request.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { emailController as c } from './email.controller.js';

const router = Router();

router.use(requireAuth, requireVerifiedEmail);

router.get('/', requirePermission(PERMISSIONS.EMAILS_MANAGE_SETTINGS), asyncHandler(c.settings));
router.put(
  '/',
  requirePermission(PERMISSIONS.EMAILS_MANAGE_SETTINGS),
  validateRequest({ body: emailSettingsInputSchema }),
  asyncHandler(c.saveSettings),
);
router.post(
  '/test',
  requirePermission(PERMISSIONS.EMAILS_MANAGE_SETTINGS),
  validateRequest({ body: emailTestInputSchema }),
  asyncHandler(c.sendTest),
);
router.delete(
  '/',
  requirePermission(PERMISSIONS.EMAILS_MANAGE_SETTINGS),
  asyncHandler(c.removeSettings),
);

export { router as emailSettingsRoutes };
