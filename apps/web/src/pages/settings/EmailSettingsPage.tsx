import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PERMISSIONS } from '@interscale/shared';
import type { EmailSecurityMode } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApiError } from '@/api/client';
import {
  useEmailSettings,
  useRemoveEmailSettings,
  useSaveEmailSettings,
  useSendTestEmail,
} from '@/features/email/email.api';

const inputClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground';

const PROVIDERS = [
  'CUSTOM_SMTP',
  'HOSTINGER_SMTP',
  'GODADDY_M365_SMTP',
  'GODADDY_WORKSPACE_SMTP',
  'GMAIL_SMTP',
  'MICROSOFT_365_SMTP',
  'ZOHO_SMTP',
  'AMAZON_SES_SMTP',
  'CLOUDFLARE_EMAIL',
  'OTHER_SMTP',
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  CUSTOM_SMTP: 'Custom SMTP',
  HOSTINGER_SMTP: 'Hostinger',
  GODADDY_M365_SMTP: 'GoDaddy Microsoft 365',
  GODADDY_WORKSPACE_SMTP: 'GoDaddy Workspace Email',
  GMAIL_SMTP: 'Google Workspace / Gmail',
  MICROSOFT_365_SMTP: 'Microsoft 365',
  ZOHO_SMTP: 'Zoho Mail',
  AMAZON_SES_SMTP: 'Amazon SES',
  CLOUDFLARE_EMAIL: 'Cloudflare Email Routing',
  OTHER_SMTP: 'Other',
};

const PROVIDER_HINTS: Record<string, { host: string; port: number; security: string; note?: string }> = {
  HOSTINGER_SMTP: {
    host: 'smtp.hostinger.com',
    port: 587,
    security: 'STARTTLS',
    note: 'Port 465 with SSL/TLS also works for Hostinger.',
  },
  GODADDY_M365_SMTP: { host: 'smtp.office365.com', port: 587, security: 'STARTTLS' },
  GODADDY_WORKSPACE_SMTP: {
    host: 'smtpout.secureserver.net',
    port: 465,
    security: 'SSL_TLS',
    note: 'Workspace/cPanel mailboxes only. Port 587 with STARTTLS also works. Microsoft 365 mailboxes from GoDaddy use the GoDaddy Microsoft 365 option instead.',
  },
  GMAIL_SMTP: {
    host: 'smtp.gmail.com',
    port: 587,
    security: 'STARTTLS',
    note: 'Gmail requires an App Password, not the account password.',
  },
  MICROSOFT_365_SMTP: { host: 'smtp.office365.com', port: 587, security: 'STARTTLS' },
};

/** Common Amazon SES SMTP regions. The endpoint always embeds the region —
 * there is no single universal SES host. */
const AWS_SES_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ca-central-1',
  'sa-east-1',
] as const;
const DEFAULT_SES_REGION = 'ap-south-1';
const sesHostFor = (region: string) => `email-smtp.${region}.amazonaws.com`;
function parseSesRegion(host: string): string | null {
  const match = /^email-smtp\.([a-z0-9-]+)\.amazonaws\.com$/i.exec(host.trim());
  const region = match?.[1]?.toLowerCase() ?? null;
  return region && (AWS_SES_REGIONS as readonly string[]).includes(region) ? region : null;
}

/** Zoho Mail uses a different SMTP host per account region. */
const ZOHO_REGION_HOSTS = [
  { label: 'United States — smtp.zoho.com', host: 'smtp.zoho.com' },
  { label: 'Europe — smtp.zoho.eu', host: 'smtp.zoho.eu' },
  { label: 'India — smtp.zoho.in', host: 'smtp.zoho.in' },
  { label: 'Australia — smtp.zoho.com.au', host: 'smtp.zoho.com.au' },
  { label: 'Japan — smtp.zoho.jp', host: 'smtp.zoho.jp' },
  { label: 'China — smtp.zoho.com.cn', host: 'smtp.zoho.com.cn' },
] as const;
const DEFAULT_ZOHO_HOST = 'smtp.zoho.com';
function parseZohoHost(host: string): string | null {
  const found = ZOHO_REGION_HOSTS.find((row) => row.host === host.trim().toLowerCase());
  return found ? found.host : null;
}

export function EmailSettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission(PERMISSIONS.EMAILS_MANAGE_SETTINGS);
  const settings = useEmailSettings();
  const save = useSaveEmailSettings();
  const testEmail = useSendTestEmail();
  const remove = useRemoveEmailSettings();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeFeedback, setRemoveFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [provider, setProvider] = useState<string>('CUSTOM_SMTP');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [security, setSecurity] = useState<string>('STARTTLS');
  const [awsRegion, setAwsRegion] = useState<string>(DEFAULT_SES_REGION);
  const [zohoHost, setZohoHost] = useState<string>(DEFAULT_ZOHO_HOST);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [formError, setFormError] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testFeedback, setTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const saved = settings.data;
  // Fill once per saved version so background refetches never clobber typing.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!saved || filledFor.current === saved.updatedAt) return;
    filledFor.current = saved.updatedAt;
    setProvider(saved.provider);
    setSmtpHost(saved.smtpHost);
    setSmtpPort(String(saved.smtpPort));
    setSecurity(saved.security);
    // Region selectors reflect the saved host without rewriting it: an
    // unrecognized host keeps the field value untouched.
    if (saved.provider === 'AMAZON_SES_SMTP') {
      setAwsRegion(parseSesRegion(saved.smtpHost) ?? DEFAULT_SES_REGION);
    }
    if (saved.provider === 'ZOHO_SMTP') {
      setZohoHost(parseZohoHost(saved.smtpHost) ?? DEFAULT_ZOHO_HOST);
    }
    setSmtpUsername(saved.smtpUsername);
    setSmtpPassword('');
    setFromName(saved.fromName);
    setFromEmail(saved.fromEmail);
    setReplyTo(saved.replyTo ?? '');
  }, [saved]);

  if (settings.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading email settings…</p>;
  }

  const applyProviderPreset = (value: string) => {
    setProvider(value);
    // Cloudflare Email Routing forwards inbound mail and provides no
    // outbound SMTP mailbox: explain instead of inventing a host, and leave
    // the host/port/security the user already entered untouched.
    if (value === 'CLOUDFLARE_EMAIL') return;
    if (value === 'AMAZON_SES_SMTP') {
      applySesRegion(awsRegion);
      return;
    }
    if (value === 'ZOHO_SMTP') {
      applyZohoHost(zohoHost);
      return;
    }
    const preset = PROVIDER_HINTS[value];
    if (preset) {
      setSmtpHost(preset.host);
      setSmtpPort(String(preset.port));
      setSecurity(preset.security);
    }
  };

  const applySesRegion = (region: string) => {
    setAwsRegion(region);
    setSmtpHost(sesHostFor(region));
    setSmtpPort('587');
    setSecurity('STARTTLS');
  };

  const applyZohoHost = (host: string) => {
    setZohoHost(host);
    setSmtpHost(host);
    setSmtpPort('587');
    setSecurity('STARTTLS');
  };

  const providerNote = PROVIDER_HINTS[provider]?.note ?? null;

  const submit = () => {
    setFormError('');
    save.mutate(
      {
        provider: provider as (typeof PROVIDERS)[number],
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort),
        security: security as EmailSecurityMode,
        smtpUsername: smtpUsername.trim(),
        ...(smtpPassword ? { smtpPassword } : {}),
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        replyTo: replyTo.trim() || null,
      },
      {
        onSuccess: () => {
          setSmtpPassword('');
          filledFor.current = null;
        },
        onError: (failure) =>
          setFormError(failure instanceof Error ? failure.message : String(failure)),
      },
    );
  };

  const sendTest = () => {
    setTestFeedback(null);
    testEmail.mutate(
      { to: testTo.trim() },
      {
        onSuccess: () => setTestFeedback({ ok: true, message: 'Test email sent successfully.' }),
        onError: (failure) => {
          const message =
            failure instanceof ApiError
              ? failure.message
              : failure instanceof Error
                ? failure.message
                : String(failure);
          setTestFeedback({ ok: false, message });
        },
      },
    );
  };

  const resetForm = () => {
    setProvider('CUSTOM_SMTP');
    setSmtpHost('');
    setSmtpPort('587');
    setSecurity('STARTTLS');
    setAwsRegion(DEFAULT_SES_REGION);
    setZohoHost(DEFAULT_ZOHO_HOST);
    setSmtpUsername('');
    setSmtpPassword('');
    setFromName('');
    setFromEmail('');
    setReplyTo('');
    filledFor.current = null;
  };

  const confirmRemove = () => {
    setRemoveFeedback(null);
    remove.mutate(undefined, {
      onSuccess: () => {
        setConfirmingRemove(false);
        resetForm();
        setTestFeedback(null);
        setRemoveFeedback({ ok: true, message: 'Email configuration removed.' });
      },
      onError: (failure) =>
        setRemoveFeedback({
          ok: false,
          message: failure instanceof Error ? failure.message : String(failure),
        }),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email Configuration"
        description="Company sending account used by standalone email. Credentials are encrypted and never shown back."
        actions={
          <Link to="/emails">
            <Button variant="secondary">Open Email</Button>
          </Link>
        }
      />

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Provider">
            <select
              aria-label="Email provider"
              className={inputClass}
              value={provider}
              onChange={(event) => applyProviderPreset(event.target.value)}
              disabled={!canManage}
            >
              {PROVIDERS.map((option) => (
                <option key={option} value={option}>
                  {PROVIDER_LABELS[option] ?? option}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Security">
            <select
              aria-label="SMTP security"
              className={inputClass}
              value={security}
              onChange={(event) => setSecurity(event.target.value)}
              disabled={!canManage}
            >
              <option value="NONE">None</option>
              <option value="STARTTLS">TLS (STARTTLS)</option>
              <option value="SSL_TLS">SSL (port 465)</option>
            </select>
          </FormField>
          <FormField label="SMTP Host *" hint={providerNote ?? undefined}>
            <input
              aria-label="SMTP host"
              className={inputClass}
              placeholder="smtp.example.com"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          {provider === 'AMAZON_SES_SMTP' && (
            <FormField
              label="AWS Region"
              hint="The SES SMTP endpoint always embeds the region — pick the one your SES identity is verified in."
            >
              <select
                aria-label="AWS region"
                className={inputClass}
                value={awsRegion}
                onChange={(event) => applySesRegion(event.target.value)}
                disabled={!canManage}
              >
                {AWS_SES_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region} — {sesHostFor(region)}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {provider === 'ZOHO_SMTP' && (
            <FormField
              label="Zoho Account Region"
              hint="Zoho Mail uses a different SMTP host per account region — pick yours."
            >
              <select
                aria-label="Zoho region"
                className={inputClass}
                value={zohoHost}
                onChange={(event) => applyZohoHost(event.target.value)}
                disabled={!canManage}
              >
                {ZOHO_REGION_HOSTS.map((row) => (
                  <option key={row.host} value={row.host}>
                    {row.label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {provider === 'CLOUDFLARE_EMAIL' && (
            <div
              role="note"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 md:col-span-2"
            >
              Cloudflare Email Routing only forwards inbound mail to another mailbox — it does
              not provide an outbound SMTP mailbox. Use the host, port, and credentials of the
              provider that actually sends your mail (for example Gmail, Microsoft 365, or
              Amazon SES), and keep this selection only as a label.
            </div>
          )}
          <FormField label="SMTP Port *">
            <input
              aria-label="SMTP port"
              type="number"
              min={1}
              max={65535}
              className={inputClass}
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <FormField label="Username *">
            <input
              aria-label="SMTP username"
              className={inputClass}
              autoComplete="username"
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <FormField label={saved?.passwordConfigured ? 'Password (Configured ✓)' : 'Password *'}>
            <input
              aria-label="SMTP password"
              type="password"
              className={inputClass}
              autoComplete="new-password"
              placeholder={
                saved?.passwordConfigured ? '•••••••• (leave blank to keep)' : '••••••••'
              }
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <FormField label="From Name *">
            <input
              aria-label="From name"
              className={inputClass}
              placeholder="ABC Travels"
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <FormField label="From Email *">
            <input
              aria-label="From email"
              type="email"
              className={inputClass}
              placeholder="bookings@example.com"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Reply-To">
              <input
                aria-label="Reply to"
                type="email"
                className={inputClass}
                placeholder="bookings@example.com"
                value={replyTo}
                onChange={(event) => setReplyTo(event.target.value)}
                disabled={!canManage}
              />
            </FormField>
          </div>
        </div>
        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {formError}
          </p>
        )}
        {canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button isLoading={save.isPending} onClick={submit}>
              Save Configuration
            </Button>
            {saved && !confirmingRemove && (
              <Button variant="danger" onClick={() => setConfirmingRemove(true)}>
                Remove Configuration
              </Button>
            )}
          </div>
        )}
        {removeFeedback && (
          <p
            role={removeFeedback.ok ? 'status' : 'alert'}
            className={`mt-3 rounded-lg p-3 text-sm ${
              removeFeedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {removeFeedback.message}
          </p>
        )}
        {canManage && saved && confirmingRemove && (
          <div
            role="alertdialog"
            aria-label="Remove email configuration"
            className="mt-4 rounded-lg border border-red-200 bg-red-50/60 p-4"
          >
            <p className="text-sm text-slate-700">
              Remove the configured sending email account? The CRM will no longer be able to send
              emails using these settings.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </Button>
              <Button variant="danger" isLoading={remove.isPending} onClick={confirmRemove}>
                Remove Configuration
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold">Test Email</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Sends a test message through the saved configuration.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            aria-label="Test email recipient"
            type="email"
            className={inputClass}
            placeholder="email@example.com"
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
            disabled={!canManage}
          />
          <Button
            variant="secondary"
            isLoading={testEmail.isPending}
            disabled={!canManage || !testTo.trim() || !saved}
            onClick={sendTest}
          >
            Send Test Email
          </Button>
        </div>
        {testFeedback && (
          <p
            role={testFeedback.ok ? 'status' : 'alert'}
            className={`mt-3 rounded-lg p-3 text-sm ${
              testFeedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {testFeedback.message}
          </p>
        )}
      </section>
    </div>
  );
}
