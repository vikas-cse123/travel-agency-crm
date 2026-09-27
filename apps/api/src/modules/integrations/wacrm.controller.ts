import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/api-response.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { credentialsService } from './credentials.service.js';
import { wacrmService } from './wacrm.service.js';

function auth(req: Request) {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

function context(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

export const integrationsController = {
  async mintCredential(req: Request, res: Response) {
    sendSuccess(
      res,
      await credentialsService.mint(auth(req), req.body),
      'Integration credential created. Copy the token now — it is never shown again.',
      201,
    );
  },

  async listCredentials(req: Request, res: Response) {
    sendSuccess(res, await credentialsService.list(auth(req)));
  },

  async revokeCredential(req: Request, res: Response) {
    sendSuccess(
      res,
      await credentialsService.revoke(auth(req), req.params.id!),
      'Integration credential revoked.',
    );
  },

  async wacrmLookups(req: Request, res: Response) {
    // The `assignedToEmail` query locator identifies the linked Travel
    // CRM account for the calling WACRM workspace (resolved server-side
    // by WACRM, never free-form). It re-scopes the itinerary feed so a
    // shared integration secret never surfaces another account's master
    // data. Absent/unresolvable locators fall back to the credential's
    // company inside the service.
    const rawEmail = (req.query ?? {}).assignedToEmail;
    const ownerEmail =
      typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim() : null;
    sendSuccess(res, await wacrmService.lookups(auth(req), ownerEmail));
  },

  async wacrmCreateLead(req: Request, res: Response) {
    const result = await wacrmService.createLead(auth(req), req.body, context(req));
    if (result.alreadyExists) {
      sendSuccess(res, result, 'Lead already exists.');
      return;
    }
    sendSuccess(res, result, 'Lead created.', 201);
  },
};
