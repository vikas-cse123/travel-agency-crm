/**
 * Repair quotations whose sightseeing days were saved with placeholder/empty
 * activities ({ sightseeingId: null, name: null }) because the prefill
 * destination filter removed every master.
 *
 * ROOT CAUSE (see selectSightseeingPrefillMasters in
 * apps/web/src/pages/quotations/QuotationBuilderPage.tsx): the lead's
 * itinerary destination can be a city (e.g. "Hanoi") while sightseeing
 * masters are organized under the parent destination (e.g. "Vietnam"), so
 * the old destination-name filter dropped all rows and empty activities
 * were saved. Saved days take precedence over prefill, freezing the empty
 * state. Deploying the fixed prefill heals NEW quotations only.
 *
 * SAFETY — READ THIS BEFORE RUNNING:
 * - DRY RUN BY DEFAULT. Without `--apply` the script only reports what it
 *   would change and writes nothing.
 * - Scoped to ONE company (`--company-id`, required). Optional
 *   `--quotation-id` narrows to a single quotation.
 * - Only DRAFT versions are eligible. FINALIZED/SUPERSEDED versions are
 *   customer-facing snapshots and are never rewritten (reported as skipped).
 * - Only versions where EVERY activity in EVERY day is a pure placeholder
 *   (sightseeingId, name and description all null) are eligible. Anything
 *   with a real activity or user-typed content is reported for manual review
 *   and left untouched.
 * - Days with no resolving master keep their empty placeholder (never
 *   attaches an unrelated activity).
 * - Images/pricing snapshots are preserved as-is; only the resolved
 *   identity fields (sightseeingId, name, startTime, showTime, duration,
 *   city, description) are filled.
 * - Every applied version is written in its own transaction plus a
 *   QUOTATION_UPDATED activity-log entry.
 * - This script is NOT wired into any npm script, migration, or deploy
 *   step. Run it explicitly and only after a database snapshot:
 *     dotenv -e ../../.env -- tsx src/scripts/repair-sightseeing-prefill.ts --company-id <uuid> [--quotation-id <uuid>] [--apply]
 *   In production also pass --allow-production (refused otherwise).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const key = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

function parseArgs(argv: string[]) {
  const out: {
    companyId: string | undefined;
    quotationId: string | undefined;
    apply: boolean | undefined;
    allowProduction: boolean | undefined;
  } = { companyId: undefined, quotationId: undefined, apply: undefined, allowProduction: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--company-id') out.companyId = argv[i + 1];
    if (argv[i] === '--quotation-id') out.quotationId = argv[i + 1];
    if (argv[i] === '--apply') out.apply = true;
    if (argv[i] === '--allow-production') out.allowProduction = true;
  }
  return out;
}

type MasterRow = {
  id: string;
  title: string;
  sequence: number;
  createdAt: Date;
  suggestedStartTime: string | null;
  estimatedHours: unknown;
  description: string | null;
  cityName: string;
};

type DayRow = {
  title?: unknown;
  city?: unknown;
  activities?: Array<Record<string, unknown>>;
  [k: string]: unknown;
};

const isPlaceholderActivity = (activity: Record<string, unknown>) =>
  activity.sightseeingId == null && activity.name == null && activity.description == null;

const isDepartureTitle = (title: string | null | undefined) =>
  (title ?? '').trim().toLowerCase().includes('departure');

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.companyId) {
    console.error('Missing required --company-id <uuid>. Refusing to run unscoped.');
    process.exitCode = 2;
    return;
  }
  if (process.env.NODE_ENV === 'production' && !args.allowProduction) {
    console.error('NODE_ENV=production: pass --allow-production to proceed. Dry run only otherwise.');
    process.exitCode = 2;
    return;
  }
  const dryRun = !args.apply;

  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { id: true, name: true },
  });
  if (!company) {
    console.error(`Company ${args.companyId} not found.`);
    process.exitCode = 2;
    return;
  }
  const systemCompany = await prisma.company.findFirst({
    where: { isSystem: true },
    select: { id: true },
  });
  const hiddenIds = systemCompany
    ? (
        await prisma.companyHiddenMaster.findMany({
          where: {
            tenantId: company.id,
            masterType: 'SIGHTSEEING',
            restoredAt: null,
          },
          select: { masterId: true },
        })
      ).map((row) => row.masterId)
    : [];
  const masterRows = await prisma.sightseeing.findMany({
    where: {
      OR: [{ companyId: company.id }, ...(systemCompany ? [{ companyId: systemCompany.id }] : [])],
      status: 'ACTIVE',
      ...(hiddenIds.length && systemCompany
        ? { NOT: { companyId: systemCompany.id, id: { in: hiddenIds } } }
        : {}),
    },
    select: {
      id: true,
      title: true,
      sequence: true,
      createdAt: true,
      suggestedStartTime: true,
      estimatedHours: true,
      description: true,
      destination: { select: { name: true, countryName: true } },
      city: { select: { name: true } },
    },
    orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const masters: Array<MasterRow & { destName: string; destCountry: string }> = masterRows.map(
    (row) => ({
      id: row.id,
      title: row.title,
      sequence: row.sequence,
      createdAt: row.createdAt,
      suggestedStartTime: row.suggestedStartTime,
      estimatedHours: row.estimatedHours as unknown,
      description: row.description,
      cityName: row.city.name,
      destName: row.destination.name,
      destCountry: row.destination.countryName ?? '',
    }),
  );

  const quotations = await prisma.quotation.findMany({
    where: {
      companyId: company.id,
      deletedAt: null,
      ...(args.quotationId ? { id: args.quotationId } : {}),
    },
    select: {
      id: true,
      quotationNumber: true,
      queryId: true,
      destinationSummary: true,
      versions: {
        select: { id: true, versionNumber: true, status: true, sightseeingDetails: true },
        orderBy: { versionNumber: 'asc' },
      },
    },
  });

  const report: Array<Record<string, unknown>> = [];
  let repairedVersions = 0;
  let repairedDays = 0;

  for (const quotation of quotations) {
    const stays = await prisma.queryItinerary.findMany({
      where: { queryId: quotation.queryId },
      select: { destination: true },
      orderBy: { sequence: 'asc' },
    });
    const token = (quotation.destinationSummary ?? '').split(/[•(→>,]/)[0]?.trim().toLowerCase() ?? '';
    for (const version of quotation.versions) {
      const details = version.sightseeingDetails as unknown as {
        days?: DayRow[];
      } | null;
      const days: DayRow[] = Array.isArray(details?.days) ? (details?.days as DayRow[]) : [];
      if (days.length === 0) {
        report.push({ quotation: quotation.quotationNumber, version: version.versionNumber, action: 'skip-no-days' });
        continue;
      }
      if (version.status !== 'DRAFT') {
        report.push({
          quotation: quotation.quotationNumber,
          version: version.versionNumber,
          action: `skip-status-${version.status}`,
        });
        continue;
      }
      const allPlaceholder = days.every(
        (day) =>
          Array.isArray(day.activities) &&
          day.activities.length > 0 &&
          day.activities.every(
            (activity) => activity && isPlaceholderActivity(activity as Record<string, unknown>),
          ),
      );
      if (!allPlaceholder) {
        report.push({
          quotation: quotation.quotationNumber,
          version: version.versionNumber,
          action: 'skip-manual-review (has real activity or user content)',
        });
        continue;
      }
      // Mirror selectSightseeingPrefillMasters: destination match first, then
      // exact-normalized city fallback over lead destinations + saved day cities.
      const destinationMatched = !token
        ? masters
        : masters.filter((row) =>
            [row.destName, row.destCountry]
              .map((value) => value.toLowerCase())
              .some((value) => Boolean(value && value.includes(token))),
          );
      let ordered = destinationMatched;
      if (ordered.length === 0) {
        const cityKeys = new Set<string>();
        for (const stay of stays) {
          const k = key(stay.destination);
          if (k) cityKeys.add(k);
        }
        for (const day of days) {
          const k = key(typeof day.city === 'string' ? day.city : null);
          if (k) cityKeys.add(k);
        }
        ordered = cityKeys.size ? masters.filter((row) => cityKeys.has(key(row.cityName))) : [];
      }
      const finalCity = key(typeof days[days.length - 1]?.city === 'string' ? (days[days.length - 1]?.city as string) : null);
      const departurePool = ordered.filter((row) => isDepartureTitle(row.title));
      const departureMaster =
        departurePool.find((row) => key(row.cityName) === finalCity) ?? departurePool[0] ?? null;
      const used = new Set<string>(departureMaster ? [departureMaster.id] : []);
      let cursor = 0;
      const nextForDay = (city: string, isLastDay: boolean) => {
        if (isLastDay && departureMaster) return departureMaster;
        const k = key(city);
        const cityMatch = ordered.find((row) => !used.has(row.id) && key(row.cityName) === k);
        if (cityMatch) {
          used.add(cityMatch.id);
          return cityMatch;
        }
        while (cursor < ordered.length && used.has(ordered[cursor]!.id)) cursor += 1;
        const next = ordered[cursor];
        if (next) {
          used.add(next.id);
          cursor += 1;
        }
        return next ?? null;
      };
      let filled = 0;
      const nextDays = days.map((day, index) => {
        const isLastDay = index === days.length - 1;
        const resolved = nextForDay(typeof day.city === 'string' ? day.city : '', isLastDay);
        if (!resolved) return day;
        const hours = resolved.estimatedHours == null ? null : Number(resolved.estimatedHours);
        filled += 1;
        return {
          ...day,
          activities: (day.activities ?? []).map((activity) => ({
            ...(activity as Record<string, unknown>),
            sightseeingId: resolved.id,
            name: resolved.title,
            startTime: resolved.suggestedStartTime,
            showTime: Boolean(resolved.suggestedStartTime),
            duration: hours == null || Number.isNaN(hours) ? null : `${hours} hours`,
            city: resolved.cityName,
            description: resolved.description,
          })),
        };
      });
      if (filled === 0) {
        report.push({
          quotation: quotation.quotationNumber,
          version: version.versionNumber,
          action: 'skip-no-resolving-master',
        });
        continue;
      }
      report.push({
        quotation: quotation.quotationNumber,
        version: version.versionNumber,
        action: dryRun ? 'would-repair' : 'repaired',
        filledDays: filled,
        totalDays: days.length,
      });
      if (dryRun) continue;
      await prisma.$transaction(async (tx) => {
        await tx.quotationVersion.update({
          where: { id: version.id },
          data: {
            sightseeingDetails: {
              ...((details ?? {}) as Record<string, unknown>),
              days: nextDays,
            } as unknown as object,
          },
        });
        await tx.activityLog.create({
          data: {
            companyId: company.id,
            action: 'QUOTATION_UPDATED',
            entityType: 'QuotationVersion',
            entityId: version.id,
            metadata: {
              script: 'repair-sightseeing-prefill',
              filledDays: filled,
              totalDays: days.length,
            },
          },
        });
      });
      repairedVersions += 1;
      repairedDays += filled;
    }
  }

  process.stdout.write(
    `${dryRun ? 'DRY RUN — no writes performed' : 'APPLIED'} for ${company.name} (${company.id}): ` +
      `${repairedVersions} version(s), ${repairedDays} day(s) ${dryRun ? 'would be repaired' : 'repaired'}.\n`,
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
