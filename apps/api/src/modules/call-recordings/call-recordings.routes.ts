import { Router } from 'express';
import { requireAuth, requireVerifiedEmail } from '../../middleware/authenticate.js';
import { callRecordingsController } from './call-recordings.controller.js';

const router = Router();

router.get('/', requireAuth, requireVerifiedEmail, callRecordingsController.list);
router.get('/:callId/play', requireAuth, requireVerifiedEmail, callRecordingsController.play);

export { router as callRecordingsRoutes };
