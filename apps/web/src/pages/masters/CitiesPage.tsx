import { Eye, EyeOff, MapPin, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { ExcelImportDialog } from '@/features/masters/excel-import/ExcelImportDialog';
import {
  useDeleteCity,
  useCities,
  useHideGlobalMaster,
  useMasterLookups,
} from '@/features/masters/masters.api';
import {
  formatMasterDate,
  GlobalBadge,
  HIDE_GLOBAL_CONFIRM,
  MasterHeader,
  Pagination,
} from './MasterUi';

export function CitiesPage() {
  const [params, setParams] = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);
  const cities = useCities(params);
  const lookups = useMasterLookups();
  const remove = useDeleteCity();
  const hideMaster = useHideGlobalMaster();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.MASTER_CITIES_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.MASTER_CITIES_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.MASTER_CITIES_DELETE);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };
  const deleteCity = (id: string, name: string) => {
    if (window.confirm(`Permanently delete city ${name}? This action cannot be undone.`))
      remove.mutate(id);
  };
  const hideCity = (id: string) => {
    if (window.confirm(HIDE_GLOBAL_CONFIRM))
      hideMaster.mutate({ masterType: 'CITY', masterId: id });
  };
  return (
    <div className="space-y-5">
      <MasterHeader
        title="City Master"
        description=""
        current="Cities"
        action={
          canCreate ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import Excel
              </Button>
              <Link to="/masters/cities/new">
                <Button>
                  <Plus className="h-4 w-4" />
                  Add New City
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      />
      <ExcelImportDialog open={importOpen} onClose={() => setImportOpen(false)} initialMasterType="CITY" onSuccess={() => cities.refetch()} />
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="grid gap-3 border-b p-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <label className="relative">
            <span className="sr-only">Search cities</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              aria-label="Search cities"
              placeholder="Search city or country…"
              className="w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm"
              value={params.get('search') ?? ''}
              onChange={(e) => update('search', e.target.value)}
            />
          </label>
          <select
            aria-label="City country"
            className="rounded-lg border px-3 py-2.5 text-sm"
            value={params.get('country') ?? ''}
            onChange={(e) => update('country', e.target.value)}
          >
            <option value="">All countries</option>
            {lookups.data?.countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>
        {cities.isPending ? (
          <div className="h-72 animate-pulse bg-slate-100" />
        ) : cities.isError ? (
          <div role="alert" className="p-8 text-center text-red-700">
            Cities could not be loaded.
          </div>
        ) : !cities.data?.data.length ? (
          <div className="p-12 text-center">
            <MapPin className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-3 font-semibold">No cities found</h2>
            <p className="text-sm text-slate-500">Adjust the filters or add the first city.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {['Country', 'City name', 'Created', 'Actions'].map((h) => (
                      <th key={h} className="px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {cities.data.data.map((city) => (
                    <tr key={city.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{city.countryName}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {city.name}
                        {city.isGlobal && <GlobalBadge />}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatMasterDate(city.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Link
                            aria-label={`View ${city.name}`}
                            to={`/masters/cities/${city.id}`}
                            className="rounded bg-cyan-600 p-2 text-white"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          {canUpdate && !city.isGlobal && (
                            <Link
                              aria-label={`Edit ${city.name}`}
                              to={`/masters/cities/${city.id}/edit`}
                              className="rounded bg-brand-600 p-2 text-white"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                          )}
                          {city.canHide && (
                            <button
                              aria-label={`Hide ${city.name} for this company`}
                              title="Hide this global record for your company"
                              onClick={() => hideCity(city.id)}
                              className="rounded bg-amber-600 p-2 text-white"
                            >
                              <EyeOff className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && !city.isGlobal && (
                            <button
                              aria-label={`Delete ${city.name}`}
                              title="Permanently delete"
                              onClick={() => deleteCity(city.id, city.name)}
                              className="rounded bg-red-600 p-2 text-white"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden">
              {cities.data.data.map((city) => (
                <article key={city.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="font-semibold">
                        {city.name}
                        {city.isGlobal && <GlobalBadge />}
                      </h2>
                      <p className="text-sm text-slate-500">{city.countryName}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/masters/cities/${city.id}`}>
                      <Button variant="secondary">View</Button>
                    </Link>
                    {canUpdate && !city.isGlobal && (
                      <Link to={`/masters/cities/${city.id}/edit`}>
                        <Button variant="secondary">Edit</Button>
                      </Link>
                    )}
                    {city.canHide && (
                      <Button
                        variant="secondary"
                        onClick={() => hideCity(city.id)}
                        title="Hide for this company"
                      >
                        Hide
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <Pagination
              page={cities.data.pagination.page}
              pageSize={cities.data.pagination.pageSize}
              totalPages={cities.data.pagination.totalPages}
              total={cities.data.pagination.total}
              onPage={(page) => update('page', String(page))}
            />
          </>
        )}
      </section>
    </div>
  );
}
