import { FilePlus2, Search } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { useAuth } from '@/features/auth/AuthProvider';
import { useQuotations } from '@/features/quotations/quotations.api';
import { QuotationRowActions } from './QuotationRowActions';

const field = 'h-10 rounded-lg border border-slate-300 bg-card px-3 text-sm';
export function QuotationsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation() as { state?: { successMessage?: string } };
  const successMessage = location.state?.successMessage;
  const list = useQuotations(params);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };
  /** Page changes keep the active filters, so they bypass `update`'s reset. */
  const setPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };
  return (
    <div className="space-y-5">
      {successMessage && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {successMessage}
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customer quotations</h1>
        </div>
        {hasPermission(PERMISSIONS.QUOTATIONS_CREATE) && (
          <Link to="/quotations/new">
            <Button>
              <FilePlus2 className="h-4 w-4" />
              New quotation
            </Button>
          </Link>
        )}
      </header>
      <section className="rounded-xl border bg-card shadow-sm">
        <div className="grid gap-3 border-b p-4 md:grid-cols-2">
          <label className="relative md:col-span-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              aria-label="Search quotations"
              className={`${field} w-full pl-9`}
              placeholder="Quotation, lead, customer, phone or destination…"
              value={params.get('search') ?? ''}
              onChange={(event) => update('search', event.target.value)}
            />
          </label>
          <input
            aria-label="Quotation destination"
            className={field}
            placeholder="Destination"
            value={params.get('destination') ?? ''}
            onChange={(event) => update('destination', event.target.value)}
          />
        </div>
        {list.isLoading ? (
          <div className="h-72 animate-pulse bg-slate-50" />
        ) : list.isError ? (
          <div className="p-12 text-center text-red-700">Quotations could not be loaded.</div>
        ) : !list.data?.data.length ? (
          <div className="p-12 text-center">
            <h2 className="font-semibold">No quotations found</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create one from a lead or adjust your filters.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-[#0dbb7a] text-xs uppercase text-white">
                  <tr>
                    {['Quotation', 'Lead', 'Destination', 'Created by', 'Actions'].map((value) => (
                      <th key={value} className="border-r border-white/30 px-4 py-3 last:border-r-0">
                        {value}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.data.data.map((quotation) => {
                    return (
                      <tr key={quotation.id} className="hover:bg-slate-50">
                        <td className="border-r border-slate-200 px-4 py-4 last:border-r-0">
                          <Link
                            className="font-semibold text-brand-700"
                            to={`/quotations/${quotation.id}`}
                          >
                            {quotation.quotationNumber}
                          </Link>
                        </td>
                        <td className="border-r border-slate-200 px-4 py-4 last:border-r-0">
                          <Link className="text-brand-700" to={`/queries/${quotation.query.id}`}>
                            {quotation.query.queryNumber}
                          </Link>
                          <p>{quotation.customerName}</p>
                        </td>
                        <td className="border-r border-slate-200 px-4 py-4 last:border-r-0">{quotation.destinationSummary}</td>
                        <td className="border-r border-slate-200 px-4 py-4 last:border-r-0">{quotation.createdBy.fullName}</td>
                        <td className="border-r border-slate-200 px-4 py-4 last:border-r-0">
                          <QuotationRowActions quotation={quotation} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {list.data.data.map((quotation) => {
                const version = quotation.versions[0];
                return (
                  <li key={quotation.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        className="font-semibold text-brand-700"
                        to={`/quotations/${quotation.id}`}
                      >
                        {quotation.quotationNumber}
                      </Link>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {quotation.customerName}
                    </p>
                    <p className="text-xs text-slate-500">{quotation.destinationSummary}</p>
                    <p className="mt-1 text-sm">v{version?.versionNumber ?? '—'}</p>
                    <Link
                      className="mt-2 inline-block text-sm font-medium text-brand-700"
                      to={`/quotations/${quotation.id}`}
                    >
                      Open quotation →
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={list.data.pagination.page}
              pageSize={list.data.pagination.pageSize}
              totalPages={list.data.pagination.totalPages}
              total={list.data.pagination.total}
              onPage={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
