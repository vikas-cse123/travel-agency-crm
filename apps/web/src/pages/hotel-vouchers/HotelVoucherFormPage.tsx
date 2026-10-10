import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  BedDouble,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  PackagePlus,
  ScrollText,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import {
  hotelVoucherInputSchema,
  hotelVoucherUpdateSchema,
  PERMISSIONS,
  type HotelVoucherInput,
  type HotelVoucherUpdateInput,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/api/client';
import { FormField } from '@/components/ui/FormField';
import { MasterSelect } from '@/components/ui/MasterSelect';
import { PageHeader } from '@/components/ui/PageHeader';
// Full-toolbar editor shared with Masters → Hotels (Description/Amenities).
import { RichTextEditor } from '@/pages/masters/MasterUi';
import { useAuth } from '@/features/auth/AuthProvider';
import { useHotel, useHotels } from '@/features/masters/masters.api';
import { useLeads } from '@/features/queries/queries.api';
import {
  useQuotation,
  useQuotations,
  type Quotation,
  type TemplateHotel,
} from '@/features/quotations/quotations.api';
import {
  useCreateHotelVoucher,
  useHotelVoucher,
  useUpdateHotelVoucher,
} from '@/features/hotel-vouchers/hotel-vouchers.api';

const inputClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground';

/** Subtle tint marking snapshot fields (auto-filled, still editable). */
const snapshotClass = `${inputClass} bg-indigo-50/40`;

/** Icon + title row shared by every form section (presentation only). */
function SectionHeading({
  icon: Icon,
  title,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  badge?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {badge && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {badge}
        </span>
      )}
    </div>
  );
}

const FORM_STEPS = [
  { id: 'voucher-quotation', label: 'Quotation' },
  { id: 'voucher-hotel', label: 'Hotel' },
  { id: 'voucher-guest', label: 'Guest' },
  { id: 'voucher-stay', label: 'Stay' },
  { id: 'voucher-rooms', label: 'Rooms' },
  { id: 'voucher-meals', label: 'Meals' },
  { id: 'voucher-guests', label: 'Guests' },
  { id: 'voucher-includes', label: 'Includes' },
  { id: 'voucher-terms', label: 'Terms' },
] as const;

const ACTIVE_HOTELS = new URLSearchParams('status=ACTIVE&pageSize=100');
const LEAD_LOOKUPS = new URLSearchParams('pageSize=100');

type FormValues = HotelVoucherInput;

const emptyDefaults: FormValues = {  customerId: null,
  queryId: null,
  hotelId: null,
  quotationId: null,
  quotationHotelOptionId: null,
  guestName: '',
  guestPhone: null,
  guestEmail: null,
  adults: 1,
  children: 0,
  hotelName: '',
  hotelAddress: null,
  hotelCity: null,
  hotelPhone: null,
  hotelEmail: null,
  hotelStarRating: null,
  checkIn: '',
  checkOut: '',
  roomTypeName: null,
  rooms: 1,
  mealPlanName: null,
  confirmationNumber: null,
  confirmationNumberLabel: null,
  bookingId: null,
  bookingIdLabel: null,
  specialRequests: null,
  remarks: null,
  termsSnapshot: null,
  pricing: [],
  guests: [],
  packageIncludes: [],
  stayRooms: [],
  stayMeals: [],
};

function starLabel(starCategory: number | null, starRating: number | null): string | null {
  if (starCategory) return `${starCategory} Star`;
  if (starRating != null) return `${starRating} Star`;
  return null;
}

/** Visible text of an editor value: tags and entities stripped, whitespace collapsed. */
function htmlTextContent(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An editor row is blank when it holds no visible text (covers `<p><br></p>`). */
function isBlankHtml(value: string | null | undefined): boolean {
  return !value || htmlTextContent(value).length === 0;
}

export function HotelVoucherFormPage() {
  const { voucherId } = useParams();
  const navigate = useNavigate();
  const existing = useHotelVoucher(voucherId);
  const create = useCreateHotelVoucher();
  const update = useUpdateHotelVoucher(voucherId ?? '');
  const [formError, setFormError] = useState('');

  const isEdit = Boolean(voucherId);
  const schema = isEdit ? hotelVoucherUpdateSchema : hotelVoucherInputSchema;
  const form = useForm<FormValues>({
    resolver: (async (values: FormValues, context: unknown, options: unknown) => {
      // Blank guest placeholders must never fail validation: they are
      // filtered before the schema runs (and again before submit). The same
      // applies to blank stay rows (room without a type, meal without a
      // plan): only filled entries are validated and saved.
      const stripped: FormValues = {
        ...values,
        guests: values.guests?.filter(
          (row) => typeof row.guestName === 'string' && row.guestName.trim().length > 0,
        ),
        stayRooms: values.stayRooms?.filter(
          (row) => typeof row.roomType === 'string' && row.roomType.trim().length > 0,
        ),
        stayMeals: values.stayMeals?.filter(
          (row) => typeof row.mealPlan === 'string' && row.mealPlan.trim().length > 0,
        ),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (zodResolver(schema as any) as any)(stripped, context, options);
    }) as never,
    defaultValues: emptyDefaults,
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    trigger,
    watch,
    getValues,
    control,
    formState: { errors },
  } = form;

  // Edit hydration runs once per voucher below (after the field arrays), so
  // the guest field rows are explicitly synced and background refetches never
  // wipe in-progress edits.

  // --- Lookup data ---------------------------------------------------------
  const hotels = useHotels(ACTIVE_HOTELS);
  const leads = useLeads(LEAD_LOOKUPS);
  const selectedHotelId = watch('hotelId') ?? null;
  const hotelDetails = useHotel(selectedHotelId ?? undefined);
  const lastHotelSnapshot = useRef<string | null>(null);

  const hotelOptions = useMemo(
    () =>
      (hotels.data?.data ?? []).map((hotel) => ({
        id: hotel.id,
        label: hotel.name,
        hint: hotel.city?.name,
      })),
    [hotels.data],
  );
  const leadOptions = useMemo(
    () =>
      (leads.data?.data ?? []).map((lead) => ({
        id: lead.id,
        label: lead.customerName,
        hint: lead.phone,
      })),
    [leads.data],
  );

  // --- From Quotation (create mode only) -------------------------------------
  // A quotation supplies lead/guest facts plus its version's hotel options.
  // Prefill is revert-if-untouched with own bookkeeping: a field is only
  // overwritten/cleared while its current value still equals the last value
  // this flow wrote. (RHF dirtyFields cannot be used: any shouldDirty write
  // recomputes dirtiness globally from defaults, which would swallow manual
  // edits made between two quotation selections.)
  const { hasPermission } = useAuth();
  const canUseQuotations = !isEdit && hasPermission(PERMISSIONS.QUOTATIONS_VIEW);
  const [quotationSearch, setQuotationSearch] = useState('');
  const [debouncedQuotationSearch, setDebouncedQuotationSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuotationSearch(quotationSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [quotationSearch]);
  const quotationParams = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '20' });
    if (debouncedQuotationSearch) params.set('search', debouncedQuotationSearch);
    return params;
  }, [debouncedQuotationSearch]);
  const quotationList = useQuotations(quotationParams);
  const selectedQuotationId = watch('quotationId') ?? null;
  const selectedQuotationHotelId = watch('quotationHotelOptionId') ?? null;
  const quotationDetails = useQuotation(
    canUseQuotations ? (selectedQuotationId ?? undefined) : undefined,
  );
  const selectedQuotation: Quotation | undefined = quotationDetails.data;

  const quotationOptions = useMemo(
    () =>
      (quotationList.data?.data ?? []).map((row) => ({
        id: row.id,
        label: row.quotationNumber,
        hint: `${row.customerName} · ${row.destinationSummary}`,
      })),
    [quotationList.data],
  );

  /** Applicable version mirrors the server rule: current, else latest. */
  const applicableVersion = useMemo(() => {
    const versions = selectedQuotation?.versions ?? [];
    if (versions.length === 0) return null;
    return versions.find((row) => row.id === selectedQuotation?.currentVersionId) ?? versions[0]!;
  }, [selectedQuotation]);
  const quotationHotelOptions: TemplateHotel[] = useMemo(
    () => applicableVersion?.hotels ?? [],
    [applicableVersion],
  );
  const quotationHotelItems = useMemo(
    () =>
      quotationHotelOptions.map((row) => {
        // Display-only DD-MM-YYYY; anything unparseable is omitted rather
        // than shown as ISO text or "Invalid Date".
        const stayDate = (value: string | null | undefined): string | null => {
          const day = (value ?? '').slice(0, 10);
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
          if (!match) return null;
          const [, year, month, date] = match as unknown as [string, string, string, string];
          const monthNumber = Number(month);
          const dateNumber = Number(date);
          if (monthNumber < 1 || monthNumber > 12 || dateNumber < 1 || dateNumber > 31) return null;
          return `${date}-${month}-${year}`;
        };
        const bits = [row.city, row.roomType, stayDate(row.checkInDate)].filter(Boolean);
        return { id: row.id, label: row.hotelName, hint: bits.join(' · ') || undefined };
      }),
    [quotationHotelOptions],
  );

  type PrefillKey = keyof FormValues;
  /** Last value this flow wrote per field; absent = never written. */
  const appliedValues = useRef<Partial<Record<PrefillKey, unknown>>>({});
  const sameValue = (a: unknown, b: unknown) =>
    a === b || ((a === null || a === undefined) && (b === null || b === undefined));

  /** Write values, skipping fields the user changed since we wrote them. */
  const applyValues = (values: Partial<FormValues>): PrefillKey[] => {
    const keys = Object.keys(values) as PrefillKey[];
    const live = getValues();
    for (const key of keys) {
      const baseline = appliedValues.current[key];
      if (baseline !== undefined && !sameValue(live[key], baseline)) continue;
      const next = values[key] as never;
      setValue(key, next, { shouldDirty: false });
      appliedValues.current[key] = values[key];
    }
    return keys;
  };
  /**
   * Re-run validation for freshly autofilled fields against the final form
   * state, so stale errors clear (or honest ones appear) without resubmitting.
   */
  const revalidate = useCallback(
    (keys: PrefillKey[]) => {
      if (keys.length > 0) void trigger(keys);
    },
    [trigger],
  );

  /**
   * Revert our values back to form defaults, skipping user-edited fields.
   * A skipped field keeps its baseline so later prefills keep preserving it.
   */
  const revertValues = (keys: PrefillKey[]) => {
    const live = getValues();
    for (const key of keys) {
      const baseline = appliedValues.current[key];
      if (baseline === undefined) continue;
      if (!sameValue(live[key], baseline)) continue;
      setValue(key, (emptyDefaults[key] ?? null) as never, { shouldDirty: false });
      delete appliedValues.current[key];
    }
  };

  // Populate hotel snapshots when a master is chosen (once per selection —
  // later refetches must not overwrite manual edits). A response without a
  // hotel name is never a usable master record, so it is ignored instead of
  // blanking the snapshot fields. Master-written values are recorded in the
  // quotation-prefill baselines so switching quotations/hotels can revert
  // them when untouched, exactly like quotation-written values. A field the
  // user edited while the master response was in flight is skipped.
  useEffect(() => {
    const details = hotelDetails.data;
    if (!selectedHotelId || !details || lastHotelSnapshot.current === selectedHotelId) return;
    if (typeof details.name !== 'string' || !details.name) return;
    lastHotelSnapshot.current = selectedHotelId;
    const live = getValues();
    const snapshot: Array<[PrefillKey, unknown]> = [
      ['hotelName', details.name],
      ['hotelAddress', details.address ?? null],
      ['hotelCity', details.city?.name ?? null],
      ['hotelPhone', details.phone ?? null],
      ['hotelEmail', details.email ?? null],
      [
        'hotelStarRating',
        starLabel(details.starCategory ?? null, details.starRating ?? null),
      ],
    ];
    for (const [key, value] of snapshot) {
      const baseline = appliedValues.current[key];
      if (baseline !== undefined && !sameValue(live[key], baseline)) continue;
      setValue(key, value as never, { shouldDirty: true });
      appliedValues.current[key] = value;
    }
    revalidate(snapshot.map(([key]) => key));
  }, [hotelDetails.data, selectedHotelId, setValue, getValues, revalidate]);

  // Quotation selection drives lead/guest prefill; hotel options come from
  // the applicable version. Changing/clearing the quotation reverts only
  // untouched prefilled values — manual edits always survive.
  const pickQuotation = (id: string | null) => {
    setValue('quotationId', id, { shouldDirty: true });
    // Stale hotel selection never survives a quotation change.
    setValue('quotationHotelOptionId', null, { shouldDirty: true });
  };

  const lastQuotationKeys = useRef<PrefillKey[]>([]);
  const lastHotelKeys = useRef<PrefillKey[]>([]);
  const appliedQuotationId = useRef<string | null>(null);
  const appliedOptionId = useRef<string | null>(null);

  // Hotel-option selection drives hotel/stay prefill from that entry only —
  // never from an unrelated hotel in the same quotation. Master contact
  // fields arrive through the existing hotel-snapshot effect when the entry
  // links a master; entries without a master leave them blank (never faked).
  const pickQuotationHotel = (id: string | null) => {
    setValue('quotationHotelOptionId', id, { shouldDirty: true });
  };

  useEffect(() => {
    if (!canUseQuotations) return;
    if (selectedQuotationId === appliedQuotationId.current) return;
    const staleQuotationKeys = lastQuotationKeys.current;
    const staleHotelKeys = lastHotelKeys.current;
    revertValues(staleQuotationKeys);
    // The hotel selection is already cleared by pickQuotation; revert its
    // stale prefilled values here too (the hotel effect would early-return
    // once the applied id is reset below).
    revertValues(staleHotelKeys);
    revertStayArrays();
    lastHotelKeys.current = [];
    appliedOptionId.current = null;
    // Details may still be loading (or stale from the previous quotation):
    // only apply once the loaded record matches the selection.
    if (!selectedQuotationId || !selectedQuotation || selectedQuotation.id !== selectedQuotationId) {
      appliedQuotationId.current = null;
      lastQuotationKeys.current = [];
      revalidate([...staleQuotationKeys, ...staleHotelKeys]);
      return;
    }
    const quotation = selectedQuotation;
    lastQuotationKeys.current = applyValues({
      queryId: quotation.queryId,
      customerId: quotation.customer?.id ?? null,
      guestName: quotation.customerName,
      guestPhone: quotation.customerPhone,
      guestEmail: quotation.customerEmail,
      adults: quotation.adults,
      children: quotation.childrenWithBed + quotation.childrenWithoutBed,
      rooms: quotation.rooms,
    });
    appliedQuotationId.current = selectedQuotationId;
    revalidate(lastQuotationKeys.current);
    // Exactly one hotel option: auto-select it through the same manual-pick
    // path so every hotel/stay field prefills without dropdown interaction.
    // Multi-hotel quotations keep manual selection; an explicit user clear
    // (selection already set) is never overridden.
    if (selectedQuotationHotelId == null && quotationHotelOptions.length === 1) {
      const only = quotationHotelOptions[0];
      if (only) pickQuotationHotel(only.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canUseQuotations,
    selectedQuotationId,
    selectedQuotation,
    selectedQuotationHotelId,
    quotationHotelOptions,
    setValue,
  ]);

  useEffect(() => {
    if (!canUseQuotations) return;
    if (selectedQuotationHotelId === appliedOptionId.current) return;
    const staleHotelKeys = lastHotelKeys.current;
    revertValues(staleHotelKeys);
    revertStayArrays();
    if (!selectedQuotationHotelId) {
      lastHotelKeys.current = [];
      appliedOptionId.current = null;
      revalidate(staleHotelKeys);
      return;
    }
    const option = quotationHotelOptions.find((row) => row.id === selectedQuotationHotelId);
    if (!option) {
      lastHotelKeys.current = [];
      appliedOptionId.current = selectedQuotationHotelId;
      revalidate(staleHotelKeys);
      return;
    }
    // Allow the master snapshot effect to refire for the new hotel link.
    lastHotelSnapshot.current = null;
    // Every room configuration and meal plan of this exact option. Lines
    // come first; a legacy option without lines contributes one row from
    // its scalar mirror so nothing saved is ever dropped silently.
    const optionRoomLines = Array.isArray(option.roomLines) ? option.roomLines : [];
    const optionMealLines = Array.isArray(option.mealPlanLines) ? option.mealPlanLines : [];
    const roomLineOf = (line: unknown): Record<string, unknown> =>
      line && typeof line === 'object' ? (line as Record<string, unknown>) : {};
    const textOf = (record: Record<string, unknown>, key: string): string | null => {
      const value = record[key];
      return typeof value === 'string' && value.trim() ? value : null;
    };
    const countOf = (record: Record<string, unknown>, key: string, fallback: number | null = null) => {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
      const parsed = Number(value);
      return Number.isFinite(parsed) && value !== null && value !== undefined && value !== ''
        ? Math.floor(parsed)
        : fallback;
    };
    const stayRooms: NonNullable<FormValues['stayRooms']> = (
      optionRoomLines.length > 0
        ? optionRoomLines.map((line) => {
            const record = roomLineOf(line);
            return {
              roomType: textOf(record, 'roomType') ?? option.roomType ?? '',
              rooms: countOf(record, 'rooms', 1) ?? 1,
              notes: textOf(record, 'notes'),
            };
          })
        : option.roomType
          ? [
              {
                roomType: option.roomType,
                rooms: option.rooms ?? 1,
                notes: null,
              },
            ]
          : []
    );
    const stayMeals: NonNullable<FormValues['stayMeals']> = (
      optionMealLines.length > 0
        ? optionMealLines.map((line) => ({
            mealPlan: textOf(roomLineOf(line), 'mealPlan') ?? option.mealPlan ?? '',
          }))
        : option.mealPlan
          ? [{ mealPlan: option.mealPlan }]
          : []
    );
    const firstRoom = stayRooms[0];
    const firstMeal = stayMeals[0];
    const values: Partial<FormValues> = {
      hotelId: option.hotelId ?? null,
      hotelName: option.hotelName,
      hotelCity: option.city,
      // Contact fields reset here so a previous master-linked hotel never
      // leaks into this entry; the master snapshot effect refills + rebaselines
      // them when the entry links a master.
      hotelAddress: null,
      hotelPhone: null,
      hotelEmail: null,
      hotelStarRating: null,
      roomTypeName: firstRoom?.roomType?.trim() || option.roomType,
      mealPlanName: firstMeal?.mealPlan?.trim() || option.mealPlan,
      rooms: option.rooms ?? selectedQuotation?.rooms ?? 1,
    };
    if (option.checkInDate) values.checkIn = option.checkInDate.slice(0, 10);
    if (option.checkOutDate) values.checkOut = option.checkOutDate.slice(0, 10);
    lastHotelKeys.current = applyValues(values);
    applyStayArrays(stayRooms, stayMeals);
    appliedOptionId.current = selectedQuotationHotelId;
    revalidate([...lastHotelKeys.current, 'stayRooms', 'stayMeals']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canUseQuotations,
    selectedQuotationHotelId,
    quotationHotelOptions,
    selectedQuotation,
    setValue,
  ]);

  const pickLead = (id: string | null) => {
    setValue('queryId', id, { shouldDirty: true });
    if (!id) return;
    const lead = (leads.data?.data ?? []).find((row) => row.id === id);
    if (!lead) return;
    setValue('guestName', lead.customerName, { shouldDirty: true });
    const touched: PrefillKey[] = ['queryId', 'guestName'];
    if (lead.phone) {
      setValue('guestPhone', lead.phone, { shouldDirty: true });
      touched.push('guestPhone');
    }
    if (lead.email) {
      setValue('guestEmail', lead.email, { shouldDirty: true });
      touched.push('guestEmail');
    }
    revalidate(touched);
  };

  const pickHotel = (id: string | null) => {
    setValue('hotelId', id, { shouldDirty: true });
  };

  const checkIn = watch('checkIn') ?? '';
  const checkOut = watch('checkOut') ?? '';
  const nights =
    checkIn && checkOut && checkOut > checkIn
      ? Math.round(
          (new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) /
            86_400_000,
        )
      : null;

  // Hooks must all run above the early returns below: the redirect paths
  // render nothing, so any hook placed after them breaks hook order.
  const guestRows = useFieldArray({ control, name: 'guests' });
  // packageIncludes is a string array, which react-hook-form's field-array
  // types only model as object arrays. The cast keeps the runtime behavior
  // identical while describing exactly the surface this form uses.
  const packageRows = useFieldArray({ control, name: 'packageIncludes' } as never) as unknown as {
    readonly fields: ReadonlyArray<{ readonly id: string }>;
    append: (value: string) => void;
    move: (from: number, to: number) => void;
    remove: (index: number) => void;
  };
  const stayRoomRows = useFieldArray({ control, name: 'stayRooms' });
  const stayMealRows = useFieldArray({ control, name: 'stayMeals' });

  /**
   * Quotation-prefilled stay rows, tracked per array so switching options
   * reverts only untouched rows. Baselines are JSON snapshots: a row set the
   * user edited no longer matches, so manual entries always survive later
   * prefills — the same revert-if-untouched contract as scalar fields.
   */
  const appliedStayRooms = useRef<string | null>(null);
  const appliedStayMeals = useRef<string | null>(null);
  const snapshotStayRows = (rows: unknown): string => JSON.stringify(rows ?? []);
  const revertStayArrays = () => {
    const live = getValues();
    if (
      appliedStayRooms.current !== null &&
      snapshotStayRows(live.stayRooms) === appliedStayRooms.current
    ) {
      stayRoomRows.replace([]);
      appliedStayRooms.current = null;
    }
    if (
      appliedStayMeals.current !== null &&
      snapshotStayRows(live.stayMeals) === appliedStayMeals.current
    ) {
      stayMealRows.replace([]);
      appliedStayMeals.current = null;
    }
  };
  const applyStayArrays = (
    rooms: NonNullable<FormValues['stayRooms']>,
    meals: NonNullable<FormValues['stayMeals']>,
  ) => {
    if (appliedStayRooms.current === null) {
      stayRoomRows.replace(rooms);
      appliedStayRooms.current = snapshotStayRows(rooms);
    }
    if (appliedStayMeals.current === null) {
      stayMealRows.replace(meals);
      appliedStayMeals.current = snapshotStayRows(meals);
    }
  };

  // Edit hydration: restore the saved record once per voucher. The guest
  // field array is explicitly replaced (not just reset) because inputs
  // mounted from the pre-load blank row otherwise keep their stale blank
  // value instead of the hydrated name. Guarded by voucher id so background
  // refetches never wipe in-progress edits.
  const hydratedVoucherId = useRef<string | null>(null);
  useEffect(() => {
    if (!existing.data || hydratedVoucherId.current === existing.data.id) return;
    hydratedVoucherId.current = existing.data.id;
    const value = existing.data;
    const savedGuests = (value.guests ?? []).map((row) => ({
      guestName: row.guestName,
      age: row.age,
      sex: row.sex,
      paxType: row.paxType,
    }));
    const savedStayRooms = (value.stayRooms ?? []).map((row) => ({
      roomType: row.roomType,
      rooms: row.rooms,
      notes: row.notes ?? null,
    }));
    const savedStayMeals = (value.stayMeals ?? []).map((row) => ({
      mealPlan: row.mealPlan,
    }));
    reset({
      customerId: value.customerId,
      queryId: value.queryId,
      hotelId: value.hotelId,
      guestName: value.guestName,
      guestPhone: value.guestPhone,
      guestEmail: value.guestEmail,
      adults: value.adults,
      children: value.children,
      hotelName: value.hotelName,
      hotelAddress: value.hotelAddress,
      hotelCity: value.hotelCity,
      hotelPhone: value.hotelPhone,
      hotelEmail: value.hotelEmail,
      hotelStarRating: value.hotelStarRating,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      roomTypeName: value.roomTypeName,
      rooms: value.rooms,
      mealPlanName: value.mealPlanName,
      confirmationNumber: value.confirmationNumber,
      confirmationNumberLabel: value.confirmationNumberLabel ?? null,
      bookingId: value.bookingId ?? null,
      bookingIdLabel: value.bookingIdLabel ?? null,
      specialRequests: value.specialRequests,
      remarks: value.remarks,
      termsSnapshot: value.termsSnapshot,
      pricing: (value.pricing ?? []).map((row) => ({
        roomType: row.roomType,
        unit: row.unit,
        quantity: row.quantity,
        gst: row.gst,
        amount: row.amount,
        taxablePay: row.taxablePay,
        gstService: row.gstService,
      })),
      guests: savedGuests,
      packageIncludes: value.packageIncludes ?? [],
      stayRooms: savedStayRooms,
      stayMeals: savedStayMeals,
    });
    guestRows.replace(savedGuests);
    stayRoomRows.replace(savedStayRooms);
    stayMealRows.replace(savedStayMeals);
    // Seed the master-snapshot guard with the hydrated link so opening an
    // existing voucher never rewrites its saved hotel contact fields from the
    // master. Only a user-driven hotel change repopulates snapshots.
    lastHotelSnapshot.current = value.hotelId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, reset]);

  // Guest Information rows are owned by the Adults/Children counts: the
  // table always holds exactly (adults + children) entries, adults first.
  // Growing a count appends blank entries of that category; shrinking drops
  // entries from the end of that category. Kept entries (and every unrelated
  // field) are never touched, so typed details and quotation prefills survive
  // count changes, async prefills, and edit-form hydration alike.
  //
  // The wanted counts are read fresh from the form (not from render-scope
  // `watch` values): edit hydration `reset()`s synchronously earlier in the
  // same commit, so on cached-data navigation the render-scope counts still
  // hold pre-hydration defaults while `guests` already contains the restored
  // rows. Syncing to stale counts replaced every restored name but the first
  // with blanks — the refresh fixed it only because uncached loads hydrate a
  // commit later. The watched counts below stay as effect dependencies so
  // user edits to Adults/Children still re-run the sync.
  const adultCount = watch('adults') ?? 0;
  const childCount = watch('children') ?? 0;
  useEffect(() => {
    const sanitize = (value: unknown): number => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
      return Math.min(50, Math.max(0, Math.floor(value)));
    };
    const live = getValues();
    const wantAdults = sanitize(live.adults);
    const wantChildren = sanitize(live.children);
    const rows = live.guests ?? [];
    const haveAdults = rows.filter((row) => row.paxType === 'ADULT');
    const haveChildren = rows.filter((row) => row.paxType !== 'ADULT');
    if (haveAdults.length === wantAdults && haveChildren.length === wantChildren) return;
    const blank = (paxType: 'ADULT' | 'CHILD') => ({
      guestName: '',
      age: null,
      sex: 'M' as const,
      paxType,
    });
    const next = [
      ...haveAdults.slice(0, wantAdults),
      ...Array.from({ length: Math.max(0, wantAdults - haveAdults.length) }, () => blank('ADULT')),
      ...haveChildren.slice(0, wantChildren),
      ...Array.from({ length: Math.max(0, wantChildren - haveChildren.length) }, () =>
        blank('CHILD'),
      ),
    ];
    guestRows.replace(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adultCount, childCount]);

  if (voucherId && existing.isError) return <Navigate to="/hotel-vouchers" replace />;
  // Every voucher is editable regardless of status; the backend authorizes
  // the save and records an audit entry.

  const mutation = isEdit ? update : create;

  /** Blank text inputs submit as undefined so optional numerics stay null, not 0. */
  const cleanRow = <T extends Record<string, unknown>>(row: T): T => {    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) cleaned[key] = value === '' ? undefined : value;
    return cleaned as T;
  };

  const submit = async (values: FormValues) => {
    setFormError('');
    // Pricing left the voucher workflow: it is never shown or entered here.
    // Strip it from the payload so a saved voucher's stored rows are retained
    // server-side (the update path only touches supplied fields) instead of
    // being wiped by an empty invisible list.
    const { pricing: _retainedPricing, ...rest } = values;
    void _retainedPricing;
    // Stay rows: only filled entries persist (blank placeholders are
    // dropped like guest blanks). The legacy scalars mirror the first row
    // so older readers keep working; the `rooms` total stays exactly as
    // stated — it is never recomputed from the rows.
    const stayRooms = (values.stayRooms ?? [])
      .map(cleanRow)
      .filter((row) => typeof row.roomType === 'string' && row.roomType.trim().length > 0);
    const stayMeals = (values.stayMeals ?? [])
      .map(cleanRow)
      .filter((row) => typeof row.mealPlan === 'string' && row.mealPlan.trim().length > 0);
    const payload = {
      ...rest,
      roomTypeName:
        stayRooms[0]?.roomType?.trim() || values.roomTypeName?.trim() || null,
      mealPlanName:
        stayMeals[0]?.mealPlan?.trim() || values.mealPlanName?.trim() || null,
      stayRooms,
      stayMeals,
      // Guest rows always mirror the Adults/Children counts in the form;
      // only named travellers are saved, so blank placeholders never block
      // submit and never persist as fake guests.
      guests: values.guests
        ?.map(cleanRow)
        .filter((row) => typeof row.guestName === 'string' && row.guestName.trim().length > 0),
      // Blank editor rows carry markup without visible text — drop them so
      // no empty package rows or empty terms blobs can be saved.
      packageIncludes: values.packageIncludes?.filter((item) => !isBlankHtml(item)),
      termsSnapshot: isBlankHtml(values.termsSnapshot) ? null : values.termsSnapshot,
    };
    try {
      const saved = isEdit
        ? await update.mutateAsync(payload as HotelVoucherUpdateInput)
        : await create.mutateAsync(payload);
      navigate(`/hotel-vouchers/${saved.id}`);
    } catch (error) {
      // Prefer the server's field-level message when present (curated and
      // safe — the client already masks internal failures); fall back to the
      // generic message otherwise. Request ids stay in server logs only.
      if (error instanceof ApiError && error.fields) {
        const [field, messages] = Object.entries(error.fields)[0] ?? [];
        setFormError(
          field && messages?.[0] ? `${field}: ${messages[0]}` : error.message,
        );
      } else if (error instanceof Error) {
        setFormError(error.message);
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-28">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link to="/" className="hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to="/hotel-vouchers" className="hover:underline">
              Hotel
            </Link>
          </li>
        </ol>
      </nav>
      <PageHeader
        title={isEdit ? 'Edit Hotel Voucher' : 'New Hotel Voucher'}
        description="Service-confirmation document. Saved snapshots update when edited."
      />
      <nav
        aria-label="Form sections"
        className="rounded-xl border bg-card px-4 py-3 shadow-sm"
      >
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
          {FORM_STEPS.filter((step) => step.id !== 'voucher-quotation' || canUseQuotations).map(
            (step, index) => (
              <li key={step.id} className="flex items-center gap-1">
                {index > 0 && (
                  <span aria-hidden="true" className="text-slate-300">
                    ›
                  </span>
                )}
                <a
                  href={`#${step.id}`}
                  className="rounded-full px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {index + 1}. {step.label}
                </a>
              </li>
            ),
          )}
        </ol>
      </nav>
      <form onSubmit={handleSubmit(submit)} className="space-y-5">
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </p>
        )}

        {canUseQuotations && (
          <section
            id="voucher-quotation"
            className="scroll-mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-5 shadow-sm"
          >
            <SectionHeading icon={FileText} title="From Quotation (optional)" />
            <p className="mb-4 text-sm text-muted-foreground">
              Select a quotation to prefill lead, guest, hotel, and stay details. Every field
              stays editable.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <span className="mb-1 block text-sm font-medium">Quotation ID</span>
                <MasterSelect
                  ariaLabel="Quotation ID"
                  placeholder="Search by quotation number, customer, or destination"
                  options={quotationOptions}
                  value={selectedQuotationId}
                  onSelect={(option) => pickQuotation(option?.id ?? null)}
                  onText={setQuotationSearch}
                  loading={quotationList.isLoading}
                  fallbackLabel={selectedQuotation?.quotationNumber}
                />
              </div>
              <div>
                <span className="mb-1 block text-sm font-medium">Select Hotel</span>
                <MasterSelect
                  ariaLabel="Select Hotel"
                  placeholder={
                    !selectedQuotationId
                      ? 'Select a quotation first'
                      : quotationDetails.isLoading
                        ? 'Loading hotels…'
                        : quotationHotelItems.length === 0
                          ? 'No hotels in this quotation'
                          : 'Select a hotel from the quotation'
                  }
                  options={quotationHotelItems}
                  value={selectedQuotationHotelId}
                  onSelect={(option) => pickQuotationHotel(option?.id ?? null)}
                  loading={quotationDetails.isLoading}
                  disabled={!selectedQuotationId || quotationDetails.isLoading}
                  fallbackLabel={
                    quotationHotelOptions.find((row) => row.id === selectedQuotationHotelId)
                      ?.hotelName
                  }
                />
              </div>
            </div>
            {quotationDetails.isError && selectedQuotationId && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                Could not load the selected quotation. Check access or choose another one.
              </p>
            )}
            {selectedQuotationId &&
              !quotationDetails.isLoading &&
              !quotationDetails.isError &&
              quotationHotelItems.length === 0 && (
                <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                  This quotation has no hotel entries. Fill the hotel details manually below.
                </p>
              )}
          </section>
        )}

        <section id="voucher-hotel" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={Building2} title="Hotel Details" />
          <p className="mb-4 text-sm text-muted-foreground">
            Tinted fields are snapshots from the hotel master — editing them here never changes the
            master record.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Hotel *</span>
              <MasterSelect
                ariaLabel="Hotel"
                placeholder="Select a hotel to populate the snapshot"
                options={hotelOptions}
                value={selectedHotelId}
                onSelect={(option) => pickHotel(option?.id ?? null)}
                loading={hotels.isLoading}
                fallbackLabel={
                  selectedHotelId ? (existing.data?.hotelName ?? undefined) : undefined
                }
              />
            </div>
            <FormField label="Hotel Name *" error={errors.hotelName?.message}>
              <input aria-label="Hotel Name" className={snapshotClass} {...register('hotelName')} />
            </FormField>
            <FormField label="City" error={errors.hotelCity?.message}>
              <input aria-label="Hotel City" className={snapshotClass} {...register('hotelCity')} />
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Address" error={errors.hotelAddress?.message}>
                <input
                  aria-label="Hotel Address"
                  className={snapshotClass}
                  {...register('hotelAddress')}
                />
              </FormField>
            </div>
            <FormField label="Phone" error={errors.hotelPhone?.message}>
              <input aria-label="Hotel Phone" className={snapshotClass} {...register('hotelPhone')} />
            </FormField>
            <FormField label="Email" error={errors.hotelEmail?.message}>
              <input aria-label="Hotel Email" className={snapshotClass} {...register('hotelEmail')} />
            </FormField>
            <div>
              <input
                aria-label="Confirmation Number label"
                className="mb-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-border focus:border-border focus:outline-none"
                placeholder="Confirmation Number"
                {...register('confirmationNumberLabel')}
              />
              <input
                aria-label="Confirmation Number"
                className={inputClass}
                {...register('confirmationNumber')}
              />
              {errors.confirmationNumberLabel?.message && (
                <p className="mt-1 text-xs text-red-600">
                  {errors.confirmationNumberLabel.message}
                </p>
              )}
              {errors.confirmationNumber?.message && (
                <p className="mt-1 text-xs text-red-600">{errors.confirmationNumber.message}</p>
              )}
            </div>
            <div>
              <input
                aria-label="Booking ID label"
                className="mb-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-border focus:border-border focus:outline-none"
                placeholder="Booking ID"
                {...register('bookingIdLabel')}
              />
              <input
                aria-label="Booking ID"
                className={inputClass}
                placeholder=""
                {...register('bookingId')}
              />
              {errors.bookingIdLabel?.message && (
                <p className="mt-1 text-xs text-red-600">{errors.bookingIdLabel.message}</p>
              )}
              {errors.bookingId?.message && (
                <p className="mt-1 text-xs text-red-600">{errors.bookingId.message}</p>
              )}
            </div>
          </div>
        </section>

        <section id="voucher-guest" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={Users} title="Guest Details" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Lead (optional)</span>
              <MasterSelect
                ariaLabel="Lead"
                placeholder="Select a lead to prefill guest details"
                options={leadOptions}
                value={watch('queryId') ?? null}
                onSelect={(option) => pickLead(option?.id ?? null)}
                loading={leads.isLoading}
                fallbackLabel={
                  watch('queryId') ? (existing.data?.query?.customerName ?? undefined) : undefined
                }
              />
            </div>
            <FormField label="Guest Name *" error={errors.guestName?.message}>
              <input aria-label="Guest Name" className={inputClass} {...register('guestName')} />
            </FormField>
            <FormField label="Phone" error={errors.guestPhone?.message}>
              <input aria-label="Guest Phone" className={inputClass} {...register('guestPhone')} />
            </FormField>
            <FormField label="Email" error={errors.guestEmail?.message}>
              <input aria-label="Guest Email" className={inputClass} {...register('guestEmail')} />
            </FormField>
            <FormField label="No. of Rooms" error={errors.rooms?.message}>
              <input
                aria-label="No. of Rooms"
                type="number"
                min={1}
                className={inputClass}
                {...register('rooms', { valueAsNumber: true })}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Adults" error={errors.adults?.message}>
                <input
                  aria-label="Adults"
                  type="number"
                  min={0}
                  className={inputClass}
                  {...register('adults', { valueAsNumber: true })}
                />
              </FormField>
              <FormField label="Children" error={errors.children?.message}>
                <input
                  aria-label="Children"
                  type="number"
                  min={0}
                  className={inputClass}
                  {...register('children', { valueAsNumber: true })}
                />
              </FormField>
            </div>
          </div>
        </section>

        <section id="voucher-stay" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={CalendarDays} title="Stay Details" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Check-in *" error={errors.checkIn?.message}>
              <input
                aria-label="Check-in"
                type="date"
                className={inputClass}
                {...register('checkIn')}
              />
            </FormField>
            <FormField label="Check-out *" error={errors.checkOut?.message}>
              <input
                aria-label="Check-out"
                type="date"
                className={inputClass}
                {...register('checkOut')}
              />
            </FormField>
            <p
              className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 md:col-span-2"
              aria-live="polite"
            >
              Nights: {nights ?? '—'}
            </p>
          </div>
        </section>

        <section
          id="voucher-rooms"
          className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm"
        >
          <SectionHeading icon={BedDouble} title="Rooms" />
          <p className="mb-4 text-sm text-muted-foreground">
            Every room configuration of the stay, each with its own quantity.
            Imported from the quotation hotel option when one is selected.
          </p>
          {stayRoomRows.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No room entries yet. Select a quotation hotel or add the first one below.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() =>
                  stayRoomRows.append({
                    roomType: '',
                    rooms: 1,
                    notes: null,
                  })
                }
              >
                Add Room
              </Button>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[560px] border-collapse bg-card text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-xs uppercase text-muted-foreground">
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="min-w-40 px-2 py-2 font-medium">Room Type</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Rooms</th>
                  <th className="min-w-40 px-2 py-2 font-medium">Remark</th>
                  <th className="w-16 px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stayRoomRows.fields.map((field, index) => (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Stay room ${index + 1} type`}
                        className={inputClass}
                        {...register(`stayRooms.${index}.roomType`)}
                      />
                      {errors.stayRooms?.[index]?.roomType?.message && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.stayRooms?.[index]?.roomType?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Stay room ${index + 1} rooms`}
                        type="number"
                        min={1}
                        className={inputClass}
                        {...register(`stayRooms.${index}.rooms`, { valueAsNumber: true })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Stay room ${index + 1} remark`}
                        className={inputClass}
                        placeholder="e.g. high floor"
                        {...register(`stayRooms.${index}.notes`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove stay room ${index + 1}`}
                        onClick={() => stayRoomRows.remove(index)}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {stayRoomRows.fields.length > 0 && (
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                stayRoomRows.append({
                  roomType: '',
                  rooms: 1,
                  notes: null,
                })
              }
            >
              Add Room
            </Button>
          </div>
          )}
        </section>

        <section
          id="voucher-meals"
          className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm"
        >
          <SectionHeading icon={UtensilsCrossed} title="Meal Plans" />
          <p className="mb-4 text-sm text-muted-foreground">
            Every meal plan of the stay, in the quotation&apos;s order where imported.
          </p>
          {stayMealRows.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No meal plans yet. Select a quotation hotel or add the first one below.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => stayMealRows.append({ mealPlan: '' })}
              >
                Add Meal Plan
              </Button>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[520px] border-collapse bg-card text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-xs uppercase text-muted-foreground">
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="min-w-48 px-2 py-2 font-medium">Meal Plan</th>
                  <th className="w-16 px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stayMealRows.fields.map((field, index) => (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Stay meal ${index + 1} plan`}
                        className={inputClass}
                        {...register(`stayMeals.${index}.mealPlan`)}
                      />
                      {errors.stayMeals?.[index]?.mealPlan?.message && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.stayMeals?.[index]?.mealPlan?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove stay meal ${index + 1}`}
                        onClick={() => stayMealRows.remove(index)}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {stayMealRows.fields.length > 0 && (
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={() => stayMealRows.append({ mealPlan: '' })}>
              Add Meal Plan
            </Button>
          </div>
          )}
        </section>

        <section id="voucher-guests" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={ClipboardList} title="Guest Information (Optional)" badge="Optional" />
          <p className="mb-4 text-sm text-muted-foreground">
            One entry per traveller, following the Adults and Children counts above. Changing a
            count adds or removes entries; details you already typed are kept.
          </p>
          {guestRows.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No guest entries — set Adults or Children above to generate them.
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[480px] border-collapse bg-card text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="w-28 px-2 py-2 font-medium">Category</th>
                  <th className="min-w-64 px-2 py-2 font-medium">Guest Name</th>
                  <th className="w-28 px-2 py-2 font-medium">No of Pax</th>
                </tr>
              </thead>
              <tbody>
                {guestRows.fields.map((field, index) => {
                  const pax = field.paxType === 'CHILD' ? 'CHILD' : 'ADULT';
                  const categoryNumber =
                    guestRows.fields.slice(0, index).filter((row) => row.paxType === field.paxType)
                      .length + 1;
                  return (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2 font-medium">
                      {pax === 'ADULT' ? `Adult ${categoryNumber}` : `Child ${categoryNumber}`}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Guest ${index + 1} name`}
                        className={inputClass}
                        {...register(`guests.${index}.guestName`)}
                      />
                      {errors.guests?.[index]?.guestName?.message && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.guests?.[index]?.guestName?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {pax === 'ADULT' ? 'Adult' : 'Child'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </section>

        <section id="voucher-includes" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={PackagePlus} title="Package Includes (Optional)" badge="Optional" />
          <p className="mb-4 text-sm text-muted-foreground">
            Items included in the package, shown paired in the voucher PDF. Leave empty when not
            needed.
          </p>
          {packageRows.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No inclusions yet. Add the first one below.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => packageRows.append('')}
              >
                Add Item
              </Button>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[520px] border-collapse bg-card text-sm">
              <thead>
                <tr className="bg-slate-100 text-left text-xs uppercase text-muted-foreground">
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="min-w-48 px-2 py-2 font-medium">Item</th>
                  <th className="w-32 px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packageRows.fields.map((field, index) => (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2">
                      <Controller
                        control={control}
                        name={`packageIncludes.${index}`}
                        render={({ field }) => (
                          <RichTextEditor
                            label={`Package include ${index + 1} item`}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                          />
                        )}
                      />
                      {errors.packageIncludes?.[index]?.message && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.packageIncludes?.[index]?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move package item ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => packageRows.move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move package item ${index + 1} down`}
                          disabled={index === packageRows.fields.length - 1}
                          onClick={() => packageRows.move(index, index + 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove package item ${index + 1}`}
                          onClick={() => packageRows.remove(index)}
                        >
                          ✕
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {packageRows.fields.length > 0 && (
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={() => packageRows.append('')}>
              Add Item
            </Button>
          </div>
          )}
        </section>

        <section id="voucher-terms" className="scroll-mt-4 rounded-xl border bg-card p-5 shadow-sm">
          <SectionHeading icon={ScrollText} title="Terms & Conditions" />
          <div className="rounded-lg border border-slate-200 bg-white p-1.5">
          <Controller
            control={control}
            name="termsSnapshot"
            render={({ field }) => (
              <RichTextEditor
                label="Terms & Conditions"
                value={field.value ?? ''}
                onChange={field.onChange}
              />
            )}
          />
          {errors.termsSnapshot?.message && (
            <p className="mt-1 text-xs text-red-600">{errors.termsSnapshot.message}</p>
          )}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 border-t bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:flex-row sm:items-center sm:justify-end">
          <Link to={isEdit ? `/hotel-vouchers/${voucherId}` : '/hotel-vouchers'}>
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" isLoading={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create Voucher'}
          </Button>
        </div>
      </form>
    </div>
  );
}
