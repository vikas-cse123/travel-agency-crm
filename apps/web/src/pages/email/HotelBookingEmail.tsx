import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PERMISSIONS,
  hotelStayNights,
  resolveHotelMealPlanLines,
  resolveHotelRoomLines,
} from '@interscale/shared';
import { useAuth } from '@/features/auth/AuthProvider';
import { useHotel, type Hotel } from '@/features/masters/masters.api';
import { useLead } from '@/features/queries/queries.api';
import {
  useQuotation,
  type Quotation,
  type TemplateHotel,
} from '@/features/quotations/quotations.api';
import { QuotationSelector } from './QuotationSelector';
import { resolveTravellerNames, travellerNameItems, type TravellerNameEntry } from './travellerNames';

export type EmailPurpose = 'hotel' | 'itinerary';

export interface HotelEmailDraft {
  to: string;
  subject: string;
  bodyHtml: string;
}

/** Minimal HTML escaping for values interpolated into the generated draft. */
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Display-only DD-MM-YYYY for an ISO calendar value. Anything unparseable
 * resolves to null so callers omit it instead of showing ISO text or
 * "Invalid Date". No timezone conversion is applied.
 */
export function formatStayDate(value: string | null | undefined): string | null {
  const day = (value ?? '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [, year, month, date] = match as unknown as [string, string, string, string];
  const monthNumber = Number(month);
  const dateNumber = Number(date);
  if (monthNumber < 1 || monthNumber > 12 || dateNumber < 1 || dateNumber > 31) return null;
  return `${date}-${month}-${year}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Display-only "18 October 2026" for an ISO calendar value, used by the
 * generated email subjects and bodies. Same parsing and omission rules as
 * formatStayDate (which stays DD-MM-YYYY for the hotel dropdown summary):
 * anything unparseable resolves to null, and no timezone conversion is
 * applied so the calendar day never shifts.
 */
export function formatStayDateLong(value: string | null | undefined): string | null {
  const day = (value ?? '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [, year, month, date] = match as unknown as [string, string, string, string];
  const monthNumber = Number(month);
  const dateNumber = Number(date);
  if (monthNumber < 1 || monthNumber > 12 || dateNumber < 1 || dateNumber > 31) return null;
  return `${dateNumber} ${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

function stayDateRange(hotel: TemplateHotel): string | null {
  const checkIn = formatStayDate(hotel.checkInDate);
  const checkOut = formatStayDate(hotel.checkOutDate);
  if (checkIn && checkOut) return `${checkIn} to ${checkOut}`;
  return checkIn ?? checkOut;
}

/** Month-name range for generated email subjects; same omission rules. */
function stayDateRangeLong(hotel: TemplateHotel): string | null {
  const checkIn = formatStayDateLong(hotel.checkInDate);
  const checkOut = formatStayDateLong(hotel.checkOutDate);
  if (checkIn && checkOut) return `${checkIn} to ${checkOut}`;
  return checkIn ?? checkOut;
}

/** Nights for a stay: calendar calculation first, then the saved snapshot. */
function stayNights(hotel: TemplateHotel): number | null {
  const computed = hotelStayNights(hotel.checkInDate, hotel.checkOutDate);
  if (computed != null) return computed;
  const saved = (hotel as { nights?: unknown }).nights;
  return typeof saved === 'number' && saved > 0 ? saved : null;
}

/** One-line summary distinguishing a stay inside the hotel dropdown. */
export function hotelOptionSummary(hotel: TemplateHotel, index: number): string {
  const bits = [`Stay ${index + 1}`, hotel.city].filter(Boolean);
  const range = stayDateRange(hotel);
  if (range) bits.push(range);
  const lines = resolveHotelRoomLines(hotel);
  const first = lines[0];
  if (first?.roomType) {
    bits.push(`${first.roomType} × ${first.rooms ?? 1}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''}`);
  }
  return bits.join(' · ');
}

export function buildHotelBookingSubject(input: {
  customerName?: string | null;
  hotelName?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
}): string {
  const parts = ['Hotel Booking Request'];
  if (input.customerName?.trim()) parts.push(input.customerName.trim());
  if (input.hotelName?.trim()) parts.push(input.hotelName.trim());
  const range = stayDateRangeLong({
    checkInDate: input.checkInDate ?? null,
    checkOutDate: input.checkOutDate ?? null,
  } as TemplateHotel);
  if (range) parts.push(range);
  return parts.join(' – ');
}

interface BodyInput {
  quotation: {
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
  };
  hotel: TemplateHotel;
  master: Pick<
    Hotel,
    'name' | 'address' | 'phone' | 'email' | 'city'
  > | null;
  /** Resolved traveller entries (quotation first, lead fallback); none when empty. */
  travellers?: TravellerNameEntry[];
}

/**
 * Professional booking-request draft from persisted records only. Sections
 * without values are omitted entirely — nothing is invented, and no
 * confirmation is ever implied.
 */
export function buildHotelBookingBody({ quotation, hotel, master, travellers = [] }: BodyInput): string {
  const lines: string[] = [];
  lines.push('<p>Dear Reservations Team,</p>');
  lines.push(
    '<p>Please find below the hotel accommodation details for booking confirmation.</p>',
  );

  const guestItems: string[] = [];
  if (quotation.customerName.trim()) guestItems.push(`<li>Guest name: ${escapeHtml(quotation.customerName)}</li>`);
  if (quotation.customerPhone?.trim())
    guestItems.push(`<li>Phone: ${escapeHtml(quotation.customerPhone)}</li>`);
  if (quotation.customerEmail?.trim())
    guestItems.push(`<li>Email: ${escapeHtml(quotation.customerEmail)}</li>`);
  if (guestItems.length > 0)
    lines.push(`<p><strong>Guest Details</strong></p><ul>${guestItems.join('')}</ul>`);
  if (travellers.length > 0)
    lines.push(
      `<p><strong>Traveller Details</strong></p><ul>${travellerNameItems(travellers)}</ul>`,
    );

  const hotelItems: string[] = [`<li>Hotel name: ${escapeHtml(hotel.hotelName)}</li>`];
  const city = master?.city?.name ?? hotel.city;
  if (city?.trim()) hotelItems.push(`<li>City: ${escapeHtml(city)}</li>`);
  if (master?.address?.trim()) hotelItems.push(`<li>Address: ${escapeHtml(master.address)}</li>`);
  if (master?.phone?.trim()) hotelItems.push(`<li>Phone: ${escapeHtml(master.phone)}</li>`);
  if (master?.email?.trim()) hotelItems.push(`<li>Email: ${escapeHtml(master.email)}</li>`);
  lines.push(`<p><strong>Hotel Details</strong></p><ul>${hotelItems.join('')}</ul>`);

  const stayItems: string[] = [];
  const checkIn = formatStayDateLong(hotel.checkInDate);
  const checkOut = formatStayDateLong(hotel.checkOutDate);
  if (checkIn) stayItems.push(`<li>Check-in date: ${checkIn}</li>`);
  if (checkOut) stayItems.push(`<li>Check-out date: ${checkOut}</li>`);
  const nights = stayNights(hotel);
  if (nights != null) stayItems.push(`<li>Number of nights: ${nights}</li>`);
  if (stayItems.length > 0)
    lines.push(`<p><strong>Stay Details</strong></p><ul>${stayItems.join('')}</ul>`);

  const roomLines = resolveHotelRoomLines(hotel);
  if (roomLines.length > 0) {
    const items = roomLines.map((line) => {
      const bits: string[] = [`${escapeHtml(line.roomType ?? 'Room')} × ${line.rooms ?? 1}`];
      if ((line.extraBedQuantity ?? 0) > 0) bits.push(`${line.extraBedQuantity} extra bed(s)`);
      if ((line.childWithoutBedQuantity ?? 0) > 0)
        bits.push(`${line.childWithoutBedQuantity} child without bed`);
      if (line.notes?.trim()) bits.push(`Remarks: ${escapeHtml(line.notes)}`);
      return `<li>${bits.join(' · ')}</li>`;
    });
    lines.push(`<p><strong>Room Configuration</strong></p><ul>${items.join('')}</ul>`);
  }

  const mealLines = resolveHotelMealPlanLines(hotel);
  const meals = mealLines.map((line) => line.mealPlan?.trim()).filter(Boolean) as string[];
  if (meals.length > 0)
    lines.push(
      `<p><strong>Meal Plans</strong></p><ul>${meals.map((meal) => `<li>${escapeHtml(meal)}</li>`).join('')}</ul>`,
    );

  if (hotel.notes?.trim())
    lines.push(
      `<p><strong>Additional Details</strong></p><ul><li>${escapeHtml(hotel.notes)}</li></ul>`,
    );

  lines.push(
    '<p>Kindly confirm availability and the booking arrangements at your earliest convenience.</p>',
  );
  lines.push('<p>Best regards</p>');
  return lines.join('');
}

/** Applicable version mirrors the server rule: current, else latest. */
function applicableHotels(quotation: Quotation | null | undefined): TemplateHotel[] {
  const versions = quotation?.versions ?? [];
  if (versions.length === 0) return [];
  const current =
    versions.find((row) => row.id === quotation?.currentVersionId) ?? versions[0]!;
  return current.hotels ?? [];
}

export function EmailPurposeSelector({
  value,
  onChange,
}: {
  value: EmailPurpose;
  onChange: (purpose: EmailPurpose) => void;
}) {
  const card = (active: boolean) =>
    `flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-brand-600 bg-brand-50 text-brand-800'
        : 'border-border bg-card text-muted-foreground hover:border-slate-300 hover:text-slate-700'
    }`;
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium">Email purpose</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Email purpose">
        <label className={card(value === 'hotel')}>
          <input
            type="radio"
            name="email-purpose"
            value="hotel"
            checked={value === 'hotel'}
            onChange={() => onChange('hotel')}
            className="accent-brand-600"
          />
          Hotel
        </label>
        <label className={card(value === 'itinerary')}>
          <input
            type="radio"
            name="email-purpose"
            value="itinerary"
            checked={value === 'itinerary'}
            onChange={() => onChange('itinerary')}
            className="accent-brand-600"
          />
          Itinerary
        </label>
      </div>
    </fieldset>
  );
}

/**
 * Hotel workflow: searchable quotation picker, single-hotel picker, master
 * email resolution and draft generation. Only prepopulates the composer via
 * onGenerate — it never sends anything itself.
 */
export function HotelEmailFlow({
  onGenerate,
  onClear,
}: {
  onGenerate: (draft: HotelEmailDraft) => void;
  onClear: () => void;
}) {
  const { hasPermission } = useAuth();
  const canViewQuotations = hasPermission(PERMISSIONS.QUOTATIONS_VIEW);
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);

  const quotationDetails = useQuotation(canViewQuotations ? (quotationId ?? undefined) : undefined);
  const quotation: Quotation | null = (quotationDetails.data ?? null) as Quotation | null;

  const hotels = useMemo(() => applicableHotels(quotation), [quotation]);
  const selectedHotel = hotels.find((row) => row.id === hotelId) ?? null;
  const master = useHotel(selectedHotel?.hotelId ?? undefined);
  const masterEmail = master.data?.email?.trim() ? master.data.email.trim() : null;

  // Traveller names come from the quotation's own lists first; the linked
  // lead is only a fallback for quotations saved before names existed. The
  // lead is fetched lazily and only when the quotation itself has no names.
  const quotationHasNames = useMemo(
    () => resolveTravellerNames(quotation, null).source === 'quotation',
    [quotation],
  );
  const leadQuery = useLead(
    canViewQuotations && selectedHotel && !quotationHasNames
      ? (quotation?.queryId ?? undefined)
      : undefined,
  );
  const travellers = useMemo(
    () => resolveTravellerNames(quotation, leadQuery.data ?? null).entries,
    [quotation, leadQuery.data],
  );

  const autoAppliedForRef = useRef<string | null>(null);

  // Switching quotations drops the previous stay and its generated draft.
  const pickQuotation = (id: string | null) => {
    autoAppliedForRef.current = null;
    setQuotationId(id);
    setHotelId(null);
    onClear();
  };

  // A single available stay is populated as the consistent choice — once per
  // quotation, so clearing it back to the placeholder sticks.
  const singleHotelId = hotels.length === 1 ? (hotels[0]?.id ?? null) : null;
  useEffect(() => {
    if (quotationId && singleHotelId && !hotelId && autoAppliedForRef.current !== quotationId) {
      autoAppliedForRef.current = quotationId;
      setHotelId(singleHotelId);
    }
  }, [quotationId, singleHotelId, hotelId]);

  // Regenerate the draft whenever the selected stay (or its resolved master
  // email) changes. The composer keeps any field the user edited meanwhile.
  const draftKey = useMemo(
    () =>
      selectedHotel
        ? JSON.stringify({
            hotel: selectedHotel,
            email: masterEmail,
            guest: quotation
              ? [quotation.customerName, quotation.customerPhone, quotation.customerEmail]
              : null,
            travellers,
          })
        : null,
    [selectedHotel, masterEmail, quotation, travellers],
  );
  const lastApplied = useRef<{ quotationId: string | null; key: string | null }>({
    quotationId: null,
    key: null,
  });
  useEffect(() => {
    if (!selectedHotel || !quotation) return;
    // The quotation id participates so switching between quotations with
    // identical stay content still regenerates (after Clear reset the draft).
    if (lastApplied.current.quotationId === quotation.id && lastApplied.current.key === draftKey)
      return;
    lastApplied.current = { quotationId: quotation.id, key: draftKey };
    onGenerate({
      to: masterEmail ?? '',
      subject: buildHotelBookingSubject({
        customerName: quotation.customerName,
        hotelName: selectedHotel.hotelName,
        checkInDate: selectedHotel.checkInDate,
        checkOutDate: selectedHotel.checkOutDate,
      }),
      bodyHtml: buildHotelBookingBody({
        quotation,
        hotel: selectedHotel,
        master: master.data ?? null,
        travellers,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, selectedHotel, quotation, masterEmail, travellers]);

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
        <span className="mb-1 block text-sm font-medium">Select Hotel *</span>
        {!quotation ? (
          <p className="text-xs text-muted-foreground">Select a quotation first.</p>
        ) : hotels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No hotel options were found on this quotation.
          </p>
        ) : (
          <select
            aria-label="Select Hotel"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            value={hotelId ?? ''}
            onChange={(event) => setHotelId(event.target.value || null)}
          >
            <option value="">Select a hotel…</option>
            {hotels.map((row, index) => (
              <option key={row.id} value={row.id}>
                {row.hotelName} — {hotelOptionSummary(row, index)}
              </option>
            ))}
          </select>
        )}
        {selectedHotel && !selectedHotel.hotelId && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            This stay is not linked to a hotel master. Link it from the quotation or enter the
            recipient manually before sending.
          </p>
        )}
        {selectedHotel?.hotelId && master.isFetching && (
          <p className="mt-1 text-xs text-muted-foreground">Resolving hotel email…</p>
        )}
        {selectedHotel?.hotelId && master.isError && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Could not verify the hotel master. Enter the recipient manually before sending.
          </p>
        )}
        {selectedHotel?.hotelId && master.isSuccess && !masterEmail && (
          <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            The linked hotel master has no email address. Enter the correct recipient manually
            before sending.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground md:col-span-2">
        Selecting a hotel fills the recipient, subject, and message below — review and edit them,
        then click Send Email. Nothing is sent automatically. See{' '}
        <Link
          className="font-medium text-brand-700 hover:underline"
          to={quotation ? `/quotations/${quotation.id}` : '/quotations'}
        >
          the quotation
        </Link>{' '}
        for full stay details.
      </p>
    </div>
  );
}
