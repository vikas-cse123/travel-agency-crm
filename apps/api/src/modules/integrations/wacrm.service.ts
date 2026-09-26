import { ERROR_CODES, queryInputSchema, type WacrmLeadPayload } from '@interscale/shared';
import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { AppError, NotFoundError } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/normalize.js';
import {
  getVisible,
  queriesService,
  type RequestContext,
} from '../queries/queries.service.js';
import { destinationsService } from '../masters/masters.service.js';

/**
 * WACRM server-to-server lead creation.
 *
 * Flow per request (idempotency key = company + wacrmAccountId +
 * flowRunId):
 *   1. look up the link row — a stored queryId returns the existing
 *      lead without creating (deleted leads fall through to
 *      re-create and re-link);
 *   2. otherwise claim a `pending` row first (unique constraint
 *      serializes concurrent retries; a live `pending` row from a
 *      crashed attempt is a 409, never a silent duplicate);
 *   3. resolve `assignedToEmail` to an ACTIVE same-company user —
 *      unknown emails fail closed without creating;
 *   4. delegate to `queriesService.create` (same validation,
 *      transaction, histories, and audit as the UI path);
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
 * Reuses the native Destinations master via `destinationsService.list`
 * — the same service (and visibility rules) behind
 * `GET /masters/destinations` that the Travel CRM lead form
 * (`LeadForm.tsx` → `useDestinations`) reads. No separate destination
 * source: stable master ids become `value`, names become `label`, and
 * each linked city carries its parent destination's `value` as
 * `destinationValue`. Only ACTIVE rows are exposed (the list service
 * forces ACTIVE for non-managers; linked cities are filtered to
 * ACTIVE here since the master include carries every link).
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
    city?: { id: string; name: string; status?: string } | null;
  }>;
}

async function itineraryDestinationFeed(auth: AuthContext): Promise<ItineraryDestinationFeed> {
  const destinations: ItineraryDestinationFeed['destinations'] = [];
  const cities: ItineraryDestinationFeed['cities'] = [];
  const seenDestinations = new Set<string>();
  const seenCityLinks = new Set<string>();
  let page = 1;
  for (;;) {
    const result = await destinationsService.list(auth, {
      status: 'ACTIVE',
      page,
      pageSize: 100,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    for (const row of result.data as unknown as MasterDestinationRow[]) {
      if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') continue;
      if (!seenDestinations.has(row.id)) {
        seenDestinations.add(row.id);
        destinations.push({ value: row.id, label: row.name });
      }
      for (const link of row.cities ?? []) {
        const city = link?.city;
        if (!city || typeof city.id !== 'string' || typeof city.name !== 'string') continue;
        if (city.status && city.status !== 'ACTIVE') continue;
        const key = `${row.id}:${city.id}`;
        if (seenCityLinks.has(key)) continue;
        seenCityLinks.add(key);
        cities.push({ value: city.id, label: city.name, destinationValue: row.id });
      }
    }
    if (page >= result.pagination.totalPages || result.data.length === 0) break;
    page += 1;
  }
  return { destinations, cities };
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
    const { companyId } = auth;
    const { wacrmAccountId, flowRunId } = input;

    const existing = await findLink(companyId, wacrmAccountId, flowRunId);
    if (existing?.queryId) {
      try {
        await getVisible(auth, existing.queryId);
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

    const email = normalizeEmail(input.assignedToEmail);
    const assignee = await prisma.user.findFirst({
      where: {
        companyId,
        normalizedEmail: email,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!assignee) {
      await markLinkFailed(linkId, `ASSIGNED_USER_NOT_FOUND:${email}`);
      throw new AssigneeNotFoundError(input.assignedToEmail.trim());
    }

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
        assignedToId: assignee.id,
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
      const created = await queriesService.create(auth, queryInput, context);
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

  async lookups(auth: AuthContext) {
    const base = await queriesService.lookups(auth);
    const feed = await itineraryDestinationFeed(auth);
    return {
      ...base,
      destinations: feed.destinations,
      cities: feed.cities,
    };
  },
};
