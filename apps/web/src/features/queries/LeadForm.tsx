import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, type UseFormRegister } from 'react-hook-form';
import {
  Car,
  ChevronDown,
  FileText,
  Hotel,
  PackagePlus,
  Plane,
  Ship,
  Telescope,
  Trash2,
  Train,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { type QueryInput } from '@interscale/shared';
import countries from 'world-countries';
import { Button } from '@/components/ui/Button';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import indianCityData from '@/data/indian-cities.json';
import { TRAVEL_MONTH_NAMES } from '@/features/quotations/travel-dates';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLeadLookups, type Lead, type UserOption } from './queries.api';
import { useCustomer } from '@/features/customers/customers.api';
import { useDestinations } from '@/features/masters/masters.api';
import { cn } from '@/utils/cn';

const ITINERARY_DESTINATIONS_PARAMS = new URLSearchParams('pageSize=100&status=ACTIVE');

interface ItineraryForm {
  country: string;
  destination: string;
  nights: number;
  sequence: number;
  arrivalDate: string;
  departureDate: string;
  notes: string;
}
interface FormValues {
  customerId: string;
  createNewCustomer: boolean;
  createAnyway: boolean;
  customerName: string;
  phone: string;
  alternatePhone: string;
  email: string;
  dateOfBirth: string;
  leadSource: string;
  leadType: string;
  leadStage: string;
  priority: string;
  departureCountry: string;
  departureCity: string;
  travelStartDate: string;
  travelMonth: string;
  travelYear: string;
  travelEndDate: string;
  flexibleDates: boolean;
  rooms: number;
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  infants: number;
  extraBeds: number;
  expectedAmount: string;
  budgetMin: string;
  budgetMax: string;
  expectedMargin: string;
  currency: string;
  tripType: string;
  quotationRequired: boolean;
  bookingStatusPlaceholder: string;
  webLinkPlaceholder: string;
  supplierCostingNotes: string;
  assignedToId: string;
  internalRemarks: string;
  services: string[];
  itinerary: ItineraryForm[];
  initialNote: string;
  followUpAt: string;
  childrenWithBedAges: Array<number | null>;
  childrenWithoutBedAges: Array<number | null>;
  infantAges: Array<number | null>;
  adultNames: string[];
  childWithBedNames: string[];
  childWithoutBedNames: string[];
  infantNames: string[];
}
const emptyRow = (sequence = 1): ItineraryForm => ({
  country: '',
  destination: '',
  nights: 1,
  sequence,
  arrivalDate: '',
  departureDate: '',
  notes: '',
});
const dateValue = (value?: string | null) => (value ? value.slice(0, 10) : '');

/**
 * Normalize a traveller-name list to exactly `count` entries: retained names
 * keep their positions, removed trailing rows are dropped, new rows start
 * blank. Values are trimmed to the shared max length.
 */
function namesFor(value: unknown, count: number): string[] {
  const size = Math.max(0, Math.min(200, Math.floor(Number(count) || 0)));
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: size }, (_, index) => {
    const entry = list[index];
    return typeof entry === 'string' ? entry.trim().slice(0, 120) : '';
  });
}

/** Month/year selects state loaded independently from the stored pair only.
 * An exact travelStartDate never populates these selects: Travel Date and
 * Travel Month are semantically separate pieces of information. The year
 * defaults to the current calendar year (computed dynamically, never
 * hardcoded); a saved travel year is always preserved and never overwritten. */
function travelMonthYearDefaults(lead?: Lead): { travelMonth: string; travelYear: string } {
  if (lead?.travelMonth && lead?.travelYear)
    return { travelMonth: String(lead.travelMonth), travelYear: String(lead.travelYear) };
  return {
    travelMonth: '',
    travelYear: lead?.travelYear != null ? String(lead.travelYear) : String(new Date().getFullYear()),
  };
}

type TravelTimingMode = 'exact' | 'month';
/** Initial Travel Timing mode from saved data: a complete month/year pair
 * selects Month mode, anything else (exact date, neither, or legacy records)
 * selects Exact Date mode. A record carrying both representations opens in
 * Month mode; saving then keeps only the month/year representation so no
 * conflicting values are ever submitted. */
function travelTimingModeFor(lead?: Lead): TravelTimingMode {
  return lead?.travelMonth != null && lead?.travelYear != null ? 'month' : 'exact';
}

/** Year options: a small past window plus a generous future planning horizon. */
function travelYearOptions(): string[] {
  const current = new Date().getFullYear();
  const years: string[] = [];
  for (let year = current - 2; year <= current + 10; year += 1) years.push(String(year));
  return years;
}
function defaults(lead?: Lead): FormValues {
  return {
    customerId: lead?.customer?.id ?? '',
    createNewCustomer: false,
    createAnyway: false,
    customerName: lead?.customerName ?? '',
    phone: lead?.phone ?? '',
    alternatePhone: lead?.alternatePhone ?? '',
    email: lead?.email ?? '',
    dateOfBirth: dateValue(lead?.dateOfBirth),
    leadSource: lead?.leadSource ?? 'WEBSITE',
    leadType: lead?.leadType ?? 'FRESH',
    leadStage: lead?.leadStage ?? 'NEW_LEAD',
    priority: lead?.priority ?? 'MEDIUM',
    departureCountry: lead?.departureCountry ?? 'India',
    departureCity: lead?.departureCity ?? '',
    travelStartDate: dateValue(lead?.travelStartDate),
    ...travelMonthYearDefaults(lead),
    travelEndDate: '',
    flexibleDates: lead?.flexibleDates ?? false,
    rooms: lead?.rooms ?? 1,
    adults: lead?.adults ?? 1,
    childrenWithBed: lead?.childrenWithBed ?? 0,
    childrenWithoutBed: lead?.childrenWithoutBed ?? 0,
    infants: lead?.infants ?? 0,
    extraBeds: lead?.extraBeds ?? 0,
    expectedAmount: lead?.expectedAmount ?? '',
    budgetMin: lead?.budgetMin ?? '',
    budgetMax: lead?.budgetMax ?? '',
    expectedMargin: lead?.expectedMargin ?? '',
    currency: lead?.currency ?? 'INR',
    tripType: lead?.tripType ?? '',
    quotationRequired: lead?.quotationRequired ?? false,
    bookingStatusPlaceholder: lead?.bookingStatusPlaceholder ?? '',
    webLinkPlaceholder: lead?.webLinkPlaceholder ?? '',
    supplierCostingNotes: lead?.supplierCostingNotes ?? '',
    assignedToId: lead?.assignedToId ?? '',
    internalRemarks: lead?.internalRemarks ?? '',
    services: lead ? lead.services.map((s) => s.serviceType) : ['HOTEL', 'SIGHTSEEING'],
    childrenWithBedAges: lead?.childrenWithBedAges ?? [],
    childrenWithoutBedAges: lead?.childrenWithoutBedAges ?? [],
    infantAges: lead?.infantAges ?? [],
    adultNames: lead?.adultNames ?? [],
    childWithBedNames: lead?.childWithBedNames ?? [],
    childWithoutBedNames: lead?.childWithoutBedNames ?? [],
    infantNames: lead?.infantNames ?? [],
    itinerary: lead?.itinerary.map((r) => ({
      ...r,
      arrivalDate: dateValue(r.arrivalDate),
      departureDate: dateValue(r.departureDate),
      notes: r.notes ?? '',
    })) ?? [emptyRow()],
    initialNote: '',
    followUpAt: '',
  };
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="space-y-1 text-sm font-medium text-slate-700">
    <span>{label}</span>
    {children}
  </label>
);
const inputClass = 'w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm';

/** Optional per-traveller name inputs for one passenger category. */
function TravellerNameInputs({
  count,
  field,
  label,
  register,
}: {
  count: number;
  field: (
    index: number,
  ) =>
    | `adultNames.${number}`
    | `childWithBedNames.${number}`
    | `childWithoutBedNames.${number}`
    | `infantNames.${number}`;
  label: (index: number) => string;
  register: UseFormRegister<FormValues>;
}) {
  if (count <= 0) return null;
  return (
    <div className="mb-2 grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <Field key={field(index)} label={label(index)}>
          <input
            className={inputClass}
            maxLength={120}
            {...register(field(index))}
          />
        </Field>
      ))}
    </div>
  );
}
const sectionTones = {
  blue: 'bg-blue-600 text-white',
  teal: 'bg-teal-600 text-white',
  green: 'bg-green-600 text-white',
  slate: 'bg-slate-900 text-white',
} as const;
const Section = ({
  title,
  children,
  tone = 'slate',
}: {
  title: string;
  children: React.ReactNode;
  tone?: keyof typeof sectionTones;
}) => (
  <section className="overflow-hidden rounded-lg border border-slate-200 bg-card shadow-sm">
    <h2 className={cn('px-4 py-3 text-sm font-semibold', sectionTones[tone])}>{title}</h2>
    <div className="p-4">{children}</div>
  </section>
);
/**
 * Comprehensive Indian city list (see `apps/web/src/data/indian-cities.json`,
 * generated from country-state-city plus legacy spelling aliases). Values are
 * always plain city names so previously stored departure cities keep working;
 * labels add the state only where a name exists in more than one state.
 */
interface IndianCityEntry {
  city: string;
  state: string;
}
const INDIAN_CITIES: IndianCityEntry[] = indianCityData.entries;
const INDIAN_CITY_STATE_COUNT: Record<string, number> = {};
for (const entry of INDIAN_CITIES) {
  INDIAN_CITY_STATE_COUNT[entry.city] = (INDIAN_CITY_STATE_COUNT[entry.city] ?? 0) + 1;
}
const CREATE_LEAD_SERVICES = [
  'CRUISE',
  'FLIGHT',
  'HOTEL',
  'VEHICLE_TRANSFER',
  'SIGHTSEEING',
  'VISA',
  'OTHER_ADD_ON',
] as const;
const SERVICE_LABELS: Partial<Record<string, string>> = {
  VEHICLE_TRANSFER: 'Vehicle',
  OTHER_ADD_ON: 'Add-on Service (Rail, Passport, etc.)',
};
const SERVICE_ICONS: Partial<Record<string, LucideIcon>> = {
  FLIGHT: Plane,
  HOTEL: Hotel,
  CRUISE: Ship,
  VEHICLE_TRANSFER: Car,
  SIGHTSEEING: Telescope,
  VISA: FileText,
  RAIL: Train,
  PASSPORT_ASSISTANCE: FileText,
  OTHER_ADD_ON: PackagePlus,
  GENERAL_ENQUIRY: FileText,
};

export function LeadForm({
  lead,
  onSave,
  saving,
  error,
  errorFields,
}: {
  lead?: Lead;
  onSave: (v: QueryInput) => void;
  saving: boolean;
  error?: string;
  errorFields?: Record<string, string[]>;
}) {
  const { hasPermission, user } = useAuth();
  const [localError, setLocalError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const requestedCustomerId = lead ? '' : (searchParams.get('customerId') ?? '');
  const requestedCustomer = useCustomer(requestedCustomerId || undefined);
  const { data: lookups } = useLeadLookups();
  const {
    register,
    control,
    watch,
    setValue,
    reset,
    handleSubmit,
    formState: { isDirty },
  } = useForm<FormValues>({ defaultValues: defaults(lead) });
  useEffect(() => reset(defaults(lead)), [lead, reset]);
  // Travel Timing mode follows the loaded record: exact date and month/year
  // are mutually exclusive, so the mode tracks whichever representation the
  // saved data carries. Keyed on the lead id so background refetches (same
  // id, new object identity) never yank a mode the user just picked.
  const [travelTiming, setTravelTiming] = useState<TravelTimingMode>(() =>
    travelTimingModeFor(lead),
  );
  // Traveller name inputs are hidden until the section is expanded. The
  // inputs stay mounted (CSS-hidden) so typed or saved names are preserved.
  const [travellerNamesOpen, setTravellerNamesOpen] = useState(false);
  const leadIdentity = lead?.id ?? null;
  useEffect(() => {
    setTravelTiming(travelTimingModeFor(lead));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIdentity]);
  useEffect(() => {
    if (!requestedCustomer.data || lead) return;
    setValue('customerId', requestedCustomer.data.id);
    setValue('customerName', requestedCustomer.data.displayName);
    setValue('phone', requestedCustomer.data.primaryPhone ?? '');
    setValue('email', requestedCustomer.data.email ?? '');
    setValue('alternatePhone', requestedCustomer.data.alternatePhone ?? '');
  }, [lead, requestedCustomer.data, setValue]);
  // Create Lead preselects Assign To with the logged-in creator once the
  // session user is known. Edit Lead is untouched, a manual pick is never
  // overridden, and a later session-identity change re-applies cleanly.
  // (The actual defaulting effect lives below, next to assigneeOptions, so it
  // can also wait for the matching dropdown option to exist.)
  const assignedToId = watch('assignedToId');
  const defaultedAssigneeRef = useRef<string | null>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  const { fields, append, remove } = useFieldArray({ control, name: 'itinerary' });
  const services = watch('services');
  const departureCountry = watch('departureCountry');
  const departureCity = watch('departureCity');
  const counts = watch([
    'rooms',
    'adults',
    'childrenWithBed',
    'childrenWithoutBed',
    'infants',
    'extraBeds',
  ]);
  const countryOptions = useMemo(
    () => countries.map((country) => country.name.common).sort((a, b) => a.localeCompare(b)),
    [],
  );
  // Searchable-select shape of the same country list (Create form only).
  const countrySelectOptions = useMemo(
    () => countryOptions.map((country) => ({ value: country, label: country })),
    [countryOptions],
  );
  const cityOptions = useMemo(() => {
    if (departureCountry === 'India')
      return INDIAN_CITIES.map((entry) => ({
        value: entry.city,
        label:
          (INDIAN_CITY_STATE_COUNT[entry.city] ?? 0) > 1
            ? `${entry.city} (${entry.state})`
            : entry.city,
        searchText: entry.state,
      }));
    return (lookups?.cities ?? [])
      .map((city) => ({ value: city, label: city }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [departureCountry, lookups?.cities]);
  // Itinerary destinations come from the Destinations master so each row's City
  // dropdown can show the cities linked to the chosen destination.
  const itineraryDestinations = useDestinations(ITINERARY_DESTINATIONS_PARAMS);
  const destinationCityMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const destination of itineraryDestinations.data?.data ?? []) {
      map.set(
        destination.name,
        destination.cities
          .slice()
          .sort((a, b) => a.sequence - b.sequence)
          .map((link) => link.city.name),
      );
    }
    return map;
  }, [itineraryDestinations.data?.data]);
  // Searchable-select shape of the same destination list (Create form only).
  // The closed field shows the plain public name — the submitted value is
  // always the destination name — while the private name stays searchable.
  const destinationSelectOptions = useMemo(
    () =>
      (itineraryDestinations.data?.data ?? []).map((destination) => ({
        value: destination.name,
        label: destination.name,
        searchText: destination.privateName ?? null,
      })),
    [itineraryDestinations.data?.data],
  );
  const itineraryRows = watch('itinerary');
  const fieldErrorMessages = Object.entries(errorFields ?? {})
    .flatMap(([field, messages]) => messages.map((message) => ({ field, message })))
    .slice(0, 6);
  /**
   * Eligible assignees for the "Assign To" field. The logged-in user is always
   * included (placed first and labelled "(You)") and deduplicated against the
   * team-member list the backend returns, so an Admin/Owner can assign a lead
   * to themselves or to another eligible team member.
   */
  const assigneeOptions = useMemo(() => {
    const team = lookups?.assignableUsers ?? [];
    const existingCurrentUser = team.find((assignableUser) => assignableUser.id === user?.id);
    const others = team.filter((assignableUser) => assignableUser.id !== user?.id);
    if (!user) return others;
    const me: UserOption = existingCurrentUser ?? {
      id: user.id,
      fullName: (user.fullName || '').trim() || user.username || 'You',
      username: user.username,
    };
    return [me, ...others];
  }, [lookups, user]);
  // Default Assign To to the session user once both the session ID and its
  // valid dropdown option are available (the me-fallback above guarantees the
  // option exists whenever the session does, so an ID is never set without a
  // matching option). Runs on Create only; never touches a manual pick or a
  // cleared field again once it has defaulted for the active session.
  useEffect(() => {
    if (lead) return;
    const sessionId = user?.id;
    if (!sessionId) return;
    if (!assigneeOptions.some((option) => option.id === sessionId)) return;
    if (defaultedAssigneeRef.current === sessionId) return;
    if (assignedToId !== '' && assignedToId !== defaultedAssigneeRef.current) return;
    defaultedAssigneeRef.current = sessionId;
    if (assignedToId !== sessionId) setValue('assignedToId', sessionId);
  }, [lead, user?.id, assigneeOptions, assignedToId, setValue]);
  const childrenWithBedCount = Math.max(0, Math.min(100, Number(counts[2]) || 0));
  const childrenWithoutBedCount = Math.max(0, Math.min(100, Number(counts[3]) || 0));
  const infantCount = Math.max(0, Math.min(100, Number(counts[4]) || 0));
  const adultCount = Math.max(0, Math.min(200, Number(counts[1]) || 0));
  const summary = [
    `${counts[1] || 0} Adult${counts[1] === 1 ? '' : 's'}`,
    counts[2] ? `${counts[2]} Child With Bed` : '',
    counts[3] ? `${counts[3]} Child Without Bed` : '',
    counts[4] ? `${counts[4]} Infant${counts[4] === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  /**
   * Switch the Travel Timing mode, clearing the representation being left
   * behind so hidden fields can never stay populated and be submitted.
   */
  const selectTravelTiming = (mode: TravelTimingMode) => {
    setTravelTiming(mode);
    if (mode === 'exact') {
      setValue('travelMonth', '', { shouldDirty: true });
      setValue('travelYear', '', { shouldDirty: true });
    } else {
      setValue('travelStartDate', '', { shouldDirty: true });
    }
  };
  const submit = (v: FormValues) => {
    const itinerary = v.itinerary
      .filter((r) => r.country.trim() && r.destination.trim())
      .map((r, index) => ({
        ...r,
        sequence: index + 1,
        arrivalDate: r.arrivalDate ? new Date(r.arrivalDate) : null,
        departureDate: r.departureDate ? new Date(r.departureDate) : null,
        notes: r.notes || null,
      }));

    if (hasPermission('queries.assign') && !v.assignedToId) {
      setLocalError('Please fix the following errors: Assign To is required.');
      return;
    }
    // Travel Timing is mutually exclusive: only the active mode's
    // representation is submitted. The inactive side is always nulled so a
    // hidden field can never leak a stale conflicting value. An incomplete
    // month/year pair (only one side selected) is treated as empty so an
    // invalid combination is never saved; the backend pair rule agrees.
    // Never invent a day from month/year.
    const monthSelected =
      travelTiming === 'month' && v.travelMonth ? Number(v.travelMonth) : null;
    const yearSelected =
      travelTiming === 'month' && v.travelYear ? Number(v.travelYear) : null;
    const travelMonth = monthSelected != null && yearSelected != null ? monthSelected : null;
    const travelYear = monthSelected != null && yearSelected != null ? yearSelected : null;
    const travelStartDate =
      travelTiming === 'exact' && v.travelStartDate ? new Date(v.travelStartDate) : null;
    if (v.services.length === 0) {
      setLocalError('Please fix the following errors: Select at least one service required.');
      return;
    }
    if (itinerary.length === 0) {
      setLocalError(
        'Please fix the following errors: At least one destination and city must be selected.',
      );
      return;
    }
    setLocalError(null);

    onSave({
      ...v,
      customerId: v.customerId || null,
      flexibleDates: false,
      email: v.email || null,
      alternatePhone: v.alternatePhone || null,
      dateOfBirth: v.dateOfBirth ? new Date(v.dateOfBirth) : null,
      departureCountry: v.departureCountry || null,
      departureCity: v.departureCity || null,
      // Exact date and month/year are stored semantically separate: never
      // derive one from the other and never invent a day from month/year.
      travelStartDate,
      travelEndDate: null,
      travelMonth,
      travelYear,
      // Per-child ages: drop blank inputs so partial entries render correctly
      // ("CWB 1: 8, CWB 2: empty" → [8]) and never become NaN/undefined.
      childrenWithBedAges: (v.childrenWithBedAges ?? []).filter(
        (age): age is number => age != null && Number.isFinite(age),
      ),
      childrenWithoutBedAges: (v.childrenWithoutBedAges ?? []).filter(
        (age): age is number => age != null && Number.isFinite(age),
      ),
      infantAges: (v.infantAges ?? []).filter(
        (age): age is number => age != null && Number.isFinite(age),
      ),
      // Per-traveller names: sized exactly to the passenger counts so each
      // entry keeps its position (blanks preserved); shrinking a count drops
      // only the removed trailing rows, growing appends blanks.
      adultNames: namesFor(v.adultNames, v.adults),
      childWithBedNames: namesFor(v.childWithBedNames, v.childrenWithBed),
      childWithoutBedNames: namesFor(v.childWithoutBedNames, v.childrenWithoutBed),
      infantNames: namesFor(v.infantNames, v.infants),
      expectedAmount: v.expectedAmount ? Number(v.expectedAmount) : null,
      budgetMin: v.budgetMin ? Number(v.budgetMin) : null,
      budgetMax: v.budgetMax ? Number(v.budgetMax) : null,
      expectedMargin: v.expectedMargin ? Number(v.expectedMargin) : null,
      tripType: v.tripType || null,
      bookingStatusPlaceholder: v.bookingStatusPlaceholder || null,
      webLinkPlaceholder: v.webLinkPlaceholder || null,
      supplierCostingNotes: v.supplierCostingNotes || null,
      assignedToId: v.assignedToId || null,
      internalRemarks: v.internalRemarks || null,
      services: v.services as QueryInput['services'],
      itinerary,
      initialNote: v.initialNote || null,
      initialFollowUp: v.followUpAt
        ? { scheduledAt: new Date(v.followUpAt), assignedToId: v.assignedToId || user?.id }
        : undefined,
    } as QueryInput);
  };
  return (
    <form
      onSubmit={handleSubmit(submit)}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (event.key === 'Enter' && target.tagName !== 'TEXTAREA') {
          event.preventDefault();
        }
      }}
      className="space-y-5"
    >
      {(localError || error) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{localError ?? error}</p>
          {!localError && fieldErrorMessages.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1">
              {fieldErrorMessages.map(({ field, message }) => (
                <li key={`${field}-${message}`}>
                  {field}: {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)]">
        <div className="min-w-0 space-y-5">
          <Section title="Lead Information" tone="blue">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="md:col-span-2 lg:col-span-3">
              <Field label="Name *">
                <input
                  aria-label="Name"
                  className={inputClass}
                  {...register('customerName', { required: true, minLength: 2 })}
                />
              </Field>
            </div>
            <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 gap-4">
              <Field label="Phone *">
                <input
                  aria-label="Phone"
                  className={inputClass}
                  inputMode="tel"
                  {...register('phone', { required: true, minLength: 5 })}
                />
              </Field>
              {/* Email is shown on neither form (UI-only). It stays registered
                so the submitted payload shape is unchanged and saved email
                data is preserved. */}
              <input type="hidden" {...register('email')} />
            </div>
            {/* Priority is not part of the lead workflow: hidden from both the
                create and edit forms. The value stays in form state and is
                submitted unchanged so existing data and APIs are untouched. */}
            {(['leadSource', 'leadType', 'leadStage'] as const).map((name) => (
              <Field
                key={name}
                label={
                  (
                    {
                      leadSource: 'Lead Source *',
                      leadType: 'Type *',
                      leadStage: 'Stage *',
                    } as const
                  )[name]
                }
              >
                <select className={inputClass} {...register(name)}>
                  {lookups?.[
                    name === 'leadSource'
                      ? 'leadSources'
                      : name === 'leadType'
                        ? 'leadTypes'
                        : 'leadStages'
                  ]
                    ?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </select>
              </Field>
            ))}
            <Field label="Assign To *">
              <select
                aria-label="Assigned salesperson"
                className={inputClass}
                disabled={!hasPermission('queries.assign')}
                {...register('assignedToId')}
              >
                <option value="">
                  {hasPermission('queries.assign') ? 'Select User' : 'Assign to me'}
                </option>
                {assigneeOptions.map((assignableUser) => (
                  <option key={assignableUser.id} value={assignableUser.id}>
                    {assignableUser.fullName}
                    {assignableUser.id === user?.id ? ' (You)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>
        <Section title="Services Required *" tone="green">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CREATE_LEAD_SERVICES.filter((value) => value !== 'VISA').map((value) => {
              const Icon = SERVICE_ICONS[value] ?? PackagePlus;
              const label =
                SERVICE_LABELS[value] ??
                lookups?.serviceTypes.find((service) => service.value === value)?.label ??
                value;
              return (
                <label key={value} className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={services.includes(value)}
                    onChange={(e) =>
                      setValue(
                        'services',
                        e.target.checked
                          ? [...services, value]
                          : services.filter((service) => service !== value),
                        { shouldDirty: true },
                      )
                    }
                  />
                  <Icon className="h-4 w-4 text-slate-700" />
                  {label}
                </label>
              );
            })}
          </div>
          {services.length === 0 && (
            <p className="mt-3 text-sm text-red-600">Select at least one service.</p>
          )}
        </Section>
        </div>
        <Section title="Travel Details" tone="teal">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Travel Timing</legend>
                <div
                  role="radiogroup"
                  aria-label="Travel Timing"
                  className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
                >
                  {(
                    [
                      { value: 'exact', label: 'Exact Date' },
                      { value: 'month', label: 'Month' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={travelTiming === option.value}
                      onClick={() => selectTravelTiming(option.value)}
                      className={
                        travelTiming === option.value
                          ? 'rounded-md bg-card px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm'
                          : 'rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700'
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            {travelTiming === 'exact' ? (
              <Field label="Travel Date">
                <input
                  aria-label="Travel Date"
                  type="date"
                  className={inputClass}
                  {...register('travelStartDate')}
                />
              </Field>
            ) : (
              <div className="md:col-span-2">
                <Field label="Travel Month">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      aria-label="Travel month"
                      className={inputClass}
                      {...register('travelMonth')}
                    >
                      <option value="">Month</option>
                      {TRAVEL_MONTH_NAMES.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Travel year"
                      className={inputClass}
                      {...register('travelYear')}
                    >
                      <option value="">Year</option>
                      {travelYearOptions().map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              </div>
            )}
            <Field label="Departure country">
              <SearchableSelect
                ariaLabel="Departure country"
                placeholder="Select country"
                options={countrySelectOptions}
                value={departureCountry}
                onChange={(next) => {
                  setValue('departureCountry', next, { shouldDirty: true });
                  // Keep the existing behavior: a country change clears the
                  // city, so a city from another country can never be kept.
                  setValue('departureCity', '', { shouldDirty: true });
                }}
              />
            </Field>
            <Field label="Departure city">
              <SearchableSelect
                ariaLabel="Departure city"
                placeholder="Select city"
                options={cityOptions}
                value={departureCity}
                onChange={(next) => setValue('departureCity', next, { shouldDirty: true })}
              />
            </Field>
          </div>
          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <input type="hidden" {...register('rooms', { valueAsNumber: true })} />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {(
                ['adults', 'childrenWithBed', 'childrenWithoutBed', 'infants'] as const
              ).map((name) => (
                <Field
                  key={name}
                  label={
                    (
                      {
                        adults: 'Adults *',
                        childrenWithBed: 'CWB',
                        childrenWithoutBed: 'CWOB',
                        infants: 'Infants',
                      } as const
                    )[name]
                  }
                >
                  <input
                    className={inputClass}
                    type="number"
                    min={name === 'adults' ? 1 : 0}
                    {...register(name, { valueAsNumber: true })}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              <strong>CWB</strong> = Child with Bed | <strong>CWOB</strong> = Child without Bed
            </p>
            {childrenWithBedCount > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: childrenWithBedCount }, (_, index) => (
                  <Field key={`cwb-age-${index}`} label={`CWB ${index + 1} Age`}>
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      placeholder="Age"
                      {...register(`childrenWithBedAges.${index}`, {
                        setValueAs: (value) => (value === '' ? null : Number(value)),
                      })}
                    />
                  </Field>
                ))}
              </div>
            )}
            {childrenWithoutBedCount > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: childrenWithoutBedCount }, (_, index) => (
                  <Field key={`cwob-age-${index}`} label={`CWOB ${index + 1} Age`}>
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      placeholder="Age"
                      {...register(`childrenWithoutBedAges.${index}`, {
                        setValueAs: (value) => (value === '' ? null : Number(value)),
                      })}
                    />
                  </Field>
                ))}
              </div>
            )}
            {infantCount > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: infantCount }, (_, index) => (
                  <Field
                    key={`infant-age-${index}`}
                    label={`Infant ${index + 1} Age (Months)`}
                  >
                    <input
                      aria-label={`Infant ${index + 1} Age (Months)`}
                      className={inputClass}
                      type="number"
                      min="0"
                      max="24"
                      placeholder="Age in months"
                      {...register(`infantAges.${index}`, {
                        setValueAs: (value) => (value === '' ? null : Number(value)),
                      })}
                    />
                  </Field>
                ))}
              </div>
            )}
            <div className="mt-4 bg-slate-100 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-800">Travelers:</p>
              <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {summary || '1 Adult(s)'}
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button"
                aria-expanded={travellerNamesOpen}
                aria-controls="traveller-names-panel"
                onClick={() => setTravellerNamesOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200"
              >
                <span>Traveller names</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${travellerNamesOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {/* Hidden (not unmounted) when collapsed so typed or saved names
                  stay registered and submit unchanged. The native hidden
                  attribute keeps the inputs out of sight, tab order and the
                  accessibility tree. */}
              <div hidden={!travellerNamesOpen} id="traveller-names-panel">
                <TravellerNameInputs
                  count={adultCount}
                  field={(index) => `adultNames.${index}` as const}
                  label={(index) => `Adult ${index + 1}`}
                  register={register}
                />
                <TravellerNameInputs
                  count={childrenWithBedCount}
                  field={(index) => `childWithBedNames.${index}` as const}
                  label={(index) => `Child With Bed ${index + 1}`}
                  register={register}
                />
                <TravellerNameInputs
                  count={childrenWithoutBedCount}
                  field={(index) => `childWithoutBedNames.${index}` as const}
                  label={(index) => `Child Without Bed ${index + 1}`}
                  register={register}
                />
                <TravellerNameInputs
                  count={infantCount}
                  field={(index) => `infantNames.${index}` as const}
                  label={(index) => `Infant ${index + 1}`}
                  register={register}
                />
              </div>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Itinerary *" tone="blue">
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid gap-3 rounded-lg border border-slate-200 bg-card p-4 md:grid-cols-[1fr_1fr_180px_240px]"
            >
              <Field label={`Destination ${index + 1}`}>
                <SearchableSelect
                  ariaLabel={`Destination ${index + 1}`}
                  placeholder="Select Destination"
                  options={destinationSelectOptions}
                  value={itineraryRows?.[index]?.country ?? ''}
                  onChange={(next) => {
                    setValue(`itinerary.${index}.country`, next, { shouldDirty: true });
                    // Reset the city only when it is no longer valid for the
                    // new destination, so a shared city survives the change.
                    const currentCity = itineraryRows?.[index]?.destination ?? '';
                    if (currentCity && !(destinationCityMap.get(next) ?? []).includes(currentCity)) {
                      setValue(`itinerary.${index}.destination`, '', { shouldDirty: true });
                    }
                  }}
                />
              </Field>
              <Field label={`City ${index + 1}`}>
                <SearchableSelect
                  ariaLabel={`City ${index + 1}`}
                  placeholder={
                    itineraryRows?.[index]?.country ? 'Select City' : 'Select a destination first'
                  }
                  options={(
                    destinationCityMap.get(itineraryRows?.[index]?.country ?? '') ?? []
                  ).map((cityName) => ({ value: cityName, label: cityName }))}
                  value={itineraryRows?.[index]?.destination ?? ''}
                  disabled={!itineraryRows?.[index]?.country}
                  onChange={(next) =>
                    setValue(`itinerary.${index}.destination`, next, { shouldDirty: true })
                  }
                />
              </Field>
              <Field label="Nights">
                <input
                  aria-label={`Nights ${index + 1}`}
                  type="number"
                  min="0"
                  className={inputClass}
                  {...register(`itinerary.${index}.nights`, { valueAsNumber: true })}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button
                  className="flex-1 bg-green-600 text-white hover:bg-green-700"
                  onClick={() => append(emptyRow(fields.length + 1))}
                >
                  Add More
                </Button>
                {fields.length > 1 && (
                  <Button
                    variant="ghost"
                    aria-label="Remove itinerary"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <div className="flex justify-start gap-2 rounded-lg border bg-card p-4 shadow-sm">
        <Button type="submit" isLoading={saving}>
          {lead ? 'Save changes' : 'Create Lead'}
        </Button>
        <Button variant="secondary" onClick={() => history.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
