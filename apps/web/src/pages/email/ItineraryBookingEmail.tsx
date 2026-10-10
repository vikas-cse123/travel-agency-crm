import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PERMISSIONS, labelForLookup } from '@interscale/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDestinations, type Destination } from '@/features/masters/masters.api';
import {
  useQuotation,
  type Quotation,
  type QuotationVersion,
  type SightseeingDay,
  type TemplateItinerary,
  type TemplateService,
} from '@/features/quotations/quotations.api';
import { QuotationSelector } from './QuotationSelector';
import {
  escapeHtml,
  formatStayDate,
  type HotelEmailDraft,
} from './HotelBookingEmail';

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

/** DD-MM-YYYY range over dated itinerary days, else the version window, else null. */
export function destinationDateRange(
  days: Pick<TemplateItinerary, 'date'>[],
  travelStartDate: string | null | undefined,
  travelEndDate: string | null | undefined,
): string | null {
  const dated = days
    .map((row) => formatStayDate(row.date))
    .filter((value): value is string => value !== null)
    .sort();
  if (dated.length > 0) {
    const first = dated[0]!;
    const last = dated[dated.length - 1]!;
    return first === last ? first : `${first} to ${last}`;
  }
  const start = formatStayDate(travelStartDate);
  const end = formatStayDate(travelEndDate);
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

interface ItineraryBodyInput {
  quotation: {
    quotationNumber?: string | null;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    adults?: number | null;
    childrenWithBed?: number | null;
    childrenWithoutBed?: number | null;
    infants?: number | null;
  };
  destinationName: string;
  dateRange: string | null;
  days: TemplateItinerary[];
  sightseeingDays: SightseeingDay[];
  services: TemplateService[];
}

/**
 * Destination-specific vendor draft from persisted records only. Sections
 * without values are omitted; pricing internals, margins and hotel-booking
 * content are never included.
 */
export function buildItineraryBody(input: ItineraryBodyInput): string {
  const { quotation, destinationName, dateRange, days, sightseeingDays, services } = input;
  const lines: string[] = [];
  lines.push('<p>Dear Team,</p>');
  lines.push(
    '<p>Please find below the itinerary details for your review and confirmation of arrangements.</p>',
  );

  const overview: string[] = [];
  if (quotation.quotationNumber?.trim())
    overview.push(`<li>Quotation reference: ${escapeHtml(quotation.quotationNumber)}</li>`);
  overview.push(`<li>Destination: ${escapeHtml(destinationName)}</li>`);
  if (dateRange) overview.push(`<li>Travel dates: ${escapeHtml(dateRange)}</li>`);
  if (days.length > 0)
    overview.push(`<li>Duration: ${days.length} day${days.length === 1 ? '' : 's'}</li>`);
  lines.push(`<p><strong>Trip Overview</strong></p><ul>${overview.join('')}</ul>`);

  const travellerItems: string[] = [];
  if (quotation.customerName.trim())
    travellerItems.push(`<li>Lead guest: ${escapeHtml(quotation.customerName)}</li>`);
  const counts: string[] = [];
  const count = (value: number | null | undefined, singular: string) =>
    typeof value === 'number' && value > 0 ? `${value} ${singular}${value === 1 ? '' : 's'}` : null;
  for (const entry of [
    count(quotation.adults, 'adult'),
    count(quotation.childrenWithBed, 'child with bed'),
    count(quotation.childrenWithoutBed, 'child without bed'),
    count(quotation.infants, 'infant'),
  ]) {
    if (entry) counts.push(entry);
  }
  if (counts.length > 0) travellerItems.push(`<li>Travellers: ${escapeHtml(counts.join(', '))}</li>`);
  if (quotation.customerPhone?.trim())
    travellerItems.push(`<li>Contact phone: ${escapeHtml(quotation.customerPhone)}</li>`);
  if (quotation.customerEmail?.trim())
    travellerItems.push(`<li>Contact email: ${escapeHtml(quotation.customerEmail)}</li>`);
  if (travellerItems.length > 0)
    lines.push(`<p><strong>Traveller Information</strong></p><ul>${travellerItems.join('')}</ul>`);

  if (days.length > 0) {
    const items = days.map((row) => {
      const head = [`Day ${row.dayNumber}`];
      const dayDate = formatStayDate(row.date);
      if (dayDate) head.push(dayDate);
      if (row.title?.trim()) head.push(escapeHtml(row.title));
      const details: string[] = [`<strong>${head.join(' · ')}</strong>`];
      if (row.description?.trim()) details.push(escapeHtml(row.description));
      if (row.activities?.trim()) details.push(`Activities: ${escapeHtml(row.activities)}`);
      if (row.transfers?.trim()) details.push(`Transfers: ${escapeHtml(row.transfers)}`);
      if (row.meals?.trim()) details.push(`Meals: ${escapeHtml(row.meals)}`);
      if (row.overnightLocation?.trim())
        details.push(`Overnight: ${escapeHtml(row.overnightLocation)}`);
      if (row.notes?.trim()) details.push(`Notes: ${escapeHtml(row.notes)}`);
      return `<li>${details.join('<br>')}</li>`;
    });
    lines.push(`<p><strong>Day-by-Day Itinerary</strong></p><ul>${items.join('')}</ul>`);
  }

  const sightItems: string[] = [];
  for (const day of sightseeingDays) {
    const head = [`Day ${day.dayNumber}`];
    const dayDate = formatStayDate(day.date);
    if (dayDate) head.push(dayDate);
    if (day.title?.trim()) head.push(escapeHtml(day.title));
    const bits: string[] = [`<strong>${head.join(' · ')}</strong>`];
    if (day.dailyTransfer && day.dailyTransfer !== 'NO_TRANSFER')
      bits.push(`Transfer: ${escapeHtml(labelForLookup(day.dailyTransfer))}`);
    for (const activity of day.activities ?? []) {
      const activityBits: string[] = [];
      if (activity.name?.trim()) activityBits.push(escapeHtml(activity.name));
      if (activity.startTime?.trim()) activityBits.push(escapeHtml(activity.startTime));
      if (activity.description?.trim()) activityBits.push(escapeHtml(activity.description));
      if (activityBits.length > 0) bits.push(`Sightseeing: ${activityBits.join(' · ')}`);
    }
    if (bits.length > 1) sightItems.push(`<li>${bits.join('<br>')}</li>`);
  }
  if (sightItems.length > 0)
    lines.push(`<p><strong>Sightseeing</strong></p><ul>${sightItems.join('')}</ul>`);

  if (services.length > 0) {
    const items = services.map((row) => {
      const bits: string[] = [`<strong>${escapeHtml(row.name)}</strong>`];
      const meta: string[] = [];
      if (row.serviceType) meta.push(escapeHtml(labelForLookup(row.serviceType)));
      if (row.dayNumber != null) meta.push(`Day ${row.dayNumber}`);
      if (row.city?.trim()) meta.push(escapeHtml(row.city));
      if (row.quantity?.trim()) meta.push(`Qty ${escapeHtml(row.quantity)}`);
      if (meta.length > 0) bits.push(meta.join(' · '));
      if (row.description?.trim()) bits.push(escapeHtml(row.description));
      return `<li>${bits.join('<br>')}</li>`;
    });
    lines.push(`<p><strong>Relevant Travel Services</strong></p><ul>${items.join('')}</ul>`);
  }

  lines.push(
    '<p>Kindly review the itinerary and confirm availability and arrangements at your earliest convenience.</p>',
  );
  lines.push('<p>Best regards</p>');
  return lines.join('');
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
  const { hasPermission } = useAuth();
  const canViewQuotations = hasPermission(PERMISSIONS.QUOTATIONS_VIEW);
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [destinationKey, setDestinationKey] = useState<string | null>(null);

  const quotationDetails = useQuotation(canViewQuotations ? (quotationId ?? undefined) : undefined);
  const quotation: Quotation | null = (quotationDetails.data ?? null) as Quotation | null;

  const version = useMemo(() => applicableVersion(quotation), [quotation]);
  const options = useMemo(() => itineraryDestinationOptions(version), [version]);
  const selectedOption = options.find((row) => normalizePlaceName(row.name) === destinationKey) ?? null;

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
  const sightDays = useMemo(
    () => (selectedOption ? sightseeingDaysFor(version?.sightseeingDetails?.days ?? [], names) : []),
    [selectedOption, version, names],
  );
  const relatedServices = useMemo(
    () => (selectedOption ? servicesFor(version?.services ?? [], names) : []),
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
  // email) changes. The composer keeps fields the user edited meanwhile.
  const draftKey = useMemo(
    () =>
      selectedOption
        ? JSON.stringify({
            destination: selectedOption.name,
            email: masterEmail,
            days,
            sightseeing: sightDays,
            services: relatedServices,
            guest: quotation
              ? [quotation.customerName, quotation.customerPhone, quotation.customerEmail]
              : null,
          })
        : null,
    [selectedOption, masterEmail, days, sightDays, relatedServices, quotation],
  );
  const lastApplied = useRef<{ quotationId: string | null; key: string | null }>({
    quotationId: null,
    key: null,
  });
  useEffect(() => {
    if (!selectedOption || !quotation) return;
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
      bodyHtml: buildItineraryBody({
        quotation,
        destinationName: selectedOption.name,
        dateRange,
        days,
        sightseeingDays: sightDays,
        services: relatedServices,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, selectedOption, quotation, masterEmail, dateRange]);

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
