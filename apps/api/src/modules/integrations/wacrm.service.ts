import { ERROR_CODES, queryInputSchema, type WacrmLeadPayload } from '@interscale/shared';
import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { AppError, NotFoundError } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import { createTenantContext } from '../../db/tenant.js';
import {
  getVisible,
  queriesService,
  type RequestContext,
} from '../queries/queries.service.js';

/**
 * WACRM server-to-server lead creation.
 *
 * The Travel CRM assignee and the lead's company context are determined
 * SOLELY by the WACRM workspace owner's email (`assignedToEmail`,
 * resolved server-side by WACRM): the matching Travel CRM user and that
 * user's own company — never the integration credential's company, never
 * the WACRM lead's "Assigned To".
 *
 * Flow per request (idempotency key = owner company + wacrmAccountId +
 * flowRunId):
 *   1. resolve `assignedToEmail` (the WACRM workspace owner) to an
 *      ACTIVE, non-deleted Travel CRM user by normalized email across
 *      the whole database — no match fails closed with
 *      ASSIGNED_USER_NOT_FOUND (no fallback, no auto-created user);
 *   2. look up the link row keyed by the OWNER's company — a stored
 *      queryId returns the existing lead without creating;
 *   3. otherwise claim a `pending` row first (unique constraint
 *      serializes concurrent retries; a live `pending` row from a
 *      crashed attempt is a 409, never a silent duplicate);
 *   4. delegate to `queriesService.create` (same validation,
 *      transaction, histories, and audit as the UI path) in the
 *      owner's company, assigned to that owner user;
 *   5. mark the link `created` with the real query id (failures
 *      mark it `failed` with the reason and rethrow).
 *
 * Privileged values (tenant, actor, assignee id) all derive
 * server-side; the request contributes only lead data.
 */

export class AssigneeNotFoundError extends AppError {
  constructor(email: string) {
    super(
      `No assignable Travel CRM user matches email "${email}".`,
      400,
      ERROR_CODES.ASSIGNED_USER_NOT_FOUND,
    );
  }
}

const LINK_SELECT = { id: true, queryId: true, status: true } as const;

/**
 * Itinerary destination feed for the WACRM integration.
 *
 * Strictly TENANT-SCOPED: only destinations and cities OWNED by the
 * scope company are exposed. This deliberately excludes the System
 * Global Masters company's records — a tenant's WACRM dropdown must
 * show only the linked account's own master data, never the shared
 * global list another tenant also sees in the native UI. No separate
 * destination source: stable master ids become `value`, names become
 * `label`, and each linked city carries its parent destination's
 * `value` as `destinationValue`. Only ACTIVE rows are
 * exposed, and linked cities must belong to the same scope company
 * (a cross-company city can never leak into another workspace's feed).
 */
interface ItineraryDestinationFeed {
  destinations: Array<{ value: string; label: string }>;
  cities: Array<{ value: string; label: string; destinationValue: string }>;
}

interface MasterDestinationRow {
  id: string;
  name: string;
  cities?: Array<{
    cityId: string;
    city?: { id: string; name: string; companyId: string; status?: string } | null;
  }>;
}

async function itineraryDestinationFeed(companyId: string): Promise<ItineraryDestinationFeed> {
  const destinations: ItineraryDestinationFeed['destinations'] = [];
  const cities: ItineraryDestinationFeed['cities'] = [];
  const seenDestinations = new Set<string>();
  const seenCityLinks = new Set<string>();
  const rows = await prisma.destination.findMany({
    where: {
      companyId,
      status: 'ACTIVE',
    },
    orderBy: { name: 'asc' },
    include: { cities: { orderBy: { sequence: 'asc' }, include: { city: true } } },
  });
  for (const row of rows as unknown as MasterDestinationRow[]) {
    if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    if (!seenDestinations.has(row.id)) {
      seenDestinations.add(row.id);
      destinations.push({ value: row.id, label: row.name });
    }
    for (const link of row.cities ?? []) {
      const city = link?.city;
      if (!city || typeof city.id !== 'string' || typeof city.name !== 'string') continue;
      // Tenant isolation: a city is exposed only when it belongs to
      // the same scope company as its destination. Global/system
      // cities and any city owned by another account are excluded.
      if (city.companyId !== companyId) continue;
      if (city.status && city.status !== 'ACTIVE') continue;
      const key = `${row.id}:${city.id}`;
      if (seenCityLinks.has(key)) continue;
      seenCityLinks.add(key);
      cities.push({ value: city.id, label: city.name, destinationValue: row.id });
    }
  }
  return { destinations, cities };
}

/**
 * Resolve the company whose itinerary master data a WACRM lookups
 * request must see.
 *
 * The Bearer credential authenticates the WACRM integration, while
 * the `assignedToEmail` locator — resolved server-side by WACRM from
 * the requesting account's OWN rows, never request input — identifies
 * the Travel CRM account a WACRM workspace is linked to. When a
 * shared integration secret is bound to one company but the calling
 * workspace belongs to another, scoping by the credential alone would
 * leak one customer's master data to another; the locator re-scopes
 * the feed to the linked company so each workspace receives only its
 * own destinations/cities. The locator is honored only when it
 * resolves to exactly one non-deleted Travel CRM user; anything else
 * falls back to the credential's company (never guesses, never fails
 * hard, never crosses the credential's own company silently).
 */
async function resolveItineraryScopeCompany(
  auth: AuthContext,
  ownerEmail: string | null,
): Promise<string> {
  const normalized = normalizeEmail(ownerEmail ?? '');
  if (!normalized) return auth.companyId;
  const matches = await prisma.user.findMany({
    where: { normalizedEmail: normalized, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (matches.length === 1) return matches[0]!.companyId;
  return auth.companyId;
}

async function findLink(companyId: string, wacrmAccountId: string, flowRunId: string) {
  return prisma.wacrmLeadLink.findUnique({
    where: { companyId_wacrmAccountId_flowRunId: { companyId, wacrmAccountId, flowRunId } },
    select: LINK_SELECT,
  });
}

async function markLinkFailed(id: string, error: unknown) {
  try {
    await prisma.wacrmLeadLink.update({
      where: { id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 1000) : 'Lead creation failed.',
      },
    });
  } catch (err) {
    console.error('[wacrm] link failure-mark failed:', err);
  }
}

export const wacrmService = {
  async createLead(
    auth: AuthContext,
    input: WacrmLeadPayload,
    context: RequestContext,
  ): Promise<{ leadId: string; alreadyExists: boolean }> {
    const { wacrmAccountId, flowRunId } = input;

    // --- Owner-email assignment: the ONLY assignee/company mapping. ---
    // `input.assignedToEmail` is ALWAYS the WACRM workspace owner's email
    // (resolved server-side by WACRM from the authenticated account —
    // never the WACRM lead's "Assigned To", never an assignedUserId
    // override). The Travel CRM assignee and the lead's company context
    // are determined EXCLUSIVELY by that email: find the Travel CRM user
    // with the normalized (trim + lowercase) email across the whole
    // database, require ACTIVE + non-deleted, and use THAT user's own
    // company as the company the lead is created in and THAT user as the
    // assignee. The integration credential's companyId is NEVER used to
    // pick the assignee or the tenant. Any miss fails closed with
    // ASSIGNED_USER_NOT_FOUND — no silent fallback, no auto-created user.
    const ownerEmail = normalizeEmail(input.assignedToEmail);
    const ownerUser = await prisma.user.findFirst({
      where: {
        normalizedEmail: ownerEmail,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, companyId: true },
    });
    if (!ownerUser) {
      throw new AssigneeNotFoundError(input.assignedToEmail.trim());
    }
    const companyId = ownerUser.companyId;
    // Lead creation runs in the OWNER's company as the owner user (the
    // credential only authenticates the WACRM integration; it never
    // determines the tenant or the actor for the created lead).
    const ownerAuth: AuthContext = {
      ...auth,
      userId: ownerUser.id,
      companyId,
      tenant: createTenantContext(companyId),
    };

    const existing = await findLink(companyId, wacrmAccountId, flowRunId);
    if (existing?.queryId) {
      try {
        await getVisible(ownerAuth, existing.queryId);
        return { leadId: existing.queryId, alreadyExists: true };
      } catch (err) {
        // Linked lead is gone (deleted) — fall through and re-link.
        if (!(err instanceof NotFoundError)) throw err;
      }
    }

    let link = existing;
    if (!link) {
      try {
        link = await prisma.wacrmLeadLink.create({
          data: {
            companyId,
            wacrmAccountId,
            flowRunId,
            status: 'pending',
          },
          select: LINK_SELECT,
        });
      } catch (err) {
        // Lost a race with a concurrent identical request.
        if (
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: unknown }).code === 'P2002'
        ) {
          const raced = await findLink(companyId, wacrmAccountId, flowRunId);
          if (raced?.queryId) return { leadId: raced.queryId, alreadyExists: true };
          throw new AppError(
            'This lead is already being created. Retry in a moment.',
            409,
            ERROR_CODES.CONFLICT,
          );
        }
        throw err;
      }
    } else if (link.status !== 'pending' || link.queryId) {
      // Stale non-pending row without a lead (e.g. a previous failed
      // attempt): reset to pending for this attempt.
      link = await prisma.wacrmLeadLink.update({
        where: { id: link.id },
        data: { status: 'pending', error: null },
        select: LINK_SELECT,
      });
    }
    const linkId = link.id;

    try {
      // Re-parse through the canonical lead schema so UI-only
      // defaults (priority, currency, traveller counts) apply
      // identically to the interactive path. Values were already
      // validated at the route; this only completes defaults.
      const queryInput = queryInputSchema.parse({
        customerName: input.customerName,
        phone: input.phone,
        email: input.email ?? undefined,
        leadSource: input.leadSource,
        leadType: input.leadType,
        leadStage: input.leadStage,
        assignedToId: ownerUser.id,
        dateOfBirth: input.dateOfBirth ?? undefined,
        travelStartDate: input.travelStartDate ?? undefined,
        departureCountry: input.departureCountry ?? undefined,
        departureCity: input.departureCity ?? undefined,
        rooms: input.rooms ?? undefined,
        adults: input.adults ?? undefined,
        childrenWithBed: input.childrenWithBed ?? undefined,
        childrenWithoutBed: input.childrenWithoutBed ?? undefined,
        infants: input.infants ?? undefined,
        childrenWithBedAges: input.childrenWithBedAges ?? undefined,
        childrenWithoutBedAges: input.childrenWithoutBedAges ?? undefined,
        infantAges: input.infantAges ?? undefined,
        services: [...input.services],
        itinerary: input.itinerary.map((row, i) => ({
          country: row.country,
          destination: row.destination,
          nights: row.nights,
          sequence: row.sequence ?? i + 1,
        })),
      });
      const created = await queriesService.create(ownerAuth, queryInput, context);
      await prisma.wacrmLeadLink.update({
        where: { id: linkId },
        data: { status: 'created', queryId: created.id, error: null },
      });
      return { leadId: created.id, alreadyExists: false };
    } catch (err) {
      await markLinkFailed(linkId, err);
      throw err;
    }
  },

  async lookups(auth: AuthContext, ownerEmail: string | null = null) {
    const base = await queriesService.lookups(auth);
    const scopeCompanyId = await resolveItineraryScopeCompany(auth, ownerEmail);
    const feed = await itineraryDestinationFeed(scopeCompanyId);
    return {
      ...base,
      destinations: feed.destinations,
      cities: feed.cities,
    };
  },
};
