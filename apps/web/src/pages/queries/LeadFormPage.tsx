import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { QueryInput } from '@interscale/shared';
import { LeadForm, type DuplicateLeadLocationState } from '@/features/queries/LeadForm';
import { useLead, useSaveLead } from '@/features/queries/queries.api';
import { ApiError } from '@/api/client';

export function LeadFormPage() {
  const { queryId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lead = useLead(queryId);
  const save = useSaveLead(queryId);
  // Duplicate Lead draft carried via navigation state (never URL params, so
  // no personal data leaks into shareable links). Only honored on the Create
  // route; the Edit route always uses its own record. Memoized so the form's
  // reset-on-lead-change effect cannot loop on re-renders.
  const duplicateDraft = useMemo(() => {
    if (queryId) return null;
    const state = (location.state ?? null) as DuplicateLeadLocationState | null;
    const draft = state?.duplicateLead ?? null;
    return draft && typeof draft === 'object' ? draft : null;
  }, [queryId, location.state]);
  if (queryId && lead.isLoading) return <div className="h-96 animate-pulse rounded-xl bg-card" />;
  if (queryId && lead.isError)
    return (
      <div className="rounded-xl bg-card p-10 text-center">
        <h1 className="text-xl font-semibold">Lead unavailable</h1>
        <p className="mt-2 text-slate-500">
          It may not exist or may be outside your visibility scope.
        </p>
      </div>
    );
  const submit = (value: QueryInput) =>
    save.mutate(value, { onSuccess: (result) => navigate(`/queries/${result.id}`) });
  const error =
    save.error instanceof ApiError
      ? save.error.message
      : save.isError
        ? 'The lead could not be saved.'
        : undefined;
  const errorFields = save.error instanceof ApiError ? save.error.fields : undefined;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to={queryId ? `/queries/${queryId}` : '/queries'}
          className="rounded-lg p-2 hover:bg-card"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          {queryId && (
            <p className="text-sm text-slate-500">Leads / {lead.data?.queryNumber}</p>
          )}
          <h1 className="text-2xl font-semibold">{queryId ? 'Edit lead' : 'Create lead'}</h1>
        </div>
      </div>
      <LeadForm
        {...(lead.data ? { lead: lead.data } : {})}
        {...(duplicateDraft ? { lead: duplicateDraft } : {})}
        onSave={submit}
        saving={save.isPending}
        {...(error ? { error } : {})}
        {...(errorFields ? { errorFields } : {})}
      />
    </div>
  );
}
