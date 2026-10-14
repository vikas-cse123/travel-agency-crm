import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPinned, Pencil, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  sightseeingImageUrl,
  useDeleteSightseeing,
  useSightseeing,
} from '@/features/masters/masters.api';
import { MasterImageGalleryView } from './MasterImageGallery';
import { Breadcrumbs, formatMasterDate, LoadingCard, SafeRichText, StatusBadge } from './MasterUi';
import { formatTime12Hour } from '@/utils/dateTime';

function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

const MEAL_MODE_LABELS: Record<string, string> = {
  NO_TRANSFER: 'No Transfer',
  INCLUDE_AT_HOTEL: 'Include At Hotel',
  WITH_TRANSFER: 'With Transfer',
};

const TRANSFER_LABELS: Record<string, string> = {
  PRIVATE: 'Private Transfer',
  SHARED: 'Shared Transfer',
  NO_TRANSFER: 'No Transfer',
};

const capitalizeMeal = (meal: string) => meal.charAt(0).toUpperCase() + meal.slice(1);

export function SightseeingDetailsPage() {
  const { sightseeingId = '' } = useParams<{ sightseeingId: string }>();
  const navigate = useNavigate();
  const record = useSightseeing(sightseeingId);
  const remove = useDeleteSightseeing();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.MASTER_SIGHTSEEING_DELETE);

  if (record.isPending) return <LoadingCard />;
  if (record.isError)
    return (
      <div role="alert" className="rounded-xl border bg-card p-8 text-center text-red-700">
        This sightseeing could not be loaded.
      </div>
    );

  const value = record.data;
  const mealDefaults = (value.mealDefaults ?? null) as {
    meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean } | null;
    mealModes?: { breakfast?: string | null; lunch?: string | null; dinner?: string | null } | null;
    mealTransferDetails?: { breakfast?: string | null; lunch?: string | null; dinner?: string | null } | null;
    transfer?: string | null;
  } | null;
  const includedMeals = (['breakfast', 'lunch', 'dinner'] as const).filter(
    (meal) => mealDefaults?.meals?.[meal] === true,
  );
  const transferLabel =
    (mealDefaults?.transfer ? TRANSFER_LABELS[mealDefaults.transfer] : undefined) ??
    'Not configured';
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Destination', value: value.destination.name },
    { label: 'City', value: value.city.name },
    { label: 'Sequence', value: String(value.sequence) },
    {
      label: 'Estimated Hours',
      value: value.estimatedHours != null ? `${value.estimatedHours.toFixed(1)}h` : '—',
    },
    { label: 'Suggested Start Time', value: formatTime12Hour(value.suggestedStartTime) },
    { label: 'Created', value: formatMasterDate(value.createdAt) },
    { label: 'Created By', value: value.createdBy?.fullName ?? '—' },
    { label: 'Last Updated', value: formatMasterDate(value.updatedAt) },
    { label: 'Updated By', value: value.updatedBy?.fullName ?? '—' },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Breadcrumbs current="Sightseeing" />
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{value.title}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={value.status} />
            <span>
              {value.destination.name} · {value.city.name}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/masters/sightseeing">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to List
            </Button>
          </Link>
          {canUpdate && (
            <Link to={`/masters/sightseeing/${sightseeingId}/edit`}>
              <Button>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            </Link>
          )}
          {canDelete && (
            <Button
              variant="danger"
              isLoading={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently delete sightseeing ${value.title}? This action cannot be undone.`,
                  )
                ) {
                  remove.mutate(sightseeingId, { onSuccess: () => navigate('/masters/sightseeing') });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </header>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Sightseeing Information
        </h2>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="w-52 bg-slate-50 px-4 py-2 font-medium text-slate-700">
                    {row.label}
                  </th>
                  <td className="px-4 py-2 text-slate-800">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="min-h-48 overflow-hidden rounded-lg bg-slate-50">
            {value.hasImage ? (
              <MasterImageGalleryView
                masterId={value.id}
                entity={value}
                download={sightseeingImageUrl}
                alt={value.title}
              />
            ) : (
              <div className="flex h-48 items-center justify-center border">
                <MapPinned className="h-10 w-10 text-slate-300" />
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-4 border-t p-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Description</h3>
            <SafeRichText html={value.description} empty="No description added." />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Remarks</h3>
            <SafeRichText html={value.remarks} empty="No remarks added." />
          </div>
        </div>
        <div className="grid gap-4 border-t p-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Meals Included</h3>
            {includedMeals.length === 0 ? (
              <p className="text-sm text-slate-500">No meals included</p>
            ) : (
              <ul className="space-y-2">
                {includedMeals.map((meal) => {
                  const mode = mealDefaults?.mealModes?.[meal] ?? null;
                  const details = mealDefaults?.mealTransferDetails?.[meal]?.trim() || null;
                  return (
                    <li key={meal} className="text-sm">
                      <span className="font-medium text-slate-800">
                        {capitalizeMeal(meal)}
                        {mode && MEAL_MODE_LABELS[mode] ? ` — ${MEAL_MODE_LABELS[mode]}` : ''}
                      </span>
                      {mode === 'WITH_TRANSFER' && details ? (
                        <span className="mt-0.5 block text-slate-600">
                          {capitalizeMeal(meal)} Transfer Details: {details}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Transfer</h3>
            <p className="text-sm text-slate-800">{transferLabel}</p>
          </div>
        </div>
        {Array.isArray(value.pricing) && value.pricing.length > 0 && (
          <div className="border-t p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Pricing</h3>
            <ul className="divide-y">
              {value.pricing.map((row, index) => (
                <li key={index} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{row.label}</span>
                  <span className="font-medium text-slate-900">{money(row.price, row.currency ?? 'INR')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
