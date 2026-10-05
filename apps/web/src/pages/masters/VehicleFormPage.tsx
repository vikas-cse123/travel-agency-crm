import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Save, X } from 'lucide-react';
import { PERMISSIONS, VEHICLE_IMAGE_MIME_TYPES } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  approveVehicleImage,
  confirmVehicleImage,
  deleteVehicleImage,
  reorderVehicleImages,
  useRefreshMasterImageQueries,
  useCreateVehicle,
  useDestinations,
  useUpdateVehicle,
  useVehicle,
  useVehicleTypes,
  vehicleImageUrl,
} from '@/features/masters/masters.api';
import { fieldClass, MasterHeader, CurrencySelect } from './MasterUi';
import { MasterImageGalleryField, useMasterImageGallery } from './MasterImageGallery';

const MAX_IMAGE_MB = 5;

interface FormValues {
  name: string;
  vehicleType: string;
  capacity: string;
  description: string;
  price: string;
  currency: string;
  status: 'ACTIVE' | 'INACTIVE';
  destinationIds: string[];
}

/** Maximum destinations assignable to one vehicle (mirrors the server cap). */
const MAX_DESTINATIONS_PER_VEHICLE = 10;

/**
 * Create/edit Vehicle — a single two-column card, matching the reference.
 *
 * Vehicle Type is free text with a datalist of values already in use, so the
 * reference's open-ended field keeps working while typos stay unlikely.
 */
export function VehicleFormPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const vehicle = useVehicle(vehicleId);
  const types = useVehicleTypes();
  const create = useCreateVehicle();
  const update = useUpdateVehicle(vehicleId ?? '');
  const { hasPermission } = useAuth();
  const canManageMedia = hasPermission(PERMISSIONS.MASTER_VEHICLES_MANAGE_MEDIA);

  const [formError, setFormError] = useState('');

  const form = useForm<FormValues>({
    defaultValues: { name: '', vehicleType: '', capacity: '', description: '', price: '', currency: 'INR', status: 'ACTIVE', destinationIds: [] },
  });
  const destinations = useDestinations(
    useMemo(() => new URLSearchParams({ status: 'ACTIVE', pageSize: '100' }), []),
  );
  const selectedDestinationIds = form.watch('destinationIds') ?? [];
  const [destinationError, setDestinationError] = useState('');

  const addDestination = (destinationId: string) => {
    if (!destinationId) return;
    const current = form.getValues('destinationIds') ?? [];
    if (current.includes(destinationId)) return;
    if (current.length >= MAX_DESTINATIONS_PER_VEHICLE) {
      setDestinationError(
        `A vehicle can be assigned to at most ${MAX_DESTINATIONS_PER_VEHICLE} destinations.`,
      );
      return;
    }
    setDestinationError('');
    form.setValue('destinationIds', [...current, destinationId], { shouldDirty: true });
  };

  const removeDestination = (destinationId: string) => {
    setDestinationError('');
    form.setValue(
      'destinationIds',
      (form.getValues('destinationIds') ?? []).filter((id) => id !== destinationId),
      { shouldDirty: true },
    );
  };
  const refreshImageQueries = useRefreshMasterImageQueries('vehicles');
  const imageGallery = useMasterImageGallery({
    masterId: vehicleId,
    entity: vehicle.data,
    allowedMimeTypes: VEHICLE_IMAGE_MIME_TYPES,
    maxSizeMb: MAX_IMAGE_MB,
    api: {
      approve: approveVehicleImage,
      confirm: confirmVehicleImage,
      download: vehicleImageUrl,
      remove: deleteVehicleImage,
      reorder: reorderVehicleImages,
    },
    onExistingChange: refreshImageQueries,
  });

  useEffect(() => {
    const value = vehicle.data;
    if (!value) return;
    form.reset({
      name: value.name,
      vehicleType: value.vehicleType,
      capacity: value.capacity != null ? String(value.capacity) : '',
      description: value.description ?? '',
      price: value.price != null ? String(value.price) : '',
      currency: value.currency ?? 'INR',
      status: value.status as FormValues['status'],
      destinationIds: (value.destinations ?? []).map((destination) => destination.id),
    });
  }, [vehicle.data, form]);

  if (vehicleId && vehicle.isError) return <Navigate to="/masters/vehicles" replace />;
  const mutation = vehicleId ? update : create;

  const submit = form.handleSubmit(async (values) => {
    setFormError('');
    if (values.destinationIds.length > MAX_DESTINATIONS_PER_VEHICLE) {
      setDestinationError(
        `A vehicle can be assigned to at most ${MAX_DESTINATIONS_PER_VEHICLE} destinations.`,
      );
      return;
    }
    const payload = {
      name: values.name.trim(),
      vehicleType: values.vehicleType.trim(),
      capacity: values.capacity === '' ? null : Number(values.capacity),
      description: values.description || null,
      price: values.price === '' ? null : Number(values.price),
      currency: values.currency || 'INR',
      status: values.status,
      destinationIds: values.destinationIds,
    };
    try {
      const saved = vehicleId
        ? await update.mutateAsync(payload)
        : await create.mutateAsync(payload);
      if (canManageMedia) await imageGallery.persist(saved.id);
      navigate(`/masters/vehicles/${saved.id}`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The vehicle could not be saved.');
    }
  });

  return (
    <div className="space-y-5">
      <MasterHeader
        title={vehicleId ? 'Edit Vehicle' : 'Create Vehicle'}
        description=""
        current="Vehicles"
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
          <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
            Vehicle Information
          </h2>
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Vehicle Name <span className="text-red-600">*</span>
                  <input
                    className={fieldClass}
                    placeholder="Enter vehicle name"
                    aria-invalid={Boolean(form.formState.errors.name)}
                    {...form.register('name', {
                      required: 'Vehicle name is required.',
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

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Vehicle Type <span className="text-red-600">*</span>
                  <input
                    className={fieldClass}
                    placeholder="Enter vehicle type"
                    list="vehicle-type-options"
                    aria-invalid={Boolean(form.formState.errors.vehicleType)}
                    {...form.register('vehicleType', { required: 'Vehicle type is required.' })}
                  />
                </label>
                <datalist id="vehicle-type-options">
                  {(types.data?.vehicleTypes ?? []).map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
                {form.formState.errors.vehicleType && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.vehicleType.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Capacity (persons)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className={fieldClass}
                    placeholder="Enter capacity"
                    aria-invalid={Boolean(form.formState.errors.capacity)}
                    {...form.register('capacity', {
                      validate: (value) => {
                        if (value === '') return true;
                        const parsed = Number(value);
                        if (!Number.isInteger(parsed)) return 'Capacity must be a whole number.';
                        if (parsed < 1) return 'Capacity must be at least 1.';
                        if (parsed > 1000) return 'Capacity looks too large.';
                        return true;
                      },
                    })}
                  />
                </label>
                {form.formState.errors.capacity && (
                  <p role="alert" className="mt-1 text-xs font-medium text-red-600">
                    {form.formState.errors.capacity.message}
                  </p>
                )}
              </div>

              <div className="block text-sm font-medium text-slate-700">
                <span>Price</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${fieldClass} mt-0 min-w-0 flex-1`}
                    placeholder="e.g. 7000"
                    aria-label="Vehicle price"
                    {...form.register('price')}
                  />
                  <CurrencySelect
                    value={form.watch('currency')}
                    onChange={(currency) => form.setValue('currency', currency)}
                    aria-label="Vehicle price currency"
                  />
                </div>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Status
                <select className={fieldClass} {...form.register('status')}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </label>

              <div>
                <span className="block text-sm font-medium text-slate-700">Destinations</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Assign up to {MAX_DESTINATIONS_PER_VEHICLE} destinations for automatic
                  quotation prefill.
                </span>
                {selectedDestinationIds.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {selectedDestinationIds.map((destinationId) => {
                      const match = (destinations.data?.data ?? []).find(
                        (destination) => destination.id === destinationId,
                      );
                      return (
                        <span
                          key={destinationId}
                          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                        >
                          {match?.name ?? 'Destination'}
                          <button
                            type="button"
                            aria-label={`Remove ${match?.name ?? 'destination'}`}
                            onClick={() => removeDestination(destinationId)}
                            className="rounded p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      );
                    })}
                  </span>
                )}
                <span className="mt-2 flex items-center gap-2">
                  <select
                    aria-label="Select destination"
                    className={fieldClass}
                    value=""
                    disabled={
                      selectedDestinationIds.length >= MAX_DESTINATIONS_PER_VEHICLE ||
                      destinations.isLoading
                    }
                    onChange={(event) => {
                      addDestination(event.target.value);
                      event.target.value = '';
                    }}
                  >
                    <option value="">+ Select Destination</option>
                    {(destinations.data?.data ?? [])
                      .filter((destination) => !selectedDestinationIds.includes(destination.id))
                      .map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                  </select>
                </span>
                <span className="mt-1 block text-xs text-slate-500" aria-live="polite">
                  {selectedDestinationIds.length} / {MAX_DESTINATIONS_PER_VEHICLE} destinations
                  selected
                </span>
                {destinationError && (
                  <span role="alert" className="mt-1 block text-xs font-medium text-red-600">
                    {destinationError}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {canManageMedia && (
                <MasterImageGalleryField
                  label="Vehicle Images"
                  controller={imageGallery}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  maxSizeMb={MAX_IMAGE_MB}
                />
              )}
              <label className="block text-sm font-medium text-slate-700">
                Description
                <textarea
                  rows={6}
                  className={fieldClass}
                  placeholder="Enter vehicle description"
                  {...form.register('description')}
                />
              </label>
            </div>
          </div>
        </section>

        <div className="sticky bottom-0 flex justify-end gap-2 bg-background/95 py-4 backdrop-blur">
          <Button variant="secondary" onClick={() => navigate('/masters/vehicles')}>
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button
            type="submit"
            isLoading={mutation.isPending || form.formState.isSubmitting || imageGallery.isBusy}
          >
            <Save className="h-4 w-4" /> {vehicleId ? 'Update Vehicle' : 'Create Vehicle'}
          </Button>
        </div>
      </form>
    </div>
  );
}
