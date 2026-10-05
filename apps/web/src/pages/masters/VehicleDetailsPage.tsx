import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bus, Pencil, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useDeleteVehicle,
  useVehicle,
  vehicleImageUrl,
} from '@/features/masters/masters.api';
import { MasterImageGalleryView } from './MasterImageGallery';
import { Breadcrumbs, formatMasterDate, LoadingCard, StatusBadge } from './MasterUi';

function money(amount: number | null | undefined, currency: string): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

export function VehicleDetailsPage() {
  const { vehicleId = '' } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const vehicle = useVehicle(vehicleId);
  const remove = useDeleteVehicle();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.MASTER_VEHICLES_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.MASTER_VEHICLES_DELETE);

  if (vehicle.isPending) return <LoadingCard />;
  if (vehicle.isError)
    return (
      <div role="alert" className="rounded-xl border bg-card p-8 text-center text-red-700">
        This vehicle could not be loaded.
      </div>
    );

  const value = vehicle.data;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Vehicle Name', value: value.name },
    { label: 'Vehicle Type', value: value.vehicleType },
    { label: 'Capacity', value: value.capacity != null ? `${value.capacity} persons` : '—' },
    {
      label: 'Price',
      value: value.price != null ? money(value.price, value.currency ?? 'INR') : '—',
    },
    { label: 'Created At', value: formatMasterDate(value.createdAt) },
    { label: 'Created By', value: value.createdBy?.fullName ?? '—' },
    { label: 'Last Updated', value: formatMasterDate(value.updatedAt) },
    { label: 'Updated By', value: value.updatedBy?.fullName ?? '—' },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Breadcrumbs current="Vehicles" />
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{value.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={value.status} />
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/masters/vehicles">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to List
            </Button>
          </Link>
          {canUpdate && (
            <Link to={`/masters/vehicles/${vehicleId}/edit`}>
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
                    `Permanently delete vehicle ${value.name}? This action cannot be undone.`,
                  )
                ) {
                  remove.mutate(vehicleId, { onSuccess: () => navigate('/masters/vehicles') });
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
          Vehicle Information
        </h2>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="w-48 bg-slate-50 px-4 py-2.5 font-medium text-slate-700"
                  >
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 text-slate-800">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="min-h-48 overflow-hidden rounded-lg bg-slate-50">
            {value.hasImage ? (
              <MasterImageGalleryView
                masterId={value.id}
                entity={value}
                download={vehicleImageUrl}
                alt={value.name}
              />
            ) : (
              <div className="flex h-48 items-center justify-center border">
                <Bus className="h-10 w-10 text-slate-300" />
              </div>
            )}
          </div>
        </div>
        <div className="border-t p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">
            Destinations{' '}
            <span className="font-normal text-slate-500">
              {(value.destinations?.length ?? 0)} / 10
            </span>
          </h3>
          {(value.destinations?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {(value.destinations ?? []).map((destination) => (
                <span
                  key={destination.id}
                  className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                >
                  {destination.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No destinations assigned.</p>
          )}
        </div>
        <div className="border-t p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Description</h3>
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {value.description || 'No description added.'}
          </p>
        </div>
      </section>
    </div>
  );
}
