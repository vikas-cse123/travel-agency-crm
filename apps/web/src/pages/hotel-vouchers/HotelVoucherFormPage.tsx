import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, Controller } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
    defaultValues: emptyDefaults,
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    control,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (!existing.data) return;
    const value = existing.data;
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
      guests: (value.guests ?? []).map((row) => ({
        guestName: row.guestName,
        age: row.age,
        sex: row.sex,
        paxType: row.paxType,
      })),
      packageIncludes: value.packageIncludes ?? [],
    });
  }, [existing.data, reset]);

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
        const bits = [row.city, row.roomType, row.checkInDate?.slice(0, 10)].filter(Boolean);
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
  }, [hotelDetails.data, selectedHotelId, setValue, getValues]);

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
    revertValues(lastQuotationKeys.current);
    // The hotel selection is already cleared by pickQuotation; revert its
    // stale prefilled values here too (the hotel effect would early-return
    // once the applied id is reset below).
    revertValues(lastHotelKeys.current);
    lastHotelKeys.current = [];
    appliedOptionId.current = null;
    // Details may still be loading (or stale from the previous quotation):
    // only apply once the loaded record matches the selection.
    if (!selectedQuotationId || !selectedQuotation || selectedQuotation.id !== selectedQuotationId) {
      appliedQuotationId.current = null;
      lastQuotationKeys.current = [];
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
    revertValues(lastHotelKeys.current);
    if (!selectedQuotationHotelId) {
      lastHotelKeys.current = [];
      appliedOptionId.current = null;
      return;
    }
    const option = quotationHotelOptions.find((row) => row.id === selectedQuotationHotelId);
    if (!option) {
      lastHotelKeys.current = [];
      appliedOptionId.current = selectedQuotationHotelId;
      return;
    }
    // Allow the master snapshot effect to refire for the new hotel link.
    lastHotelSnapshot.current = null;
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
      roomTypeName: option.roomType,
      mealPlanName: option.mealPlan,
      rooms: option.rooms ?? selectedQuotation?.rooms ?? 1,
    };
    if (option.checkInDate) values.checkIn = option.checkInDate.slice(0, 10);
    if (option.checkOutDate) values.checkOut = option.checkOutDate.slice(0, 10);
    lastHotelKeys.current = applyValues(values);
    appliedOptionId.current = selectedQuotationHotelId;
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
    if (lead.phone) setValue('guestPhone', lead.phone, { shouldDirty: true });
    if (lead.email) setValue('guestEmail', lead.email, { shouldDirty: true });
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
  const pricingRows = useFieldArray({ control, name: 'pricing' });
  const guestRows = useFieldArray({ control, name: 'guests' });
  const packageRows = useFieldArray({ control, name: 'packageIncludes' });

  // Display-only total: sum of the per-row GST + Service values actually entered.
  const watchedPricing = watch('pricing') ?? [];
  const totalPayable = watchedPricing.reduce((sum, row) => {
    const raw = row.gstService;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

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
    const payload = {
      ...values,
      pricing: values.pricing?.map(cleanRow),
      guests: values.guests?.map(cleanRow),
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
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Hotel Voucher' : 'New Hotel Voucher'}
        description="Service-confirmation document. Saved snapshots update when edited."
      />
      <form onSubmit={handleSubmit(submit)} className="space-y-5">
        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </p>
        )}

        {canUseQuotations && (
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="mb-1 text-base font-semibold">From Quotation (optional)</h2>
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

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Hotel Details</h2>          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Hotel *</span>
              <MasterSelect
                ariaLabel="Hotel"
                placeholder="Select a hotel to populate the snapshot"
                options={hotelOptions}
                value={selectedHotelId}
                onSelect={(option) => pickHotel(option?.id ?? null)}
                loading={hotels.isLoading}
              />
            </div>
            <FormField label="Hotel Name *" error={errors.hotelName?.message}>
              <input aria-label="Hotel Name" className={inputClass} {...register('hotelName')} />
            </FormField>
            <FormField label="City" error={errors.hotelCity?.message}>
              <input aria-label="Hotel City" className={inputClass} {...register('hotelCity')} />
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Address" error={errors.hotelAddress?.message}>
                <input
                  aria-label="Hotel Address"
                  className={inputClass}
                  {...register('hotelAddress')}
                />
              </FormField>
            </div>
            <FormField label="Phone" error={errors.hotelPhone?.message}>
              <input aria-label="Hotel Phone" className={inputClass} {...register('hotelPhone')} />
            </FormField>
            <FormField label="Email" error={errors.hotelEmail?.message}>
              <input aria-label="Hotel Email" className={inputClass} {...register('hotelEmail')} />
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
                placeholder="Optional external booking reference"
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

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Guest Details</h2>
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

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Stay Details</h2>
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
            <p className="text-sm text-muted-foreground md:col-span-2" aria-live="polite">
              Nights: {nights ?? '—'}
            </p>
            <FormField label="Room Type" error={errors.roomTypeName?.message}>
              <input aria-label="Room Type" className={inputClass} {...register('roomTypeName')} />
            </FormField>
            <FormField label="Meal Plan" error={errors.mealPlanName?.message}>
              <input aria-label="Meal Plan" className={inputClass} {...register('mealPlanName')} />
            </FormField>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold">Pricing (Optional)</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Manually entered per-room pricing. Leave empty when not needed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="min-w-40 px-2 py-2 font-medium">Room Type</th>
                  <th className="w-20 px-2 py-2 font-medium">Unit</th>
                  <th className="w-24 px-2 py-2 font-medium">Quantity</th>
                  <th className="w-20 px-2 py-2 font-medium">GST %</th>
                  <th className="w-28 px-2 py-2 font-medium">Amount</th>
                  <th className="w-28 px-2 py-2 font-medium">Taxable Pay</th>
                  <th className="w-28 px-2 py-2 font-medium">GST + Service</th>
                  <th className="w-32 px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pricingRows.fields.map((field, index) => (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} room type`}
                        className={inputClass}
                        {...register(`pricing.${index}.roomType`)}
                      />
                      {errors.pricing?.[index]?.roomType?.message && (
                        <p className="mt-1 text-xs text-red-600">
                          {errors.pricing?.[index]?.roomType?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} unit`}
                        type="number"
                        min={0}
                        className={inputClass}
                        {...register(`pricing.${index}.unit`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} quantity`}
                        type="number"
                        min={0}
                        className={inputClass}
                        {...register(`pricing.${index}.quantity`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} GST percent`}
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        className={inputClass}
                        {...register(`pricing.${index}.gst`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} amount`}
                        type="number"
                        min={0}
                        step="any"
                        className={inputClass}
                        {...register(`pricing.${index}.amount`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} taxable pay`}
                        type="number"
                        min={0}
                        step="any"
                        className={inputClass}
                        {...register(`pricing.${index}.taxablePay`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Pricing row ${index + 1} GST plus service`}
                        type="number"
                        min={0}
                        step="any"
                        className={inputClass}
                        {...register(`pricing.${index}.gstService`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move pricing row ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => pricingRows.move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move pricing row ${index + 1} down`}
                          disabled={index === pricingRows.fields.length - 1}
                          onClick={() => pricingRows.move(index, index + 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove pricing row ${index + 1}`}
                          onClick={() => pricingRows.remove(index)}
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
          {pricingRows.fields.length > 0 && (
            <p className="mt-3 text-sm font-medium" aria-live="polite">
              Total Payable Amount: {totalPayable.toLocaleString('en-IN')}
            </p>
          )}
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                pricingRows.append({
                  roomType: '',
                  unit: 1,
                  quantity: 1,
                  gst: null,
                  amount: null,
                  taxablePay: null,
                  gstService: null,
                })
              }
            >
              Add Pricing Row
            </Button>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold">Guest Information (Optional)</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Detailed guest list in addition to the guest summary above. Leave empty when not needed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="w-10 px-2 py-2 font-medium">#</th>
                  <th className="min-w-44 px-2 py-2 font-medium">Guest Name</th>
                  <th className="w-20 px-2 py-2 font-medium">Age</th>
                  <th className="w-20 px-2 py-2 font-medium">Sex</th>
                  <th className="w-28 px-2 py-2 font-medium">No of Pax</th>
                  <th className="w-32 px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guestRows.fields.map((field, index) => (
                  <tr key={field.id} className="border-t border-border align-top">
                    <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
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
                    <td className="px-2 py-2">
                      <input
                        aria-label={`Guest ${index + 1} age`}
                        type="number"
                        min={0}
                        max={120}
                        className={inputClass}
                        {...register(`guests.${index}.age`)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Guest ${index + 1} sex`}
                        className={inputClass}
                        {...register(`guests.${index}.sex`)}
                      >
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        aria-label={`Guest ${index + 1} pax type`}
                        className={inputClass}
                        {...register(`guests.${index}.paxType`)}
                      >
                        <option value="ADULT">Adult</option>
                        <option value="CHILD">Child</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move guest ${index + 1} up`}
                          disabled={index === 0}
                          onClick={() => guestRows.move(index, index - 1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Move guest ${index + 1} down`}
                          disabled={index === guestRows.fields.length - 1}
                          onClick={() => guestRows.move(index, index + 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove guest ${index + 1}`}
                          onClick={() => guestRows.remove(index)}
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
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                guestRows.append({ guestName: '', age: null, sex: 'M', paxType: 'ADULT' })
              }
            >
              Add Guest
            </Button>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-1 text-base font-semibold">Package Includes (Optional)</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Items included in the package, shown paired in the voucher PDF. Leave empty when not
            needed.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
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
          <div className="mt-3">
            <Button type="button" variant="secondary" onClick={() => packageRows.append('')}>
              Add Item
            </Button>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Terms & Conditions</h2>
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
        </section>

        <div className="flex justify-end gap-2">
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
