import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  addOnServiceImageUrl,
  useAddOnService,
  useDeleteAddOnService,
} from '@/features/masters/masters.api';
import { Breadcrumbs, formatMasterDate, LoadingCard, SafeRichText, StatusBadge } from './MasterUi';
import { MasterImageGalleryView } from './MasterImageGallery';

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function AddOnServiceDetailsPage() {
  const { addOnServiceId = '' } = useParams<{ addOnServiceId: string }>();
  const navigate = useNavigate();
  const record = useAddOnService(addOnServiceId);
  const remove = useDeleteAddOnService();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.MASTER_ADD_ON_SERVICES_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.MASTER_ADD_ON_SERVICES_DELETE);

  if (record.isPending) return <LoadingCard />;
  if (record.isError)
    return (
      <div role="alert" className="rounded-xl border bg-card p-8 text-center text-red-700">
        This add-on service could not be loaded.
      </div>
    );

  const value = record.data;
  // Repeatable pricing wins; legacy single price/basis renders as one row.
  const pricingRows =
    value.pricing?.length > 0
      ? value.pricing
      : value.price != null || value.pricingBasis
        ? [
            {
              id: `legacy-${value.id}`,
              label: value.pricingBasis ?? '',
              price: value.price,
              currency: value.currency,
            },
          ]
        : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Breadcrumbs current="Add-On Services" />
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{value.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <StatusBadge value={value.status} />
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/masters/add-on-services">
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to List
            </Button>
          </Link>
          {canUpdate && (
            <Link to={`/masters/add-on-services/${addOnServiceId}/edit`}>
              <Button>
                <Pencil className="h-4 w-4" /> Edit Service
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
                    `Permanently delete add-on service ${value.name}? This action cannot be undone.`,
                  )
                ) {
                  remove.mutate(addOnServiceId, {
                    onSuccess: () => navigate('/masters/add-on-services'),
                  });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm">
        <h2 className="border-b bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">
          Service Information
        </h2>
        <div className="border-b p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Description</h3>
          <SafeRichText html={value.description} empty="No description added." />
        </div>
        {value.hasImage && (
          <div className="border-b p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Images</h3>
            <MasterImageGalleryView
              masterId={value.id}
              entity={value}
              download={addOnServiceImageUrl}
              alt={value.name}
            />
          </div>
        )}
        {(value.destinations ?? []).length > 0 && (
          <div className="border-b p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Destinations</h3>
            <ul className="flex flex-wrap gap-1.5">
              {value.destinations.map((link) => (
                <li
                  key={link.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                >
                  {link.name}
                  {link.isDefault && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
                      Default
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <table className="w-full text-left text-sm">
          <tbody className="divide-y">
            <tr>
              <th scope="row" className="w-52 bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Pricing
              </th>
              <td className="px-4 py-2.5 text-slate-800">
                {pricingRows.length > 0 ? (
                  <ul className="space-y-1">
                    {pricingRows.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-slate-900">
                          {entry.label || 'Standard'}
                        </span>
                        <span>
                          {entry.price != null
                            ? money(entry.price, entry.currency)
                            : '—'}
                        </span>
                        <span className="text-xs text-slate-500">{entry.currency}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  '—'
                )}
              </td>
            </tr>
            <tr>
              <th scope="row" className="bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Status
              </th>
              <td className="px-4 py-2.5">
                <StatusBadge value={value.status} />
              </td>
            </tr>
            <tr>
              <th scope="row" className="bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Created
              </th>
              <td className="px-4 py-2.5 text-slate-800">{formatMasterDate(value.createdAt)}</td>
            </tr>
            <tr>
              <th scope="row" className="bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Created By
              </th>
              <td className="px-4 py-2.5 text-slate-800">{value.createdBy?.fullName ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row" className="bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Last Updated
              </th>
              <td className="px-4 py-2.5 text-slate-800">{formatMasterDate(value.updatedAt)}</td>
            </tr>
            <tr>
              <th scope="row" className="bg-slate-50 px-4 py-2.5 font-medium text-slate-700">
                Updated By
              </th>
              <td className="px-4 py-2.5 text-slate-800">{value.updatedBy?.fullName ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
