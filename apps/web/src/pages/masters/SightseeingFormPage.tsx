import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { PERMISSIONS, SIGHTSEEING_IMAGE_MIME_TYPES } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  approveSightseeingImage,
  confirmSightseeingImage,
  deleteSightseeingImage,
  reorderSightseeingImages,
  useRefreshMasterImageQueries,
  sightseeingImageUrl,
  useCreateSightseeing,
  useDestination,
  useDestinations,
  useSightseeing,
  useUpdateSightseeing,
} from '@/features/masters/masters.api';
import { fieldClass, MasterHeader, RichTextEditor, CurrencySelect } from './MasterUi';
import { MasterImageGalleryField, useMasterImageGallery } from './MasterImageGallery';

const LARGE = new URLSearchParams('pageSize=100&status=ACTIVE');
const MAX_IMAGE_MB = 5;

interface FormValues {
  destinationId: string;
  cityId: string;
  title: string;
  sequence: string;
  estimatedHours: string;
  suggestedStartTime: string;
  description: string;
  remarks: string;
  pricing: Array<{ label: string; price: string; currency: string }>;
  mealDefaults: {
    meals: { breakfast: boolean; lunch: boolean; dinner: boolean };
    mealModes: {
      breakfast: 'NO_TRANSFER' | 'INCLUDE_AT_HOTEL' | 'WITH_TRANSFER' | '';
      lunch: 'NO_TRANSFER' | 'INCLUDE_AT_HOTEL' | 'WITH_TRANSFER' | '';
      dinner: 'NO_TRANSFER' | 'INCLUDE_AT_HOTEL' | 'WITH_TRANSFER' | '';
    };
    mealTransferDetails: { breakfast: string; lunch: string; dinner: string };
    transfer: '' | 'PRIVATE' | 'SHARED' | 'NO_TRANSFER';
  };
  status: 'ACTIVE' | 'INACTIVE';
}

const EMPTY_MEAL_DEFAULTS: FormValues['mealDefaults'] = {
  meals: { breakfast: false, lunch: false, dinner: false },
  mealModes: { breakfast: '', lunch: '', dinner: '' },
  mealTransferDetails: { breakfast: '', lunch: '', dinner: '' },
  transfer: '',
};

const MEAL_NAMES = ['breakfast', 'lunch', 'dinner'] as const;

const MEAL_MODE_OPTIONS = [
  ['NO_TRANSFER', 'No Transfer'],
  ['INCLUDE_AT_HOTEL', 'Include At Hotel'],
  ['WITH_TRANSFER', 'With Transfer'],
] as const;

const TRANSFER_OPTIONS = [
  ['PRIVATE', 'Private Transfer'],
  ['SHARED', 'Shared Transfer'],
  ['NO_TRANSFER', 'No Transfer'],
] as const;

/**
 * Create/edit Sightseeing.
 *
 * Field order follows the reference exactly: Destination → City → Title →
 * Sequence → Estimated Hours → Suggested Start Time → Image on the left, with
 * Description and Remarks on the right.
 */
export function SightseeingFormPage() {
  const { sightseeingId } = useParams<{ sightseeingId: string }>();
  const navigate = useNavigate();
  const record = useSightseeing(sightseeingId);
  const destinations = useDestinations(LARGE);
  const create = useCreateSightseeing();
  const update = useUpdateSightseeing(sightseeingId ?? '');
  const { hasPermission } = useAuth();
  const canManageMedia = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_MANAGE_MEDIA);

  const [formError, setFormError] = useState('');
  // Id of the record whose values currently fill the form. Guards the
  // navigation case A-edit → B-edit (same mounted form): while B loads, the
  // form still shows A's data and must not submit it against B's id.
  const [hydratedId, setHydratedId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      destinationId: '',
      cityId: '',
      title: '',
      sequence: '1',
      estimatedHours: '',
      suggestedStartTime: '',
      description: '',
      remarks: '',
      pricing: [],
      mealDefaults: EMPTY_MEAL_DEFAULTS,
      status: 'ACTIVE',
    },
  });

  const pricingArray = useFieldArray({ control: form.control, name: 'pricing' });

  // City options come from the chosen destination, mirroring the reference's
  // "Cities will be loaded based on selected destination" hint. The backend
  // re-checks the pair, so this is convenience rather than the real control.
  const destinationId = form.watch('destinationId');
  const cityIdValue = form.watch('cityId');
  const destination = useDestination(destinationId || undefined);
  // Root cause fix: both selects are uncontrolled (register) with async options.
  // `form.reset` runs when the sightseeing detail loads, but at that moment
  // (a) the destinations list may not have loaded yet and (b) the dependent
  // destination-detail (cities) ALWAYS loads after, since it needs the id.
  // Setting a select value with no matching <option> makes the browser drop
  // it to "", so a later submit sends "" and trips "Select a ..." validation,
  // forcing a re-select. Include the saved record's destination/city as
  // fallback options (available synchronously with record.data) so reset never
  // loses them. The saved-city fallback only applies while the saved
  // destination is still selected, so intentionally changing destination still
  // clears/reloads cities correctly.
  const savedDestination = record.data?.destination;
  const destinationList = destinations.data?.data ?? [];
  const destinationOptions =
    savedDestination && !destinationList.some((option) => option.id === savedDestination.id)
      ? [...destinationList, { id: savedDestination.id, name: savedDestination.name }]
      : destinationList;
  const detailCities = (destination.data?.cities ?? []).map((link) => link.city);
  const savedCity = record.data?.city;
  const isSavedDestinationSelected =
    !destinationId || !savedDestination || destinationId === savedDestination.id;
  const cityOptions =
    savedCity && isSavedDestinationSelected && !detailCities.some((city) => city.id === savedCity.id)
      ? [...detailCities, { id: savedCity.id, name: savedCity.name }]
      : detailCities;
  /**
   * Inconsistent-record correction path. When the loaded record's own
   * destination/city pairing has no link (the saved city is absent from the
   * freshly loaded destination detail), say so explicitly next to the City
   * field instead of letting the save fail with only the backend message.
   * Nothing is rewritten: the user picks a valid city deliberately. The
   * backend still rejects an uncorrected pairing (defence in depth).
   * The detail response is matched by id so a slow/stale fetch can never
   * mislabel a valid pairing, and the warning clears once the user picks a
   * different city.
   */
  const savedPairUnlinked =
    Boolean(sightseeingId) &&
    Boolean(savedDestination) &&
    Boolean(savedCity) &&
    destinationId === savedDestination!.id &&
    Boolean(destination.data) &&
    destination.data!.id === savedDestination!.id &&
    !detailCities.some((city) => city.id === savedCity!.id);
  const showUnlinkedWarning =
    savedPairUnlinked && (!cityIdValue || cityIdValue === savedCity!.id);
  const refreshImageQueries = useRefreshMasterImageQueries('sightseeing');
  const imageGallery = useMasterImageGallery({
    masterId: sightseeingId,
    entity: record.data,
    allowedMimeTypes: SIGHTSEEING_IMAGE_MIME_TYPES,
    maxSizeMb: MAX_IMAGE_MB,
    api: {
      approve: approveSightseeingImage,
      confirm: confirmSightseeingImage,
      download: sightseeingImageUrl,
      remove: deleteSightseeingImage,
      reorder: reorderSightseeingImages,
    },
    onExistingChange: refreshImageQueries,
  });

  useEffect(() => {
    const value = record.data;
    if (!value) return;
    const savedMeals = value.mealDefaults as {
      meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean } | null;
      mealModes?: { breakfast?: string | null; lunch?: string | null; dinner?: string | null } | null;
      mealTransferDetails?: { breakfast?: string | null; lunch?: string | null; dinner?: string | null } | null;
      transfer?: string | null;
    } | null;
    type MealMode = FormValues['mealDefaults']['mealModes']['breakfast'];
    const mealModeOf = (mode: string | null | undefined): MealMode =>
      mode === 'NO_TRANSFER' || mode === 'INCLUDE_AT_HOTEL' || mode === 'WITH_TRANSFER' ? mode : '';
    const transferOf = (
      transfer: string | null | undefined,
    ): FormValues['mealDefaults']['transfer'] =>
      transfer === 'PRIVATE' || transfer === 'SHARED' || transfer === 'NO_TRANSFER' ? transfer : '';
    form.reset({
      destinationId: value.destination.id,
      cityId: value.city.id,
      title: value.title,
      sequence: String(value.sequence),
      estimatedHours: value.estimatedHours != null ? String(value.estimatedHours) : '',
      suggestedStartTime: value.suggestedStartTime ?? '',
      description: value.description ?? '',
      remarks: value.remarks ?? '',
      pricing: Array.isArray(value.pricing)
        ? value.pricing.map((row) => ({
            label: row.label,
            price: row.price != null ? String(row.price) : '',
            currency: row.currency ?? 'INR',
          }))
        : [],
      mealDefaults: {
        meals: {
          breakfast: savedMeals?.meals?.breakfast ?? false,
          lunch: savedMeals?.meals?.lunch ?? false,
          dinner: savedMeals?.meals?.dinner ?? false,
        },
        mealModes: {
          breakfast: mealModeOf(savedMeals?.mealModes?.breakfast),
          lunch: mealModeOf(savedMeals?.mealModes?.lunch),
          dinner: mealModeOf(savedMeals?.mealModes?.dinner),
        },
        mealTransferDetails: {
          breakfast: savedMeals?.mealTransferDetails?.breakfast ?? '',
          lunch: savedMeals?.mealTransferDetails?.lunch ?? '',
          dinner: savedMeals?.mealTransferDetails?.dinner ?? '',
        },
        transfer: transferOf(savedMeals?.transfer),
      },
      status: value.status as FormValues['status'],
    });
    setHydratedId(value.id);
  }, [record.data, form]);

  if (sightseeingId && record.isError) return <Navigate to="/masters/sightseeing" replace />;
  const mutation = sightseeingId ? update : create;

  const destinationField = form.register('destinationId', {
    required: 'Select a destination.',
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError('');
    // STALE-RECORD GUARD: when navigating between edit pages the previous
    // record's values can still fill the form while the new record loads.
    // Submitting then would PATCH the new id with another record's data.
    // Block until the form holds the route's own record.
    if (sightseeingId && hydratedId !== sightseeingId) {
      setFormError('This record is still loading. Please wait and try again.');
      return;
    }
    // RULE: a saved destination/city must never be replaced with null/"".
    // If the selects momentarily hold "" (e.g. options still loading), fall
    // back to the loaded record in edit mode so the update preserves them.
    // An explicit change to a different valid id still flows through.
    // SAFETY: when the destination was explicitly changed, the record's saved
    // city is NOT a valid fallback — it belongs to the previous destination.
    // Falling back would submit a pairing the user never selected, which the
    // backend rejects ("must be linked"). Require an explicit city instead.
    const savedDestinationId = sightseeingId ? (record.data?.destination.id ?? '') : '';
    const savedCityId = sightseeingId ? (record.data?.city.id ?? '') : '';
    const effectiveDestinationId = values.destinationId || savedDestinationId;
    const destinationChanged =
      Boolean(sightseeingId) &&
      Boolean(values.destinationId) &&
      Boolean(savedDestinationId) &&
      values.destinationId !== savedDestinationId;
    const effectiveCityId = values.cityId || (!destinationChanged ? savedCityId : '');
    if (!effectiveDestinationId) {
      form.setError('destinationId', { message: 'Select a destination.' });
      return;
    }
    if (!effectiveCityId) {
      form.setError('cityId', {
        message: destinationChanged ? 'Select a city for the new destination.' : 'Select a city.',
      });
      return;
    }
    const pricing = (values.pricing ?? [])
      .map((row) => ({
        label: row.label.trim(),
        price: row.price === '' ? null : Number(row.price),
        currency: row.currency || 'INR',
      }))
      .filter((row) => row.label || row.price != null);
    // Meal defaults: send a complete object when anything is set; explicit
    // null clears previously saved defaults on edit; omit on create when blank.
    const mealModes = {
      breakfast: values.mealDefaults.mealModes.breakfast || null,
      lunch: values.mealDefaults.mealModes.lunch || null,
      dinner: values.mealDefaults.mealModes.dinner || null,
    };
    const mealTransferDetails = {
      breakfast: values.mealDefaults.mealTransferDetails.breakfast.trim() || null,
      lunch: values.mealDefaults.mealTransferDetails.lunch.trim() || null,
      dinner: values.mealDefaults.mealTransferDetails.dinner.trim() || null,
    };
    const mealsOn =
      values.mealDefaults.meals.breakfast ||
      values.mealDefaults.meals.lunch ||
      values.mealDefaults.meals.dinner;
    const transfer = values.mealDefaults.transfer || null;
    // Details ride along with their meal mode (a details value can only be
    // entered while its mode is WITH_TRANSFER, which already counts below),
    // so an uncheck-everything + clear-transfer reset still sends null.
    const hasMealDefaults =
      mealsOn || transfer !== null || mealModes.breakfast !== null || mealModes.lunch !== null || mealModes.dinner !== null;
    const hadMealDefaults =
      sightseeingId != null && (record.data as { mealDefaults?: unknown } | undefined)?.mealDefaults != null;
    const payload = {
      destinationId: effectiveDestinationId,
      cityId: effectiveCityId,
      title: values.title.trim(),
      sequence: Number(values.sequence || 1),
      estimatedHours: values.estimatedHours === '' ? null : Number(values.estimatedHours),
      suggestedStartTime: values.suggestedStartTime || null,
      description: values.description || null,
      remarks: values.remarks || null,
      pricing: pricing.length ? pricing : undefined,
      mealDefaults: hasMealDefaults
        ? {
            meals: { ...values.mealDefaults.meals },
            mealModes,
            mealTransferDetails,
            transfer,
          }
        : hadMealDefaults
          ? null
          : undefined,
      status: values.status,
    };
    try {
      const saved = sightseeingId
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      if (canManageMedia) await imageGallery.persist(saved.id);
      navigate(`/masters/sightseeing/${saved.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The sightseeing could not be saved.');
    }
  });

  return (
    <div className="space-y-5">
      <MasterHeader
        title={sightseeingId ? 'Edit Sightseeing' : 'Create Sightseeing'}
        description=""
        current="Sightseeing"
      />

      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {formError}
          </div>
        )}

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="bg-brand-600 px-4 py-3 text-base font-semibold text-white">
            Sightseeing Information
          </h2>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Destination <span className="text-red-600">*</span>
                  <select
                    className={fieldClass}
                    aria-invalid={Boolean(form.formState.errors.destinationId)}
                    {...destinationField}
                    onChange={(event) => {
                      void destinationField.onChange(event);
                      // A city from the previous destination is no longer valid.
                      form.setValue('cityId', '');
                    }}
                  >
                    <option value="">Select Destination</option>
                    {destinationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                {form.formState.errors.destinationId && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.destinationId.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  City <span className="text-red-600">*</span>
                  <select
                    className={fieldClass}
                    disabled={!destinationId}
                    aria-invalid={Boolean(form.formState.errors.cityId)}
                    {...form.register('cityId', { required: 'Select a city.' })}
                  >
                    <option value="">Select City</option>
                    {cityOptions.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Cities will be loaded based on selected destination
                </p>
                {showUnlinkedWarning && (
                  <p role="alert" className="mt-1 text-xs font-medium text-amber-700">
                    The saved city {savedCity!.name} is not linked to destination{' '}
                    {savedDestination!.name}. Select a valid city from the list to correct this
                    record — saving with the current pairing will be rejected.
                  </p>
                )}
                {form.formState.errors.cityId && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.cityId.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Title <span className="text-red-600">*</span>
                  <input
                    className={fieldClass}
                    placeholder="Enter sightseeing title"
                    aria-invalid={Boolean(form.formState.errors.title)}
                    {...form.register('title', {
                      required: 'Title is required.',
                      minLength: { value: 2, message: 'Use at least 2 characters.' },
                    })}
                  />
                </label>
                {form.formState.errors.title && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.title.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Sequence <span className="text-red-600">*</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className={fieldClass}
                    aria-invalid={Boolean(form.formState.errors.sequence)}
                    {...form.register('sequence', {
                      required: 'Sequence is required.',
                      validate: (value) => {
                        const parsed = Number(value);
                        if (!Number.isInteger(parsed)) return 'Sequence must be a whole number.';
                        if (parsed < 1) return 'Sequence must be 1 or more.';
                        return true;
                      },
                    })}
                  />
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Lower sequence numbers will appear first in itineraries
                </p>
                {form.formState.errors.sequence && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.sequence.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Estimated Hours
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    className={fieldClass}
                    placeholder="e.g., 2.5 for 2 hours 30 minutes"
                    aria-invalid={Boolean(form.formState.errors.estimatedHours)}
                    {...form.register('estimatedHours', {
                      validate: (value) => {
                        if (value === '') return true;
                        const parsed = Number(value);
                        if (Number.isNaN(parsed)) return 'Enter a number of hours.';
                        if (parsed < 0) return 'Duration cannot be negative.';
                        if (parsed > 999.99) return 'Duration looks too large.';
                        return true;
                      },
                    })}
                  />
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Duration in hours (e.g., 2.5 for 2 hours 30 minutes)
                </p>
                {form.formState.errors.estimatedHours && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.estimatedHours.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Suggested Start Time
                  <input
                    type="time"
                    lang="en-US"
                    className={fieldClass}
                    {...form.register('suggestedStartTime')}
                  />
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Recommended time to start this activity
                </p>
              </div>

              {canManageMedia && (
                <MasterImageGalleryField
                  label="Sightseeing Images"
                  controller={imageGallery}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  maxSizeMb={MAX_IMAGE_MB}
                />
              )}

              <label className="block text-sm font-medium text-slate-700">
                Status
                <select className={fieldClass} {...form.register('status')}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
            </div>

            <div className="space-y-4">
              <RichTextEditor
                label="Description"
                value={form.watch('description')}
                onChange={(value) => form.setValue('description', value)}
              />
              <div>
                <RichTextEditor
                  label="Remarks"
                  value={form.watch('remarks')}
                  onChange={(value) => form.setValue('remarks', value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Additional notes, tips, or important information
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="bg-teal-600 px-4 py-3 text-base font-semibold text-white">
            Meals Included
          </h2>
          <div className="space-y-4 p-4">
            <p className="text-xs text-slate-500">
              Default meals prefilled into quotation itinerary entries when this activity is
              selected. Quotations keep their own editable copy.
            </p>
            <div className="flex flex-wrap gap-4">
              {MEAL_NAMES.map((meal) => (
                <label key={meal} className="flex items-center gap-2 text-sm capitalize">
                  <input
                    type="checkbox"
                    aria-label={`Meals included ${meal}`}
                    checked={form.watch(`mealDefaults.meals.${meal}`)}
                    onChange={(event) => {
                      form.setValue(`mealDefaults.meals.${meal}`, event.target.checked, {
                        shouldDirty: true,
                      });
                      if (event.target.checked && !form.getValues(`mealDefaults.mealModes.${meal}`)) {
                        form.setValue(`mealDefaults.mealModes.${meal}`, 'NO_TRANSFER', {
                          shouldDirty: true,
                        });
                      }
                      if (!event.target.checked) {
                        // A mode without its meal is dead data: clearing it keeps
                        // "uncheck everything + clear transfer" a true reset.
                        form.setValue(`mealDefaults.mealModes.${meal}`, '', {
                          shouldDirty: true,
                        });
                      }
                    }}
                  />
                  {meal}
                </label>
              ))}
            </div>
            {MEAL_NAMES.filter((meal) => form.watch(`mealDefaults.meals.${meal}`)).map((meal) => (
              <div key={meal} className="rounded-lg border border-slate-200 p-3">
                <p className="text-sm font-semibold capitalize text-slate-700">{meal} options</p>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  {MEAL_MODE_OPTIONS.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2">
                      <input
                        type="radio"
                        aria-label={`${meal} meal mode ${label}`}
                        name={`meal-mode-${meal}`}
                        value={value}
                        checked={form.watch(`mealDefaults.mealModes.${meal}`) === value}
                        onChange={() =>
                          form.setValue(`mealDefaults.mealModes.${meal}`, value, {
                            shouldDirty: true,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {form.watch(`mealDefaults.mealModes.${meal}`) === 'WITH_TRANSFER' && (
                  <label className="mt-3 block text-sm font-medium text-slate-700">
                    Transfer Details
                    <input
                      aria-label={`${meal} transfer details`}
                      placeholder="Enter transfer or meal-location details"
                      value={form.watch(`mealDefaults.mealTransferDetails.${meal}`) ?? ''}
                      onChange={(event) =>
                        form.setValue(
                          `mealDefaults.mealTransferDetails.${meal}`,
                          event.target.value,
                          { shouldDirty: true },
                        )
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="bg-cyan-700 px-4 py-3 text-base font-semibold text-white">Transfer</h2>
          <div className="space-y-3 p-4">
            <p className="text-xs text-slate-500">
              Default transfer prefilled into quotation itinerary entries when this activity is
              selected.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {TRANSFER_OPTIONS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    aria-label={`Transfer default ${label}`}
                    name="transfer-default"
                    value={value}
                    checked={form.watch('mealDefaults.transfer') === value}
                    onChange={() =>
                      form.setValue('mealDefaults.transfer', value, { shouldDirty: true })
                    }
                  />
                  {label}
                </label>
              ))}
              {form.watch('mealDefaults.transfer') ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => form.setValue('mealDefaults.transfer', '', { shouldDirty: true })}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <h2 className="bg-emerald-600 px-4 py-3 text-base font-semibold text-white">Pricing</h2>
          <div className="space-y-4 p-4">
            {pricingArray.fields.length === 0 ? (
              <p className="text-sm text-slate-500">No pricing added. Click Add Price Category to add pricing.</p>
            ) : (
              pricingArray.fields.map((field, index) => (
                <div key={field.id} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <label className="block text-sm font-medium text-slate-700">
                    Category
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm"
                      placeholder="e.g. Adult, Child, Senior"
                      {...form.register(`pricing.${index}.label` as const)}
                    />
                  </label>
                  <div className="block text-sm font-medium text-slate-700">
                    <span>Price</span>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          {form.watch(`pricing.${index}.currency` as const) === 'USD'
                            ? '$'
                            : form.watch(`pricing.${index}.currency` as const) === 'EUR'
                              ? '€'
                              : '₹'}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 pl-7 text-sm"
                          placeholder="e.g. 5000"
                          aria-label={`Pricing ${index + 1} price`}
                          {...form.register(`pricing.${index}.price` as const)}
                        />
                      </div>
                      <CurrencySelect
                        value={form.watch(`pricing.${index}.currency` as const)}
                        onChange={(currency) =>
                          form.setValue(`pricing.${index}.currency` as const, currency)
                        }
                        aria-label={`Pricing ${index + 1} currency`}
                      />
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => pricingArray.remove(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
            <Button size="sm" variant="secondary" onClick={() => pricingArray.append({ label: '', price: '', currency: 'INR' } as never)}>
              <Plus className="h-4 w-4" /> Add Price Category
            </Button>
          </div>
        </section>

        <div className="sticky bottom-0 flex justify-end gap-2 bg-transparent py-2">
          <Button variant="secondary" onClick={() => navigate('/masters/sightseeing')}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            type="submit"
            isLoading={mutation.isPending || form.formState.isSubmitting || imageGallery.isBusy}
          >
            <Save className="h-4 w-4" />{' '}
            {sightseeingId ? 'Update Sightseeing' : 'Create Sightseeing'}
          </Button>
        </div>
      </form>
    </div>
  );
}
