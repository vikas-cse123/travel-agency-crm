import { Fragment, useCallback, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PERMISSIONS, labelForLookup } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField } from '@/components/ui/FormField';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/api/client';
import { formatDateTime12Hour } from '@/utils/dateTime';
import { useEmail, useEmails, useSendEmail, type EmailLogRow } from '@/features/email/email.api';
import {
  EmailPurposeSelector,
  HotelEmailFlow,
  type EmailPurpose,
  type HotelEmailDraft,
} from './HotelBookingEmail';
import { ItineraryEmailFlow } from './ItineraryBookingEmail';

const inputClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground';

const EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED'] as const;

function parseAddresses(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(br|p|div|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function EmailsPage() {
  const { hasPermission } = useAuth();
  const canSend = hasPermission(PERMISSIONS.EMAILS_SEND);
  const [params, setParams] = useSearchParams();
  const history = useEmails(params);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  };

  const rows = history.data?.data ?? [];
  const pagination = history.data?.pagination;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email"
        description="Compose standalone emails and review what was sent."
        actions={
          <Link to="/settings/email">
            <Button variant="secondary">Email Settings</Button>
          </Link>
        }
      />

      {canSend && <Composer />}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold">History</h2>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <input
            aria-label="Search emails"
            className={inputClass}
            placeholder="Search recipient or subject…"
            value={params.get('search') ?? ''}
            onChange={(event) => update('search', event.target.value)}
          />
          <select
            aria-label="Filter by email status"
            className={inputClass}
            value={params.get('status') ?? ''}
            onChange={(event) => update('status', event.target.value)}
          >
            <option value="">All statuses</option>
            {EMAIL_STATUSES.map((status) => (
              <option key={status} value={status}>
                {labelForLookup(status)}
              </option>
            ))}
          </select>
        </div>

        {history.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading emails…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No emails yet"
            description="Sent emails will appear here with their delivery status."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">To</th>
                  <th className="px-2 py-2 font-medium">Subject</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="w-20 px-2 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-border align-top">
                      <td className="px-2 py-2">{formatDateTime12Hour(row.createdAt)}</td>
                      <td className="px-2 py-2">{row.to.join(', ')}</td>
                      <td className="px-2 py-2 font-medium">{row.subject}</td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            row.status === 'FAILED'
                              ? 'font-medium text-red-700'
                              : row.status === 'SENT'
                                ? 'font-medium text-emerald-700'
                                : ''
                          }
                        >
                          {labelForLookup(row.status)}
                        </span>
                      </td>
                      <td className="px-2 py-2">{row.fromEmail}</td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} email details`}
                          onClick={() =>
                            setExpandedId((current) => (current === row.id ? null : row.id))
                          }
                        >
                          {expandedId === row.id ? 'Hide' : 'View'}
                        </Button>
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr className="border-t border-border bg-muted/30">
                        <td colSpan={6} className="px-2 py-4">
                          <EmailDetails id={row.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-4">
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPage={(page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function EmailDetails({ id }: { id: string }) {
  const details = useEmail(id);
  if (details.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading email…</p>;
  }
  const row: EmailLogRow | undefined = details.data;
  if (!row) return null;
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div>
        <dt className="text-xs uppercase text-muted-foreground">To</dt>
        <dd className="mt-1 text-sm font-medium">{row.to.join(', ')}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">From</dt>
        <dd className="mt-1 text-sm font-medium">
          {row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}
        </dd>
      </div>
      {row.cc.length > 0 && (
        <div>
          <dt className="text-xs uppercase text-muted-foreground">CC</dt>
          <dd className="mt-1 text-sm font-medium">{row.cc.join(', ')}</dd>
        </div>
      )}
      {row.bcc.length > 0 && (
        <div>
          <dt className="text-xs uppercase text-muted-foreground">BCC</dt>
          <dd className="mt-1 text-sm font-medium">{row.bcc.join(', ')}</dd>
        </div>
      )}
      <div className="sm:col-span-2">
        <dt className="text-xs uppercase text-muted-foreground">Subject</dt>
        <dd className="mt-1 text-sm font-medium">{row.subject}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-xs uppercase text-muted-foreground">Message</dt>
        <dd
          className="prose prose-sm mt-1 max-w-none text-sm"
          dangerouslySetInnerHTML={{ __html: row.bodyHtml ?? '' }}
        />
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Status</dt>
        <dd className="mt-1 text-sm font-medium">{labelForLookup(row.status)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted-foreground">Sent Date</dt>
        <dd className="mt-1 text-sm font-medium">
          {row.sentAt ? formatDateTime12Hour(row.sentAt) : '—'}
        </dd>
      </div>
      {row.errorMessage && (
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase text-muted-foreground">Error</dt>
          <dd className="mt-1 text-sm text-red-700">{row.errorMessage}</dd>
        </div>
      )}
    </dl>
  );
}

function Composer() {
  const send = useSendEmail();
  const [purpose, setPurpose] = useState<EmailPurpose>('hotel');
  // Remounting the hotel flow (via flowKey) resets its quotation/hotel
  // selection, e.g. after a successful send or Cancel.
  const [flowKey, setFlowKey] = useState(0);
  const [toState, setToState] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subjectState, setSubjectState] = useState('');
  const [bodyState, setBodyState] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  // Tracked setters mirror the current values into refs so the generated
  // draft can tell user edits apart from its own last write.
  const toRef = useRef('');
  const subjectRef = useRef('');
  const bodyRef = useRef('');
  const setTo = (value: string) => {
    toRef.current = value;
    setToState(value);
  };
  const setSubject = (value: string) => {
    subjectRef.current = value;
    setSubjectState(value);
  };
  const setBodyHtml = (value: string) => {
    bodyRef.current = value;
    setBodyState(value);
  };
  const to = toState;
  const subject = subjectState;
  const bodyHtml = bodyState;

  /** Last generated draft; null means the composer holds no generated content. */
  const appliedRef = useRef<HotelEmailDraft | null>(null);

  /** Fill the composer, preserving any field the user edited since generation. */
  const applyGenerated = useCallback((draft: HotelEmailDraft) => {
    if (toRef.current === (appliedRef.current?.to ?? '')) setTo(draft.to);
    if (subjectRef.current === (appliedRef.current?.subject ?? '')) setSubject(draft.subject);
    if (bodyRef.current === (appliedRef.current?.bodyHtml ?? '')) setBodyHtml(draft.bodyHtml);
    appliedRef.current = draft;
  }, []);

  /** Revert generated content back to blank, never touching user edits. */
  const clearGenerated = useCallback(() => {
    if (toRef.current === (appliedRef.current?.to ?? '')) setTo('');
    if (subjectRef.current === (appliedRef.current?.subject ?? '')) setSubject('');
    if (bodyRef.current === (appliedRef.current?.bodyHtml ?? '')) setBodyHtml('');
    appliedRef.current = null;
  }, []);

  const toList = parseAddresses(to);
  const plainBody = stripHtml(bodyHtml);
  const canSubmit =
    toList.length > 0 && subject.trim().length > 0 && plainBody.length > 0 && !send.isPending;

  const submit = () => {
    if (!canSubmit) return;
    setFeedback(null);
    send.mutate(
      {
        to: toList,
        cc: parseAddresses(cc),
        bcc: parseAddresses(bcc),
        subject: subject.trim(),
        bodyHtml,
      },
      {
        onSuccess: (row) => {
          setTo('');
          setCc('');
          setBcc('');
          setSubject('');
          setBodyHtml('');
          appliedRef.current = null;
          setFlowKey((key) => key + 1);
          setFeedback({ ok: true, message: `Email sent to ${row.to.join(', ')}.` });
        },
        onError: (failure) => {
          const message =
            failure instanceof ApiError
              ? failure.message
              : failure instanceof Error
                ? failure.message
                : String(failure);
          setFeedback({ ok: false, message });
        },
      },
    );
  };

  const clear = () => {
    setTo('');
    setCc('');
    setBcc('');
    setSubject('');
    setBodyHtml('');
    setFeedback(null);
    appliedRef.current = null;
    setFlowKey((key) => key + 1);
  };

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Compose email">
      <h2 className="mb-4 text-base font-semibold">Compose Email</h2>
      <div className="mb-4">
        <EmailPurposeSelector value={purpose} onChange={setPurpose} />
      </div>
      {purpose === 'hotel' && (
        <div className="mb-4">
          <HotelEmailFlow
            key={`hotel-${flowKey}`}
            onGenerate={applyGenerated}
            onClear={clearGenerated}
          />
        </div>
      )}
      {purpose === 'itinerary' && (
        <div className="mb-4">
          <ItineraryEmailFlow
            key={`itinerary-${flowKey}`}
            onGenerate={applyGenerated}
            onClear={clearGenerated}
          />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <FormField label="To *">
            <input
              aria-label="Email recipients"
              className={inputClass}
              placeholder="hotel@example.com, manager@example.com"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label="CC">
          <input
            aria-label="Email CC"
            className={inputClass}
            placeholder="cc@example.com"
            value={cc}
            onChange={(event) => setCc(event.target.value)}
          />
        </FormField>
        <FormField label="BCC">
          <input
            aria-label="Email BCC"
            className={inputClass}
            placeholder="bcc@example.com"
            value={bcc}
            onChange={(event) => setBcc(event.target.value)}
          />
        </FormField>
        <div className="md:col-span-2">
          <FormField label="Subject *">
            <input
              aria-label="Email subject"
              className={inputClass}
              placeholder="Hotel Booking Confirmation"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </FormField>
        </div>
        <div className="md:col-span-2">
          <span className="mb-1 block text-sm font-medium">Message *</span>
          <RichTextEditor
            ariaLabel="Email message"
            placeholder="Write your message…"
            value={bodyHtml}
            onChange={setBodyHtml}
          />
        </div>
      </div>
      {feedback && (
        <p
          role={feedback.ok ? 'status' : 'alert'}
          className={`mt-3 rounded-lg p-3 text-sm ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={clear}>
          Cancel
        </Button>
        <Button isLoading={send.isPending} disabled={!canSubmit} onClick={submit}>
          Send Email
        </Button>
      </div>
    </section>
  );
}
