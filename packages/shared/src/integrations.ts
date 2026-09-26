import { z } from 'zod';

import { LEAD_STAGES, LEAD_SOURCES, LEAD_TYPES, SERVICE_TYPES } from './queries.js';

/**
 * WACRM server-to-server lead-creation contract.
 *
 * Mirrors the audited Travel CRM lead form (`queryInputSchema`) but
 * scoped to what an external integration may supply: no customer
 * linking, no follow-ups, no financials. Enum values are the exact
 * Travel CRM enums — WACRM must fetch them from the integration
 * lookups endpoint, never hardcode them. Itinerary rows carry an
 * explicit `sequence` (unique per lead), matching the core schema.
 */

export const WACRM_INTEGRATION_TYPE = 'wacrm' as const;

export const wacrmItineraryRowSchema = z.object({
  country: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(120),
  nights: z.coerce.number().int().min(0).max(365),
  sequence: z.coerce.number().int().min(1).max(100),
});

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalDate = z.coerce.date().nullable().optional();

export const wacrmLeadPayloadSchema = z
  .object({
    /** Opaque WACRM account id — idempotency scope only, never a tenant override. */
    wacrmAccountId: z.string().uuid(),
    /** Stable WACRM lead identity (flow run) — idempotency key with the above. */
    flowRunId: z.string().uuid(),
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(32),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
    leadSource: z.enum(LEAD_SOURCES),
    leadType: z.enum(LEAD_TYPES),
    leadStage: z.enum(LEAD_STAGES),
    /** Owner email in the target tenant; resolved to a user id server-side. */
    assignedToEmail: z.string().trim().email().max(255),
    dateOfBirth: optionalDate,
    travelStartDate: optionalDate,
    departureCountry: optionalText(80),
    departureCity: optionalText(100),
    rooms: z.coerce.number().int().min(1).max(100).nullable().optional(),
    adults: z.coerce.number().int().min(1).max(200).nullable().optional(),
    childrenWithBed: z.coerce.number().int().min(0).max(100).nullable().optional(),
    childrenWithoutBed: z.coerce.number().int().min(0).max(100).nullable().optional(),
    infants: z.coerce.number().int().min(0).max(100).nullable().optional(),
    // Optional per-child ages — same rules as the core lead schema
    // (integers 0–30). Absent/null means "none provided" (never a
    // rejection reason); the core schema defaults them to [].
    childrenWithBedAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    childrenWithoutBedAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    infantAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    services: z.array(z.enum(SERVICE_TYPES)).min(1),
    itinerary: z.array(wacrmItineraryRowSchema).min(1).max(100),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.itinerary.map((r) => r.sequence)).size !== v.itinerary.length)
      ctx.addIssue({
        code: 'custom',
        path: ['itinerary'],
        message: 'Itinerary sequence values must be unique.',
      });
  });

export type WacrmLeadPayload = z.infer<typeof wacrmLeadPayloadSchema>;

export const wacrmCredentialMintSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Service identity the credential acts as (must be ACTIVE in the company). */
  userId: z.string().uuid(),
  /** Lifetime in days; omitted means no expiry. */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export type WacrmCredentialMint = z.infer<typeof wacrmCredentialMintSchema>;

export const wacrmCredentialImportSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Service identity the credential acts as (must be ACTIVE in the company). */
  userId: z.string().uuid(),
  /**
   * The caller-owned existing secret (e.g. the permanent WACRM secret
   * already configured on the caller side). Accepted once over this
   * authenticated session route only; the server stores the SHA-256 hash
   * and never returns or logs the plaintext.
   */
  secret: z.string().trim().min(7).max(160),
});

export type WacrmCredentialImport = z.infer<typeof wacrmCredentialImportSchema>;
