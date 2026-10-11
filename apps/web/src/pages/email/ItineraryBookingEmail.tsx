import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDestinations, type Destination } from '@/features/masters/masters.api';
import {
  useQuotation,
  useQuotationAction,
  type Quotation,
  type QuotationVersion,
  type SightseeingDay,
  type TemplateItinerary,
  type TemplateService,
} from '@/features/quotations/quotations.api';
import { QuotationSelector } from './QuotationSelector';
import {
  formatStayDateLong,
  type HotelEmailDraft,
} from './HotelBookingEmail';
import {
  buildWhatsAppSummary,
  whatsappMarkdownToHtml,
} from '@/features/quotations/whatsappSummary';

export interface ItineraryDestinationOption {
  /** Display name as saved on the itinerary rows. */
  name: string;
  /** Every itinerary day saved for this destination, in original order. */
  days: TemplateItinerary[];
}

/** Normalized matching key for free-text destination/city values. */
export function normalizePlaceName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Every destination with itinerary information on the applicable version, in
 * first-appearance order. Days sharing a normalized name stay grouped in
 * their original order. Blank destination rows never become options.
 */
export function itineraryDestinationOptions(
  version: Pick<QuotationVersion, 'itinerary'> | null | undefined,
): ItineraryDestinationOption[] {
  const rows = version?.itinerary ?? [];
  const byKey = new Map<string, ItineraryDestinationOption>();
  for (const row of rows) {
    const key = normalizePlaceName(row.destination);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) existing.days.push(row);
    else byKey.set(key, { name: row.destination.trim(), days: [row] });
  }
  return [...byKey.values()];
}

/**
 * Authoritative master for a destination name: exact normalized match wins.
 * An ACTIVE record is preferred when several masters share the name; without
 * any exact match there is no master (never a fuzzy substitute).
 */
export function resolveDestinationMaster(
  name: string,
  masters: Pick<Destination, 'id' | 'name' | 'status'>[],
): Pick<Destination, 'id' | 'name' | 'status'> | null {
  const key = normalizePlaceName(name);
  if (!key) return null;
  const exact = masters.filter((row) => normalizePlaceName(row.name) === key);
  return exact.find((row) => row.status === 'ACTIVE') ?? exact[0] ?? null;
}

/**
 * Every name that associates an entry with a destination: the destination
 * itself plus the cities of its resolved master record, if any.
 */
export function associationNames(
  destinationName: string,
  master: { cities?: Array<{ city?: { name?: string | null } | null }> | null } | null,
): Set<string> {
  const names = new Set<string>([normalizePlaceName(destinationName)]);
  for (const link of master?.cities ?? []) {
    const city = normalizePlaceName(link?.city?.name);
    if (city) names.add(city);
  }
  return names;
}

function belongsTo(value: string | null | undefined, names: Set<string>): boolean {
  const key = normalizePlaceName(value);
  return key !== '' && names.has(key);
}

export function itineraryDaysFor(
  days: TemplateItinerary[],
  names: Set<string>,
): TemplateItinerary[] {
  return days.filter((row) => belongsTo(row.destination, names));
}

export function sightseeingDaysFor(
  days: SightseeingDay[],
  names: Set<string>,
): SightseeingDay[] {
  return days.filter((row) => belongsTo(row.city, names));
}

/**
 * Services associated with the destination by their recorded city. HOTEL
 * rows are never itinerary content — hotel booking requests stay in the
 * Hotel workflow even when the quotation also carries hotels.
 */
export function servicesFor(
  services: TemplateService[],
  names: Set<string>,
): TemplateService[] {
  return services.filter(
    (row) => row.serviceType !== 'HOTEL' && belongsTo(row.city, names),
  );
}

/** Month-name range over dated itinerary days, else the version window, else null. */
export function destinationDateRange(
  days: Pick<TemplateItinerary, 'date'>[],
  travelStartDate: string | null | undefined,
  travelEndDate: string | null | undefined,
): string | null {
  // Order by the raw ISO value: formatted month names do not sort
  // chronologically as plain strings ('10 November' < '2 November').
  const dated = days
    .map((row) => ({ raw: (row.date ?? '').slice(0, 10), text: formatStayDateLong(row.date) }))
    .filter((entry): entry is { raw: string; text: string } => entry.text !== null)
    .sort((a, b) => (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0));
  if (dated.length > 0) {
    const first = dated[0]!.text;
    const last = dated[dated.length - 1]!.text;
    return first === last ? first : `${first} to ${last}`;
  }
  const start = formatStayDateLong(travelStartDate);
  const end = formatStayDateLong(travelEndDate);
  if (start && end) return start === end ? start : `${start} to ${end}`;
  return start ?? end;
}

export function buildItinerarySubject(input: {
  customerName?: string | null;
  destination?: string | null;
  dateRange?: string | null;
}): string {
  const parts = ['Itinerary Details'];
  if (input.customerName?.trim()) parts.push(input.customerName.trim());
  if (input.destination?.trim()) parts.push(input.destination.trim());
  if (input.dateRange?.trim()) parts.push(input.dateRange.trim());
  return parts.join(' – ');
}

/**
 * Itinerary email body, byte-for-byte the existing WhatsApp itinerary
 * message converted to email HTML. The whole applicable version feeds the
 * shared generator (no destination filtering, no email-specific format), so
 * both channels always carry the same wording, sections, dates, hotels,
 * sightseeing, and services. Optional flight/cruise/vehicle sections stay
 * off (the WhatsApp default). The Weblink section appears whenever the
 * caller provisions a URL (same `weblinkUrl` input as the WhatsApp share,
 * rendered as a clickable anchor by the shared converter); without one the
 * section is omitted exactly as in a link-less WhatsApp share.
 * The shared display wrapper is omitted: the composer editor edge-trims it
 * as a blank block (it contains `<br>` spacers), which would wipe the draft.
 */
export function buildItineraryEmailBody(input: {
  quotation: Quotation;
  version: QuotationVersion;
  companyName?: string | null;
  preparedByName?: string | null;
  weblinkUrl?: string | null;
}): string {
  const markdown = buildWhatsAppSummary({
    quotation: input.quotation,
    version: input.version,
    weblinkUrl: input.weblinkUrl ?? null,
    companyName: (input.companyName ?? '').trim() || 'Travel Agency CRM',
    preparedByName: (input.preparedByName ?? '').trim() || null,
    options: { includeFlights: false, includeCruises: false, includeVehicles: false },
  });
  return whatsappMarkdownToHtml(markdown, { wrap: false });
}

/** Applicable version mirrors the server rule: current, else latest. */
function applicableVersion(quotation: Quotation | null | undefined) {
  const versions = quotation?.versions ?? [];
  if (versions.length === 0) return null;
  return versions.find((row) => row.id === quotation?.currentVersionId) ?? versions[0]!;
}

/**
 * Itinerary workflow: searchable quotation picker, single-destination picker,
 * destination-master email resolution and draft generation. Only prepopulates
 * the composer via onGenerate — it never sends anything itself.
 */
export function ItineraryEmailFlow({
  onGenerate,
  onClear,
}: {
  onGenerate: (draft: HotelEmailDraft) => void;
  onClear: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const canViewQuotations = hasPermission(PERMISSIONS.QUOTATIONS_VIEW);
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [destinationKey, setDestinationKey] = useState<string | null>(null);

  const quotationDetails = useQuotation(canViewQuotations ? (quotationId ?? undefined) : undefined);
  const quotation: Quotation | null = (quotationDetails.data ?? null) as Quotation | null;

  const version = useMemo(() => applicableVersion(quotation), [quotation]);
  const options = useMemo(() => itineraryDestinationOptions(version), [version]);
  const selectedOption = options.find((row) => normalizePlaceName(row.name) === destinationKey) ?? null;

  // Provision the public weblink for the applicable version — the same URL
  // source as the WhatsApp share — so the email carries the identical
  // "Click on Weblink for Pricing & more details:" section. The action is
  // idempotent. Guarded on the version id so a cached link never points at
  // an older version; a missing/failed link simply omits the section.
  const [publicLinkUrl, setPublicLinkUrl] = useState<string | null>(null);
  const [publicLinkVersionId, setPublicLinkVersionId] = useState<string | null>(null);
  const quotationAction = useQuotationAction(quotationId ?? '');
  useEffect(() => {
    if (!quotation || !version) return;
    if (publicLinkVersionId === version.id && publicLinkUrl) return;
    setPublicLinkUrl(null);
    setPublicLinkVersionId(null);
    quotationAction.mutate(
      { path: 'public-link', body: { quotationVersionId: version.id } },
      {
        onSuccess: (result) => {
          const url = (result as { url?: string }).url ?? null;
          if (url) {
            setPublicLinkUrl(url);
            setPublicLinkVersionId(version.id);
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotation, version, publicLinkVersionId, publicLinkUrl]);

  // Email identity for the shared WhatsApp template (same precedence as the
  // quotation share dialog): stored preparer first, signed-in user last.
  const companyName = user?.company?.name ?? null;
  const preparedByName =
    quotation?.createdBy?.fullName ??
    version?.createdBy?.fullName ??
    user?.fullName ??
    null;

  // Resolve the authoritative master through the authorized list lookup and
  // match it exactly — never a fuzzy substitute, never another destination.
  const masterSearch = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '50' });
    if (selectedOption) params.set('search', selectedOption.name);
    return params;
  }, [selectedOption]);
  const masterList = useDestinations(masterSearch);
  const master = useMemo(
    () =>
      resolveDestinationMaster(
        selectedOption?.name ?? '',
        (masterList.data?.data ?? []) as Pick<Destination, 'id' | 'name' | 'status'>[],
      ),
    [selectedOption, masterList.data],
  );
  const masterEmail = useMemo(() => {
    const record = (masterList.data?.data ?? []).find((row) => row.id === master?.id) as
      | Destination
      | undefined;
    const email = record?.email?.trim();
    return email ? email : null;
  }, [masterList.data, master]);

  const names = useMemo(
    () =>
      associationNames(
        selectedOption?.name ?? '',
        (masterList.data?.data ?? []).find((row) => row.id === master?.id) ?? null,
      ),
    [selectedOption, masterList.data, master],
  );
  const days = useMemo(
    () => (selectedOption ? itineraryDaysFor(version?.itinerary ?? [], names) : []),
    [selectedOption, version, names],
  );
  const dateRange = useMemo(
    () =>
      selectedOption
        ? destinationDateRange(days, version?.travelStartDate, version?.travelEndDate)
        : null,
    [selectedOption, days, version],
  );

  // Switching quotations drops the previous destination and its generated draft.
  const autoAppliedForRef = useRef<string | null>(null);
  const pickQuotation = (id: string | null) => {
    autoAppliedForRef.current = null;
    setQuotationId(id);
    setDestinationKey(null);
    setPublicLinkUrl(null);
    setPublicLinkVersionId(null);
    onClear();
  };

  // A single eligible destination is populated as the consistent choice —
  // once per quotation, so clearing it back to the placeholder sticks.
  const singleKey =
    quotationId && options.length === 1 ? normalizePlaceName(options[0]?.name) : null;
  useEffect(() => {
    if (singleKey && !destinationKey && autoAppliedForRef.current !== quotationId) {
      autoAppliedForRef.current = quotationId;
      setDestinationKey(singleKey);
    }
  }, [quotationId, singleKey, destinationKey]);

  // Regenerate whenever the selected destination (or its resolved master
  // email) changes. The body comes from the shared WhatsApp template over
  // the whole version, so it also regenerates when the quotation's content,
  // counts, or preparer change. The composer keeps fields the user edited.
  const draftKey = useMemo(
    () =>
      selectedOption && version
        ? JSON.stringify({
            destination: selectedOption.name,
            email: masterEmail,
            version,
            weblink: publicLinkUrl,
            guest: quotation
              ? [
                  quotation.customerName,
                  quotation.adults,
                  quotation.childrenWithBed,
                  quotation.childrenWithoutBed,
                  quotation.infants,
                ]
              : null,
            preparedBy: preparedByName,
          })
        : null,
    [selectedOption, masterEmail, version, publicLinkUrl, quotation, preparedByName],
  );
  const lastApplied = useRef<{ quotationId: string | null; key: string | null }>({
    quotationId: null,
    key: null,
  });
  useEffect(() => {
    if (!selectedOption || !quotation || !version) return;
    if (lastApplied.current.quotationId === quotation.id && lastApplied.current.key === draftKey)
      return;
    lastApplied.current = { quotationId: quotation.id, key: draftKey };
    onGenerate({
      to: masterEmail ?? '',
      subject: buildItinerarySubject({
        customerName: quotation.customerName,
        destination: selectedOption.name,
        dateRange,
      }),
      bodyHtml: buildItineraryEmailBody({
        quotation,
        version,
        companyName,
        preparedByName,
        weblinkUrl: publicLinkUrl,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, selectedOption, quotation, version, masterEmail, dateRange, companyName, preparedByName]);

  if (!canViewQuotations) return null;

  const selectedLabel = quotation
    ? `${quotation.quotationNumber} · ${quotation.customerName}`
    : null;

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-2">
      <div>
        <span className="mb-1 block text-sm font-medium">Quotation ID *</span>
        <QuotationSelector
          selectedId={quotationId}
          selectedLabel={selectedLabel}
          onPick={pickQuotation}
        />
        {quotationId && quotationDetails.isFetching && (
          <p className="mt-1 text-xs text-muted-foreground">Loading quotation…</p>
        )}
        {quotationId && quotationDetails.isError && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            Could not load this quotation. It may no longer be shared with you.
          </p>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">Select Destination *</span>
        {!quotation ? (
          <p className="text-xs text-muted-foreground">Select a quotation first.</p>
        ) : options.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No itinerary destinations were found on this quotation.
          </p>
        ) : (
          <select
            aria-label="Select Destination"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            value={destinationKey ?? ''}
            onChange={(event) => setDestinationKey(event.target.value || null)}
          >
            <option value="">Select a destination…</option>
            {options.map((row) => (
              <option key={normalizePlaceName(row.name)} value={normalizePlaceName(row.name)}>
                {row.name} — {row.days.length} day{row.days.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        )}
        {selectedOption && masterList.isFetching && (
          <p className="mt-1 text-xs text-muted-foreground">Resolving destination email…</p>
        )}
        {selectedOption && masterList.isError && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Could not verify the destination master. Enter the recipient manually before sending.
          </p>
        )}
        {selectedOption && masterList.isSuccess && !master && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            This destination is not linked to a configured destination master. Enter the recipient
            manually before sending.
          </p>
        )}
        {selectedOption && master && !masterEmail && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            The linked destination master has no email address. Enter the correct recipient manually
            before sending.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground md:col-span-2">
        Selecting a destination fills the recipient, subject, and message below — review and edit
        them, then click Send Email. Nothing is sent automatically. See{' '}
        <Link
          className="font-medium text-brand-700 hover:underline"
          to={quotation ? `/quotations/${quotation.id}` : '/quotations'}
        >
          the quotation
        </Link>{' '}
        for full itinerary details.
      </p>
    </div>
  );
}
