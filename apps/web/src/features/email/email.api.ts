import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailSendInput, EmailSettingsInput } from '@interscale/shared';
import { apiClient } from '@/api/client';

export type EmailProviderValue =
  'CUSTOM_SMTP' | 'GMAIL_SMTP' | 'MICROSOFT_365_SMTP' | 'AMAZON_SES_SMTP' | 'OTHER_SMTP';

export interface EmailConfiguration {
  id: string;
  provider: EmailProviderValue;
  smtpHost: string;
  smtpPort: number;
  security: 'NONE' | 'SSL_TLS' | 'STARTTLS';
  smtpUsername: string;
  passwordConfigured: boolean;
  passwordSetAt: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailLogRow {
  id: string;
  fromName: string | null;
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  errorMessage: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailLogPage {
  data: EmailLogRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

const keys = {
  settings: ['email-settings'] as const,
  list: (query: string) => ['emails', query] as const,
  detail: (id: string) => ['emails', 'detail', id] as const,
};

export function useEmailSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => apiClient.get<EmailConfiguration>('/email-settings', signal),
    retry: false,
  });
}

export function useSaveEmailSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailSettingsInput & { smtpPassword?: string }) =>
      apiClient.put<EmailConfiguration>('/email-settings', input),
    onSuccess: (saved) => {
      client.setQueryData(keys.settings, saved);
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (input: { to: string }) =>
      apiClient.post<{ sent: boolean }>('/email-settings/test', input),
  });
}

export function useEmails(params = new URLSearchParams()) {
  return useQuery({
    queryKey: keys.list(params.toString()),
    queryFn: ({ signal }) => apiClient.get<EmailLogPage>(`/emails?${params.toString()}`, signal),
  });
}

export function useEmail(id?: string) {
  return useQuery({
    queryKey: keys.detail(id ?? ''),
    queryFn: ({ signal }) => apiClient.get<EmailLogRow>(`/emails/${id}`, signal),
    enabled: Boolean(id),
  });
}

export function useSendEmail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: EmailSendInput) => apiClient.post<EmailLogRow>('/emails', input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['emails'] });
    },
  });
}
