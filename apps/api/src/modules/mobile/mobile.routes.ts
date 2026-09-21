import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validateRequest } from '../../middleware/validate-request.js';
import { authenticateMobile } from '../../middleware/authenticate-mobile.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { mobileController } from './mobile.controller.js';
import { callsController } from './calls.controller.js';
import { recordingController } from './recording.controller.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const loginSchema = z.object({ body: z.object({ email: z.string().email(), password: z.string().min(1) }) });

// @ts-expect-error validateRequest typing matches existing auth routes
router.post('/auth/login', validateRequest(loginSchema), asyncHandler(mobileController.login));

const callSchema = z.object({ body: z.object({ androidCallSessionId: z.string().min(1), phone: z.string().min(3), direction: z.enum(['INCOMING','OUTGOING','UNKNOWN']).optional(), startedAt: z.string(), endedAt: z.string().optional().nullable(), durationSeconds: z.number().int().optional().nullable() }) });
// @ts-expect-error validateRequest typing
router.post('/calls', authenticateMobile, validateRequest(callSchema), asyncHandler(callsController.create));
router.post('/calls/:callId/recording', authenticateMobile, upload.single('audio'), asyncHandler(recordingController.upload));
router.get('/calls/:callId/play', authenticateMobile, asyncHandler(recordingController.play));

export { router as mobileRoutes };
