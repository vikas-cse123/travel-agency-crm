import { useEffect, useRef, useState } from 'react';
import { PERMISSIONS } from '@interscale/shared';
import type { EmailSecurityMode } from '@interscale/shared';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/ui/FormField';
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
  'GMAIL_SMTP',
  'MICROSOFT_365_SMTP',
  'HOSTINGER_SMTP',
  'GODADDY_M365_SMTP',
  'GODADDY_WORKSPACE_SMTP',
  'ZOHO_SMTP',
  'AMAZON_SES_SMTP',
  'CLOUDFLARE_EMAIL',
  'OTHER_SMTP',
] as const;

const PROVIDER_LABELS: Record<string, string> = {
  CUSTOM_SMTP: 'Custom',
  GMAIL_SMTP: 'Google Workspace / Gmail',
  MICROSOFT_365_SMTP: 'Microsoft 365',
  HOSTINGER_SMTP: 'Hostinger',
  GODADDY_M365_SMTP: 'GoDaddy Microsoft 365',
  GODADDY_WORKSPACE_SMTP: 'GoDaddy Workspace Email',
  ZOHO_SMTP: 'Zoho Mail',
  AMAZON_SES_SMTP: 'Amazon SES',
  CLOUDFLARE_EMAIL: 'Cloudflare Email Routing',
  OTHER_SMTP: 'Other',
};

const DEFAULT_AWS_REGION = 'ap-south-1';
const AWS_SES_REGIONS: ReadonlyArray<readonly [string, string]> = [
  ['ap-south-1', 'ap-south-1 (Mumbai)'],
  ['us-east-1', 'us-east-1 (N. Virginia)'],
  ['us-west-2', 'us-west-2 (Oregon)'],
  ['eu-west-1', 'eu-west-1 (Ireland)'],
  ['eu-central-1', 'eu-central-1 (Frankfurt)'],
  ['eu-north-1', 'eu-north-1 (Stockholm)'],
  ['ap-southeast-1', 'ap-southeast-1 (Singapore)'],
  ['ap-southeast-2', 'ap-southeast-2 (Sydney)'],
  ['ap-northeast-1', 'ap-northeast-1 (Tokyo)'],
  ['ca-central-1', 'ca-central-1 (Canada)'],
  ['sa-east-1', 'sa-east-1 (São Paulo)'],
];

const DEFAULT_ZOHO_HOST = 'smtp.zoho.com';
const ZOHO_HOSTS: ReadonlyArray<readonly [string, string]> = [
  ['smtp.zoho.com', 'United States'],
  ['smtp.zoho.in', 'India'],
  ['smtp.zoho.eu', 'Europe'],
  ['smtp.zoho.com.au', 'Australia'],
  ['smtp.zoho.jp', 'Japan'],
];

const sesHostForRegion = (region: string) => `email-smtp.${region}.amazonaws.com`;
const sesRegionFromHost = (host: string | null | undefined): string | null => {
  const match = /^email-smtp\.([a-z0-9-]+)\.amazonaws\.com$/i.exec((host ?? '').trim());
  return match?.[1] ?? null;
};
const zohoHostFromSaved = (host: string | null | undefined): string | null => {
  const cleaned = (host ?? '').trim().toLowerCase();
  return ZOHO_HOSTS.some(([value]) => value === cleaned) ? cleaned : null;
};

/**
 * Company sending-account form (SMTP settings + test email + removal),
 * shared by the standalone Email Configuration page and the Email tab of
 * Company Settings. All data flows through the same company-scoped endpoints.
 */
export function EmailConfigurationForm() {
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
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [awsRegion, setAwsRegion] = useState<string>(DEFAULT_AWS_REGION);
  const [zohoHost, setZohoHost] = useState<string>(DEFAULT_ZOHO_HOST);
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
    setSmtpUsername(saved.smtpUsername);
    setSmtpPassword('');
    setFromName(saved.fromName);
    setFromEmail(saved.fromEmail);
    setReplyTo(saved.replyTo ?? '');
    // Restore region selections encoded in saved hosts instead of assuming.
    const savedSesRegion =
      saved.provider === 'AMAZON_SES_SMTP' ? sesRegionFromHost(saved.smtpHost) : null;
    if (savedSesRegion) setAwsRegion(savedSesRegion);
    const savedZohoHost =
      saved.provider === 'ZOHO_SMTP' ? zohoHostFromSaved(saved.smtpHost) : null;
    if (savedZohoHost) setZohoHost(savedZohoHost);
  }, [saved]);

  if (settings.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading email settings…</p>;
  }

  const applySmtpPreset = (host: string, port: number, securityMode: string) => {
    setSmtpHost(host);
    setSmtpPort(String(port));
    setSecurity(securityMode);
  };

  const applyProviderPreset = (value: string) => {
    setProvider(value);
    // Presets fill host/port/security only — the stored password is never
    // touched, filled, or cleared by switching providers.
    switch (value) {
      case 'GMAIL_SMTP':
        applySmtpPreset('smtp.gmail.com', 587, 'STARTTLS');
        break;
      case 'MICROSOFT_365_SMTP':
      case 'GODADDY_M365_SMTP':
        applySmtpPreset('smtp.office365.com', 587, 'STARTTLS');
        break;
      case 'HOSTINGER_SMTP':
        applySmtpPreset('smtp.hostinger.com', 587, 'STARTTLS');
        break;
      case 'GODADDY_WORKSPACE_SMTP':
        applySmtpPreset('smtpout.secureserver.net', 587, 'STARTTLS');
        break;
      case 'ZOHO_SMTP':
        applySmtpPreset(zohoHost || DEFAULT_ZOHO_HOST, 587, 'STARTTLS');
        break;
      case 'AMAZON_SES_SMTP':
        // The host follows the explicitly chosen region below; selecting the
        // provider alone changes nothing until a region is picked.
        break;
      case 'CLOUDFLARE_EMAIL':
        // Cloudflare Email Routing only forwards inbound mail — there is no
        // outbound SMTP host to invent, so existing values stay editable.
        break;
      default:
        break;
    }
  };

  const applyAwsRegion = (region: string) => {
    setAwsRegion(region);
    applySmtpPreset(sesHostForRegion(region), 587, 'STARTTLS');
  };

  const applyZohoHost = (host: string) => {
    setZohoHost(host);
    applySmtpPreset(host, 587, 'STARTTLS');
  };

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
          <FormField label="SMTP Host *">
            <input
              aria-label="SMTP host"
              className={inputClass}
              placeholder="smtp.example.com"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              disabled={!canManage}
            />
          </FormField>
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
          {provider === 'AMAZON_SES_SMTP' && (
            <FormField label="AWS region">
              <select
                aria-label="AWS region"
                className={inputClass}
                value={awsRegion}
                onChange={(event) => applyAwsRegion(event.target.value)}
                disabled={!canManage}
              >
                {AWS_SES_REGIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {provider === 'ZOHO_SMTP' && (
            <FormField label="Zoho region">
              <select
                aria-label="Zoho region"
                className={inputClass}
                value={ZOHO_HOSTS.some(([value]) => value === zohoHost) ? zohoHost : DEFAULT_ZOHO_HOST}
                onChange={(event) => applyZohoHost(event.target.value)}
                disabled={!canManage}
              >
                {ZOHO_HOSTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
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
          {provider === 'CLOUDFLARE_EMAIL' && (
            <p className="text-sm text-amber-700 md:col-span-2">
              Cloudflare Email Routing only forwards inbound mail to another mailbox — it provides
              no outbound SMTP server, so no host is filled in. Enter your sending SMTP details
              manually if you send through a different provider.
            </p>
          )}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            aria-label="Test email recipient"
            type="email"
            className={`${inputClass} min-w-0 flex-1`}
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
            className="shrink-0 whitespace-nowrap sm:min-w-[140px]"
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
