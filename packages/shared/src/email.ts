import { z } from 'zod';

/**
 * Standalone Email contracts — company-scoped sending configuration plus
 * manual compose/send/history. No CRM foreign keys: an email references only
 * its company. HTML body comes from the dependency-free RichTextEditor.
 */

export const EMAIL_PROVIDERS = [
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
export type EmailProviderValue = (typeof EMAIL_PROVIDERS)[number];

export const EMAIL_SECURITY_MODES = ['NONE', 'SSL_TLS', 'STARTTLS'] as const;
export type EmailSecurityMode = (typeof EMAIL_SECURITY_MODES)[number];

export const EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED'] as const;
export type EmailStatusValue = (typeof EMAIL_STATUSES)[number];

const emailList = (field: string) =>
  z
    .array(z.string().trim().email().max(255))
    .min(1, `At least one ${field} address is required.`)
    .max(50, `At most 50 ${field} addresses are allowed.`);

export const emailSettingsInputSchema = z.object({
  provider: z.enum(EMAIL_PROVIDERS).default('CUSTOM_SMTP'),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  security: z.enum(EMAIL_SECURITY_MODES).default('STARTTLS'),
  smtpUsername: z.string().trim().min(1).max(255),
  /** Omit or send '' to keep the currently stored password. */
  smtpPassword: z.string().max(1000).optional(),
  fromName: z.string().trim().min(1).max(160),
  fromEmail: z.string().trim().email().max(255),
  replyTo: z.string().trim().email().max(255).nullable().optional(),
});

export const emailSendInputSchema = z.object({
  to: emailList('To'),
  cc: z
    .array(z.string().trim().email().max(255))
    .max(50, 'At most 50 CC addresses are allowed.')
    .optional(),
  bcc: z
    .array(z.string().trim().email().max(255))
    .max(50, 'At most 50 BCC addresses are allowed.')
    .optional(),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().trim().min(1).max(500_000),
});

export const emailTestInputSchema = z.object({
  to: z.string().trim().email().max(255),
});

export type EmailSettingsInput = z.infer<typeof emailSettingsInputSchema>;
export type EmailSendInput = z.infer<typeof emailSendInputSchema>;
export type EmailTestInput = z.infer<typeof emailTestInputSchema>;
