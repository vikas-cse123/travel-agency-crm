import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { ChevronDown, ChevronUp, Plus, Save, X } from 'lucide-react';
import {
  ADD_ON_SERVICE_IMAGE_MIME_TYPES,
  MAX_ADD_ON_PRICING_ENTRIES,
  PERMISSIONS,
} from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/api/client';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  approveAddOnServiceImage,
  confirmAddOnServiceImage,
  deleteAddOnServiceImage,
  reorderAddOnServiceImages,
  useRefreshMasterImageQueries,
  addOnServiceImageUrl,
  useAddOnService,
  useAddOnServices,
  useCreateAddOnService,
  useDestinations,
  useUpdateAddOnService,
  type AddOnService,
  type Page,
} from '@/features/masters/masters.api';
import { fieldClass, MasterHeader, RichTextEditor, CurrencySelect } from './MasterUi';
import { MasterImageGalleryField, useMasterImageGallery } from './MasterImageGallery';

const MAX_IMAGE_MB = 5;

interface DestinationLinkForm {
  destinationId: string;
  isDefault: boolean;
}

/** One repeatable pricing row. `id` is the stable server UUID (kept across edits). */
interface PricingRowForm {
  id: string;
  label: string;
  price: string;
  currency: string;
}

const emptyPricingRow = (): PricingRowForm => ({
  id: crypto.randomUUID(),
  label: '',
  price: '',
  currency: 'INR',
});

/** Saved entries load in order; legacy single price/basis becomes one row. */
function toPricingRows(value: AddOnService): PricingRowForm[] {
  const entries =
    value.pricing?.length > 0
      ? value.pricing
      : value.price != null || value.pricingBasis
        ? [
            {
              id: `legacy-${value.id}`,
              label: value.pricingBasis ?? '',
              price: value.price,
              currency: value.currency ?? 'INR',
            },
          ]
        : [];
  const rows = entries.map((entry) => ({
    id: entry.id,
    label: entry.label ?? '',
    price: entry.price != null ? String(entry.price) : '',
    currency: entry.currency ?? 'INR',
  }));
  return rows.length > 0 ? rows : [emptyPricingRow()];
}

const validateRowPrice = (value: string) => {
  if (value === '' || value == null) return true;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 'Enter a valid price.';
  if (parsed < 0) return 'Price cannot be negative.';
  if (parsed > 99_999_999.99) return 'Price looks too large.';
  return true;
};

interface FormValues {
  name: string;
  description: string;
  pricing: PricingRowForm[];
  destinations: DestinationLinkForm[];
  status: 'ACTIVE' | 'INACTIVE';
}

/** Maximum default add-on services per destination (mirrors the server-side cap). */
export const MAX_DEFAULT_ADD_ONS_PER_DESTINATION = 20;

const DESTINATION_PARAMS = new URLSearchParams('pageSize=100&status=ACTIVE');

/**
 * Create/edit Add-On Service.
 *
 * Full-width layout mirroring the Hotel/Sightseeing master forms: service
 * fields on the left, media + destination associations on the right.
 */
export function AddOnServiceFormPage() {
  const { addOnServiceId } = useParams<{ addOnServiceId: string }>();
  const navigate = useNavigate();
  const record = useAddOnService(addOnServiceId);
  const create = useCreateAddOnService();
  const update = useUpdateAddOnService(addOnServiceId ?? '');
  const { hasPermission } = useAuth();
  const canManageMedia = hasPermission(PERMISSIONS.MASTER_ADD_ON_SERVICES_MANAGE_MEDIA);
  const [formError, setFormError] = useState('');
  const [destinationError, setDestinationError] = useState('');
  const destinations = useDestinations(DESTINATION_PARAMS);
  const refreshImageQueries = useRefreshMasterImageQueries('add-on-services');
  const imageGallery = useMasterImageGallery({
    masterId: addOnServiceId,
    entity: record.data,
    allowedMimeTypes: ADD_ON_SERVICE_IMAGE_MIME_TYPES,
    maxSizeMb: MAX_IMAGE_MB,
    api: {
      approve: approveAddOnServiceImage,
      confirm: confirmAddOnServiceImage,
      download: addOnServiceImageUrl,
      remove: deleteAddOnServiceImage,
      reorder: reorderAddOnServiceImages,
    },
    onExistingChange: refreshImageQueries,
  });

  const form = useForm<FormValues>({
    defaultValues: {
      name: '',
      description: '',
      pricing: [emptyPricingRow()],
      destinations: [],
      status: 'ACTIVE',
    },
  });
  const { fields, append, remove, update: updateLink } = useFieldArray({
    control: form.control,
    name: 'destinations',
  });
  const {
    fields: pricingFields,
    append: appendPricing,
    remove: removePricing,
    move: movePricing,
  } = useFieldArray({ control: form.control, name: 'pricing', keyName: 'rowKey' });
  const linkedIds = useMemo(() => fields.map((field) => field.destinationId), [fields]);

  useEffect(() => {
    const value = record.data;
    if (!value) return;
    form.reset({
      name: value.name,
      description: value.description ?? '',
      pricing: toPricingRows(value),
      destinations: (value.destinations ?? []).map((link) => ({
        destinationId: link.id,
        isDefault: link.isDefault,
      })),
      status: value.status as FormValues['status'],
    });
  }, [record.data, form]);

  if (addOnServiceId && record.isError) return <Navigate to="/masters/add-on-services" replace />;
  const mutation = addOnServiceId ? update : create;

  /** Server-side default count for a destination (pageSize=1 keeps it cheap). */
  const fetchDefaultCount = async (destinationId: string): Promise<number> => {
    const page = await apiClient.get<Page<AddOnService>>(
      `/masters/add-on-services?destinationId=${encodeURIComponent(destinationId)}&isDefault=true&pageSize=1`,
    );
    return page.pagination.total;
  };

  const addDestination = (destinationId: string) => {
    if (!destinationId || linkedIds.includes(destinationId)) return;
    setDestinationError('');
    append({ destinationId, isDefault: false });
  };

  const removeDestination = (index: number) => {
    setDestinationError('');
    remove(index);
  };

  const toggleDefault = async (index: number, next: boolean) => {
    setDestinationError('');
    const link = fields[index];
    if (!link) return;
    if (next) {
      // Would-be defaults for this destination after applying the toggle.
      const pendingForDestination =
        fields.filter((field, i) => i !== index && field.destinationId === link.destinationId && field.isDefault)
          .length + 1;
      try {
        const serverTotal = await fetchDefaultCount(link.destinationId);
        // The stored link for THIS service (if already default) already
        // occupies one of those server slots.
        const ownStoredDefault = (record.data?.destinations ?? []).some(
          (stored) => stored.id === link.destinationId && stored.isDefault,
        );
        const serverOthers = serverTotal - (ownStoredDefault ? 1 : 0);
        if (serverOthers + pendingForDestination > MAX_DEFAULT_ADD_ONS_PER_DESTINATION) {
          const match = (destinations.data?.data ?? []).find(
            (destination) => destination.id === link.destinationId,
          );
          setDestinationError(
            `${match?.name ?? 'This destination'} already has the maximum of ${MAX_DEFAULT_ADD_ONS_PER_DESTINATION} default add-on services. Unmark an existing default first.`,
          );
          return;
        }
      } catch (error) {
        // A failed count check must never silently toggle: surface it and stop.
        setDestinationError(
          error instanceof Error ? error.message : 'Could not verify the default limit.',
        );
        return;
      }
    }
    updateLink(index, { ...link, isDefault: next });
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError('');
    setDestinationError('');
    // Fully-empty rows are never sent; every other row is preserved exactly,
    // so editing one row can never disturb the rest.
    const pricing = values.pricing
      .filter((row) => row.label.trim() !== '' || row.price !== '')
      .map((row) => ({
        id: row.id,
        label: row.label.trim(),
        price: row.price === '' ? null : Number(row.price),
        currency: row.currency || 'INR',
      }));
    // Legacy single-price mirror of the first option (required by the API
    // input type; the server derives the same mirror from `pricing`).
    const [firstPricing] = pricing;
    const payload = {
      name: values.name.trim(),
      description: values.description || null,
      pricing,
      price: firstPricing?.price ?? null,
      currency: firstPricing?.currency ?? 'INR',
      pricingBasis: firstPricing?.label ? firstPricing.label : null,
      destinations: values.destinations.map((link) => ({
        destinationId: link.destinationId,
        isDefault: link.isDefault,
      })),
      status: values.status,
    };
    try {
      const saved = addOnServiceId
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      if (canManageMedia) await imageGallery.persist(saved.id);
      navigate(`/masters/add-on-services/${saved.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The service could not be saved.');
    }
  });

  return (
    <div className="space-y-5">
      <MasterHeader
        title={addOnServiceId ? 'Edit Add-On Service' : 'Create Add-On Service'}
        description="Optional extras offered alongside trips."
        current="Add-On Services"
      />

      <form onSubmit={submit} className="space-y-5" noValidate>
        {(mutation.error || formError) && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {formError || mutation.error?.message}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
              Service Information
            </h2>
            <div className="space-y-4 p-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Service Name <span className="text-red-600">*</span>
                  <input
                    className={fieldClass}
                    placeholder="Enter service name"
                    aria-invalid={Boolean(form.formState.errors.name)}
                    {...form.register('name', {
                      required: 'Service name is required.',
                      minLength: { value: 2, message: 'Use at least 2 characters.' },
                    })}
                  />
                </label>
                {form.formState.errors.name && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <RichTextEditor
                label="Description"
                value={form.watch('description')}
                onChange={(value) => form.setValue('description', value)}
              />

              <div>
                <div className="block text-sm font-medium text-slate-700">
                  <span>
                    Pricing{' '}
                    <span className="font-normal text-slate-500">
                      ({pricingFields.length} / {MAX_ADD_ON_PRICING_ENTRIES})
                    </span>
                  </span>
                  <div className="mt-1 space-y-2">
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_minmax(0,96px)_auto] items-center gap-2 text-xs font-medium text-slate-500"
                      aria-hidden="true"
                    >
                      <span>Label</span>
                      <span>Price</span>
                      <span>Currency</span>
                      <span />
                    </div>
                    {pricingFields.map((field, index) => (
                      <div key={field.rowKey} className="grid grid-cols-[minmax(0,1fr)_minmax(0,120px)_minmax(0,96px)_auto] items-start gap-2">
                        <input
                          className={`${fieldClass} mt-0 min-w-0`}
                          placeholder="e.g. Adult"
                          maxLength={80}
                          aria-label={`Pricing option ${index + 1} label`}
                          {...form.register(`pricing.${index}.label`)}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={`${fieldClass} mt-0 min-w-0`}
                          placeholder="e.g. 5000"
                          aria-label={`Pricing option ${index + 1} price`}
                          aria-invalid={Boolean(
                            form.formState.errors.pricing?.[index]?.price,
                          )}
                          {...form.register(`pricing.${index}.price`, {
                            validate: validateRowPrice,
                          })}
                        />
                        <CurrencySelect
                          value={form.watch(`pricing.${index}.currency`)}
                          onChange={(currency) =>
                            form.setValue(`pricing.${index}.currency`, currency)
                          }
                          aria-label={`Pricing option ${index + 1} currency`}
                        />
                        <span className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Move pricing option ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => movePricing(index, index - 1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Move pricing option ${index + 1} down`}
                            disabled={index === pricingFields.length - 1}
                            onClick={() => movePricing(index, index + 1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove pricing option ${index + 1}`}
                            onClick={() => removePricing(index)}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </span>
                        {form.formState.errors.pricing?.[index]?.price && (
                          <p
                            role="alert"
                            className="col-span-full -mt-1 text-xs font-medium text-red-600"
                          >
                            {
                              form.formState.errors.pricing[index]?.price
                                ?.message as string
                            }
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  disabled={pricingFields.length >= MAX_ADD_ON_PRICING_ENTRIES}
                  onClick={() => appendPricing(emptyPricingRow())}
                >
                  <Plus className="h-4 w-4" /> Add Pricing
                </Button>
                <p className="mt-1 text-xs text-slate-500">
                  Each row is saved as its own pricing option in order. The first
                  option also sets the default quotation price.
                </p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Status
                <select className={fieldClass} {...form.register('status')}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>
            </div>
          </section>

          <div className="space-y-5">
            {canManageMedia && (
              <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="p-4">
                  <MasterImageGalleryField
                    label="Service Images"
                    controller={imageGallery}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    maxSizeMb={MAX_IMAGE_MB}
                  />
                </div>
              </section>
            )}

            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
                Destinations
              </h2>
              <div className="space-y-3 p-4">
                <p className="text-xs text-slate-500">
                  Associate destinations for automatic quotation prefill. Marking a
                  destination as default adds this service to new quotations for it
                  (up to {MAX_DEFAULT_ADD_ONS_PER_DESTINATION} defaults per destination).
                </p>
                {fields.length > 0 && (
                  <ul className="space-y-2">
                    {fields.map((field, index) => {
                      const match = (destinations.data?.data ?? []).find(
                        (destination) => destination.id === field.destinationId,
                      );
                      return (
                        <li
                          key={field.id}
                          className="flex items-center gap-3 rounded-lg border bg-slate-50 p-3"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {match?.name ?? 'Destination'}
                            </span>
                            <DefaultCountHint destinationId={field.destinationId} />
                          </span>
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                            <input
                              type="checkbox"
                              aria-label={`Default add-on for ${match?.name ?? 'destination'}`}
                              checked={field.isDefault}
                              onChange={(event) => void toggleDefault(index, event.target.checked)}
                            />
                            Default
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${match?.name ?? 'destination'}`}
                            onClick={() => removeDestination(index)}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Select destination"
                    className={`${fieldClass} mt-0 min-w-0 flex-1`}
                    value=""
                    disabled={destinations.isPending}
                    onChange={(event) => {
                      addDestination(event.target.value);
                      event.target.value = '';
                    }}
                  >
                    <option value="">+ Select Destination</option>
                    {(destinations.data?.data ?? [])
                      .filter((destination) => !linkedIds.includes(destination.id))
                      .map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                  </select>
                </div>
                {destinationError && (
                  <p role="alert" className="text-xs font-medium text-red-600">
                    {destinationError}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
          <Button variant="secondary" onClick={() => navigate('/masters/add-on-services')}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            type="submit"
            isLoading={mutation.isPending || imageGallery.isBusy || form.formState.isSubmitting}
          >
            <Save className="h-4 w-4" /> {addOnServiceId ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Live default count for one destination ("3 / 20 defaults"). */
function DefaultCountHint({ destinationId }: { destinationId: string }) {
  const params = useMemo(
    () =>
      new URLSearchParams({
        status: 'ACTIVE',
        pageSize: '1',
        destinationId,
        isDefault: 'true',
      }),
    [destinationId],
  );
  const query = useAddOnServices(params);
  const total = query.data?.pagination.total;
  return (
    <span className="mt-0.5 block text-xs text-slate-500" aria-live="polite">
      {total == null
        ? 'Checking defaults…'
        : `${total} / ${MAX_DEFAULT_ADD_ONS_PER_DESTINATION} defaults`}
    </span>
  );
}
