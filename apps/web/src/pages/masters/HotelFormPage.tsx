import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  HOTEL_IMAGE_MIME_TYPES,
  HOTEL_MEAL_PLAN_TYPES,
  PERMISSIONS,
  type HotelInput,
  type HotelMealPlanType,
} from '@interscale/shared';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  approveHotelImage,
  confirmHotelImage,
  createMealPlan,
  createMealPlanMonthPrice,
  createMealPlanSeason,
  createRoomType,
  createRoomTypeMonthPrice,
  createRoomTypeSeason,
  deleteHotelImage,
  hotelImageUrl,
  reorderHotelImages,
  useRefreshMasterImageQueries,
  useCreateHotel,
  useDestination,
  useDestinations,
  useHotel,
  useHotels,
  useUpdateHotel,
} from '@/features/masters/masters.api';
import { fieldClass, MasterHeader } from './MasterUi';
import { HotelPlansEditor } from './HotelPlansEditor';
import { emptyPlanDraft, HotelPlanDraftPanel, type PlanDraft } from './HotelPlanDraftPanel';
import { MasterImageGalleryField, useMasterImageGallery } from './MasterImageGallery';

const LARGE = new URLSearchParams('pageSize=100&status=ACTIVE');

/** Maximum default hotels per destination (mirrors the server-side cap). */
const MAX_DEFAULT_HOTELS_PER_DESTINATION = 10;

const HOTEL_HEADER = 'bg-gradient-to-r from-brand-700 to-blue-600';
const ROOM_HEADER = 'bg-emerald-600';
const MEAL_HEADER = 'bg-teal-600';

interface FormValues {
  destinationId: string;
  cityId: string;
  name: string;
  starCategory: string;
  starRating: string;
  reviewLink: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  isDefaultForCity: boolean;
}

const empty: FormValues = {
  destinationId: '',
  cityId: '',
  name: '',
  starCategory: '',
  starRating: '',
  reviewLink: '',
  address: '',
  phone: '',
  email: '',
  currency: 'INR',
  isDefaultForCity: false,
};

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};
const textOrNull = (value: string): string | null => value.trim() || null;

function SectionCard({
  title,
  headerClass,
  children,
}: {
  title: string;
  headerClass: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className={`px-5 py-4 text-lg font-semibold text-white ${headerClass}`}>{title}</div>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function HotelFormPage() {
  const { hotelId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const hotel = useHotel(hotelId);
  const destinations = useDestinations(LARGE);
  const create = useCreateHotel();
  const update = useUpdateHotel(hotelId ?? '');
  const { hasPermission } = useAuth();
  const canManageMedia = hasPermission(PERMISSIONS.MASTER_HOTELS_MANAGE_MEDIA);
  const [formError, setFormError] = useState('');
  const [roomDrafts, setRoomDrafts] = useState<PlanDraft[]>([emptyPlanDraft()]);
  const [mealDrafts, setMealDrafts] = useState<PlanDraft[]>([emptyPlanDraft()]);
  const form = useForm<FormValues>({ defaultValues: empty });
  const destinationId = form.watch('destinationId');
  const destinationDetail = useDestination(destinationId || undefined);
  // Live count of default hotels for the selected destination (for the
  // "N / 10" display and the client-side cap guard; the server enforces it).
  const defaultCountParams = useMemo(() => {
    const params = new URLSearchParams({
      status: 'ACTIVE',
      pageSize: '1',
      isDefaultForCity: 'true',
    });
    if (destinationId) params.set('destinationId', destinationId);
    return params;
  }, [destinationId]);
  const defaultCountQuery = useHotels(defaultCountParams);
  const defaultCount = destinationId
    ? (defaultCountQuery.data?.pagination?.total ?? 0)
    : 0;
  const currentlyDefault = hotel.data?.isDefaultForCity ?? false;
  const defaultLimitReached = Boolean(destinationId) && !currentlyDefault && defaultCount >= MAX_DEFAULT_HOTELS_PER_DESTINATION;
  const refreshImageQueries = useRefreshMasterImageQueries('hotels');
  const imageGallery = useMasterImageGallery({
    masterId: hotelId,
    entity: hotel.data,
    allowedMimeTypes: HOTEL_IMAGE_MIME_TYPES,
    maxSizeMb: 10,
    api: {
      approve: approveHotelImage,
      confirm: confirmHotelImage,
      download: hotelImageUrl,
      remove: deleteHotelImage,
      reorder: reorderHotelImages,
    },
    onExistingChange: refreshImageQueries,
  });

  useEffect(() => {
    const destinationIdFromLink = searchParams.get('destinationId');
    if (!hotelId && destinationIdFromLink) form.setValue('destinationId', destinationIdFromLink);
  }, [form, hotelId, searchParams]);

  useEffect(() => {
    if (!hotel.data) return;
    const value = hotel.data;
    form.reset({
      destinationId: value.destinationId,
      cityId: value.cityId,
      name: value.name,
      starCategory: value.starCategory ? String(value.starCategory) : '',
      starRating: value.starRating != null ? String(value.starRating) : '',
      reviewLink: value.reviewLink ?? '',
      address: value.address ?? '',
      phone: value.phone ?? '',
      email: value.email ?? '',
      currency: value.currency ?? 'INR',
      isDefaultForCity: value.isDefaultForCity,
    });
  }, [hotel.data, form]);

  if (hotelId && hotel.isError) return <Navigate to="/masters/hotels" replace />;
  const mutation = hotelId ? update : create;

  const persistDrafts = async (id: string) => {
    const knownRoomIds = new Set<string>();
    for (const draft of roomDrafts) {
      if (!draft.name.trim()) continue;
      const saved = await createRoomType(id, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        status: 'ACTIVE',
        currency: draft.currency || 'INR',
        ...(draft.price.trim()
          ? { sellingPrice: numberOrNull(draft.price) }
          : {}),
        ...(draft.extraBedPrice.trim()
          ? { extraBedPrice: numberOrNull(draft.extraBedPrice) }
          : {}),
        ...(draft.childWithoutBedPrice.trim()
          ? { childWithoutBedPrice: numberOrNull(draft.childWithoutBedPrice) }
          : {}),
      });
      const created = saved.roomTypes.find((room) => !knownRoomIds.has(room.id));
      if (!created) continue;
      knownRoomIds.add(created.id);
      for (const month of draft.monthRates) {
        if (!month.month) continue;
        await createRoomTypeMonthPrice(id, created.id, {
          month: Number(month.month),
          price: month.price.trim() === '' ? null : Number(month.price),
          extraBedPrice: (month.extraBedPrice ?? '').trim() === '' ? null : Number(month.extraBedPrice),
          childWithoutBedPrice: (month.childWithoutBedPrice ?? '').trim() === '' ? null : Number(month.childWithoutBedPrice),
          currency: month.currency || 'INR',
        } as never);
      }
      for (const season of draft.seasonRates) {
        if (!season.name.trim() || !season.startDate || !season.endDate) continue;
        await createRoomTypeSeason(id, created.id, {
          name: season.name.trim(),
          startDate: new Date(`${season.startDate}T00:00:00.000Z`),
          endDate: new Date(`${season.endDate}T00:00:00.000Z`),
          price: season.price.trim() === '' ? null : Number(season.price),
          extraBedPrice: (season.extraBedPrice ?? '').trim() === '' ? null : Number(season.extraBedPrice),
          childWithoutBedPrice: (season.childWithoutBedPrice ?? '').trim() === '' ? null : Number(season.childWithoutBedPrice),
          currency: season.currency || 'INR',
        } as never);
      }
    }
    const knownMealIds = new Set<string>();
    for (const draft of mealDrafts) {
      if (!draft.name.trim()) continue;
      const saved = await createMealPlan(id, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        type: 'CUSTOM' as HotelMealPlanType,
        status: 'ACTIVE',
        currency: draft.currency || 'INR',
        ...(draft.price.trim()
          ? { sellingPrice: numberOrNull(draft.price) }
          : {}),
      });
      const created = saved.mealPlans.find((plan) => !knownMealIds.has(plan.id));
      if (!created) continue;
      knownMealIds.add(created.id);
      for (const month of draft.monthRates) {
        if (!month.month) continue;
        await createMealPlanMonthPrice(id, created.id, {
          month: Number(month.month),
          price: month.price.trim() === '' ? null : Number(month.price),
          currency: month.currency || 'INR',
        });
      }
      for (const season of draft.seasonRates) {
        if (!season.name.trim() || !season.startDate || !season.endDate) continue;
        await createMealPlanSeason(id, created.id, {
          name: season.name.trim(),
          startDate: new Date(`${season.startDate}T00:00:00.000Z`),
          endDate: new Date(`${season.endDate}T00:00:00.000Z`),
          price: season.price.trim() === '' ? null : Number(season.price),
          currency: season.currency || 'INR',
        });
      }
    }
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError('');
    imageGallery.clearError();
    if (!values.destinationId) {
      form.setError('destinationId', { message: 'Select a destination.' });
      return;
    }
    if (!values.cityId) {
      form.setError('cityId', { message: 'Select a city.' });
      return;
    }
    if (values.name.trim().length < 2) {
      form.setError('name', { message: 'Enter a hotel name.' });
      return;
    }
    const starRating = numberOrNull(values.starRating);
    if (starRating != null && (starRating < 0 || starRating > 5)) {
      form.setError('starRating', { message: 'Enter a rating from 0 to 5.' });
      return;
    }
    const email = values.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      form.setError('email', { message: 'Enter a valid email address.' });
      return;
    }
    if (values.isDefaultForCity && defaultLimitReached) {
      form.setError('isDefaultForCity', {
        message: `This destination already has ${MAX_DEFAULT_HOTELS_PER_DESTINATION} default hotels. Unmark an existing default hotel first.`,
      });
      setFormError(
        `This destination already has ${MAX_DEFAULT_HOTELS_PER_DESTINATION} default hotels. Unmark an existing default hotel first.`,
      );
      return;
    }
    const base = {
      destinationId: values.destinationId,
      cityId: values.cityId,
      name: values.name.trim(),
      starCategory: numberOrNull(values.starCategory),
      starRating,
      reviewLink: textOrNull(values.reviewLink),
      address: textOrNull(values.address),
      phone: textOrNull(values.phone),
      email: textOrNull(values.email),
      // description/amenities intentionally omitted: the backend keeps existing
      // stored values when keys are absent, so edits never overwrite them.
      currency: values.currency || 'INR',
      isDefaultForCity: values.isDefaultForCity,
    };
    try {
      const saved = hotelId
        ? await update.mutateAsync(base)
        : await create.mutateAsync({ ...base, status: 'ACTIVE' } as HotelInput);
      if (!hotelId) await persistDrafts(saved.id);
      if (canManageMedia) await imageGallery.persist(saved.id);
      navigate(`/masters/hotels/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        Object.entries(error.fields).forEach(([field, messages]) => {
          if (field in empty) {
            form.setError(field as keyof FormValues, {
              message: messages[0] ?? 'Please check this field.',
            });
          }
        });
        setFormError(
          Object.values(error.fields)
            .map((messages) => messages[0] ?? 'Please check this field.')
            .join(' '),
        );
        return;
      }
      if (error instanceof Error && !(error as { code?: string }).code) setFormError(error.message);
    }
  });

  const errors = form.formState.errors;

  return (
    <div className="space-y-5">
      <MasterHeader
        title={hotelId ? 'Edit Hotel' : 'Create Hotel'}
        current={hotelId ? 'Edit Hotel' : 'Create Hotel'}
      />
      <form onSubmit={submit} className="space-y-5">
        {(mutation.error || formError) && (
          <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {formError || mutation.error?.message}
          </div>
        )}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <SectionCard title="Hotel Information" headerClass={HOTEL_HEADER}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <Field label="Destination *" error={errors.destinationId?.message}>
                  <select
                    className={fieldClass}
                    {...form.register('destinationId', {
                      onChange: () => form.setValue('cityId', ''),
                    })}
                  >
                    <option value="">Select destination</option>
                    {destinations.data?.data.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="City *" error={errors.cityId?.message}>
                  <select
                    className={fieldClass}
                    {...form.register('cityId')}
                    disabled={!destinationId}
                  >
                    <option value="">
                      {destinationId ? 'Select city' : 'Select a destination first'}
                    </option>
                    {destinationDetail.data?.cities.map((link) => (
                      <option key={link.cityId} value={link.cityId}>
                        {link.city.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hotel Name *" error={errors.name?.message}>
                  <input
                    className={fieldClass}
                    placeholder="Enter hotel name"
                    {...form.register('name')}
                  />
                </Field>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      {...form.register('isDefaultForCity')}
                    />
                    <span>
                      <span className="font-medium">Default hotel for this destination</span>
                      <span className="block text-xs text-slate-500">
                        Up to {MAX_DEFAULT_HOTELS_PER_DESTINATION} default hotels per destination.
                        Defaults prefill automatically in new quotations.
                      </span>
                    </span>
                  </label>
                  {destinationId ? (
                    <p className="mt-2 text-xs text-slate-500" aria-live="polite">
                      Default hotels: {defaultCountQuery.isLoading ? '…' : defaultCount} /{' '}
                      {MAX_DEFAULT_HOTELS_PER_DESTINATION}
                      {currentlyDefault ? ' (including this hotel)' : ''}
                    </p>
                  ) : null}
                  {errors.isDefaultForCity?.message ? (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {errors.isDefaultForCity.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Star Category">
                    <select className={fieldClass} {...form.register('starCategory')}>
                      <option value="">Not rated</option>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <option key={star} value={star}>
                          {star} Star
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Star Rating (0–5)" error={errors.starRating?.message}>
                    <input
                      className={fieldClass}
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      placeholder="e.g. 4.3"
                      {...form.register('starRating')}
                    />
                  </Field>
                </div>
                <Field label="Review Link">
                  <input
                    className={fieldClass}
                    placeholder="e.g. TripAdvisor link"
                    {...form.register('reviewLink')}
                  />
                </Field>
              </div>

              <div className="space-y-4">
                {canManageMedia && (
                  <MasterImageGalleryField
                    label="Hotel Images"
                    controller={imageGallery}
                    accept="image/jpeg,image/png,image/webp"
                    maxSizeMb={10}
                  />
                )}
                <Field label="Address">
                  <textarea
                    className={fieldClass}
                    rows={3}
                    placeholder="Enter hotel address"
                    {...form.register('address')}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Phone" error={errors.phone?.message}>
                    <input
                      className={fieldClass}
                      placeholder="e.g. +91 14100 00000"
                      {...form.register('phone')}
                    />
                  </Field>
                  <Field label="Email" error={errors.email?.message}>
                    <input
                      className={fieldClass}
                      placeholder="e.g. stay@example.com"
                      {...form.register('email')}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </SectionCard>

          <div className="space-y-5">
            {hotelId && hotel.data ? (
              <>
                <HotelPlansEditor kind="room" hotel={hotel.data} headerClass={ROOM_HEADER} />
                <HotelPlansEditor
                  kind="meal"
                  hotel={hotel.data}
                  mealTypes={HOTEL_MEAL_PLAN_TYPES}
                  headerClass={MEAL_HEADER}
                />
              </>
            ) : (
              <>
                <HotelPlanDraftPanel
                  kind="room"
                  headerClass={ROOM_HEADER}
                  drafts={roomDrafts}
                  onChange={setRoomDrafts}
                />
                <HotelPlanDraftPanel
                  kind="meal"
                  headerClass={MEAL_HEADER}
                  drafts={mealDrafts}
                  onChange={setMealDrafts}
                />
              </>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
          <Link to={hotelId ? `/masters/hotels/${hotelId}` : '/masters/hotels'}>
            <Button variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" isLoading={mutation.isPending || imageGallery.isBusy}>
            {hotelId ? 'Update Hotel' : 'Create Hotel'}
          </Button>
        </div>
      </form>
    </div>
  );
}
