import nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';
import { PERMISSIONS, type EmailSendInput, type EmailSettingsInput } from '@interscale/shared';
import { prisma } from '../../config/prisma.js';
import type { AuthContext } from '../../middleware/authenticate.js';
import { env } from '../../config/env.js';
import { permissionsService } from '../auth/permissions.service.js';
import { decryptSensitiveValue, encryptSensitiveValue } from '../../utils/crypto.js';
import {
  buildPaginationMeta,
  resolvePagination,
  toPrismaPagination,
} from '../../utils/pagination.js';
import {
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../utils/errors.js';

export type EmailRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

const hasPermission = (auth: AuthContext, permission: string) =>
  permissionsService.userHasPermission(auth.userId, permission);

export interface SmtpSendOptions {
  host: string;
  port: number;
  security: 'NONE' | 'SSL_TLS' | 'STARTTLS';
  username: string;
  password: string;
  from: string;
  replyTo?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
}

export type SmtpTransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
}) => { sendMail: (message: Record<string, unknown>) => Promise<unknown> };

let transportFactory: SmtpTransportFactory = (options) => nodemailer.createTransport(options);

/** Test seam: swap the nodemailer transport factory (unit tests only). */
export function __setSmtpTransportFactory(factory: SmtpTransportFactory | null) {
  transportFactory = factory ?? ((options) => nodemailer.createTransport(options));
}

function encryptionKey(): string {
  if (!env.DATA_ENCRYPTION_KEY)
    throw new ServiceUnavailableError(
      'Email sending is not configured on this server. Ask an administrator to set a data encryption key.',
    );
  return env.DATA_ENCRYPTION_KEY;
}

/**
 * Convert a raw SMTP failure into a safe, human-readable message. Never
 * includes credentials or tokens — only the host (the user's own setting)
 * and the failure class.
 */
export function sanitizeSmtpError(error: unknown, host: string, secrets: string[]): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const code = (
    (error as { code?: unknown } | null)?.code ??
    (error as { responseCode?: unknown } | null)?.responseCode ??
    ''
  ).toString();
  let message: string;
  if (/EAUTH|Invalid login|Authentication unsuccessful|535|534/i.test(`${code} ${raw}`)) {
    message = 'Authentication failed. Check the SMTP username and password.';
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(`${code} ${raw}`)) {
    message = `The SMTP host "${host}" could not be reached. Check the host name.`;
  } else if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|timed out/i.test(`${code} ${raw}`)) {
    message = `The connection to "${host}" timed out. Check the host, port and security setting.`;
  } else if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS/i.test(`${code} ${raw}`)) {
    message = 'The secure connection failed. Check the security setting and port.';
  } else if (/ECONNREFUSED/i.test(`${code} ${raw}`)) {
    message = `The connection to "${host}" was refused. Check the host and port.`;
  } else if (/550|553|551|552|mailbox|recipient|sender/i.test(`${code} ${raw}`)) {
    message = 'The SMTP server rejected the message. Check the sender and recipient addresses.';
  } else {
    message = 'Email could not be sent. The SMTP server reported an error.';
  }
  let safe = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}

export async function sendViaSmtp(options: SmtpSendOptions): Promise<void> {
  const transport = transportFactory({
    host: options.host,
    port: options.port,
    secure: options.security === 'SSL_TLS',
    ...(options.security === 'STARTTLS' ? { requireTLS: true } : {}),
    auth: { user: options.username, pass: options.password },
    connectionTimeout: 10_000,
  });
  await transport.sendMail({
    from: options.from,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    to: options.to,
    ...(options.cc?.length ? { cc: options.cc } : {}),
    ...(options.bcc?.length ? { bcc: options.bcc } : {}),
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}

function normalizeRecipients(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
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

function presentSettings(row: Record<string, unknown>) {
  const {
    smtpPasswordEncrypted: _password,
    passwordKeyVersion: _version,
    companyId: _companyId,
    ...safe
  } = row as Record<string, unknown>;
  void _password;
  void _version;
  void _companyId;
  return { ...safe, passwordConfigured: true };
}

function presentLog(row: Record<string, unknown>) {
  const { companyId: _companyId, ...safe } = row;
  void _companyId;
  return safe;
}

async function loadConfiguration(auth: AuthContext) {
  return prisma.companyEmailConfiguration.findUnique({
    where: { companyId: auth.companyId },
  });
}

async function requireConfiguration(auth: AuthContext) {
  const row = await loadConfiguration(auth);
  if (!row)
    throw new ValidationError('No email sending account is configured for this company yet.');
  return row;
}

function decryptPassword(row: { smtpPasswordEncrypted: string }): string {
  try {
    return decryptSensitiveValue(row.smtpPasswordEncrypted, encryptionKey());
  } catch {
    throw new ServiceUnavailableError(
      'The stored email credentials cannot be read on this server.',
    );
  }
}

export const emailService = {
  async settings(auth: AuthContext) {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_MANAGE_SETTINGS)))
      throw new ForbiddenError();
    const row = await loadConfiguration(auth);
    if (!row) throw new NotFoundError('No email configuration exists for this company yet.');
    return presentSettings(row);
  },

  async saveSettings(auth: AuthContext, input: EmailSettingsInput, context: EmailRequestContext) {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_MANAGE_SETTINGS)))
      throw new ForbiddenError();
    const existing = await loadConfiguration(auth);
    const password = input.smtpPassword?.trim() ?? '';
    if (!password && !existing)
      throw new ValidationError('An SMTP password is required for a new configuration.');
    const key = encryptionKey();
    const base = {
      companyId: auth.companyId,
      provider: input.provider,
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      security: input.security,
      smtpUsername: input.smtpUsername.trim(),
      fromName: input.fromName.trim(),
      fromEmail: input.fromEmail.trim().toLowerCase(),
      replyTo: input.replyTo?.trim().toLowerCase() || null,
      updatedById: auth.userId,
    };
    const secrets = password
      ? {
          smtpPasswordEncrypted: encryptSensitiveValue(
            password,
            key,
            env.DATA_ENCRYPTION_KEY_VERSION,
          ),
          passwordKeyVersion: env.DATA_ENCRYPTION_KEY_VERSION,
          passwordSetAt: new Date(),
        }
      : null;
    const saved = await prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.companyEmailConfiguration.update({
            where: { companyId: auth.companyId },
            data: { ...base, ...(secrets ?? {}) },
          })
        : await tx.companyEmailConfiguration.create({
            data: {
              ...base,
              // Guaranteed present: missing password without an existing row
              // throws above.
              ...(secrets as {
                smtpPasswordEncrypted: string;
                passwordKeyVersion: string;
                passwordSetAt: Date;
              }),
              createdById: auth.userId,
            },
          });
      await tx.activityLog.create({
        data: {
          companyId: auth.companyId,
          actorUserId: auth.userId,
          action: 'EMAIL_SETTINGS_UPDATED',
          entityType: 'CompanyEmailConfiguration',
          entityId: row.id,
          metadata: { provider: row.provider, smtpHost: row.smtpHost },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return row;
    });
    return presentSettings(saved);
  },

  async sendTest(auth: AuthContext, to: string): Promise<{ sent: boolean }> {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_MANAGE_SETTINGS)))
      throw new ForbiddenError();
    const config = await requireConfiguration(auth);
    const password = decryptPassword(config);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { name: true },
    });
    try {
      await sendViaSmtp({
        host: config.smtpHost,
        port: config.smtpPort,
        security: config.security,
        username: config.smtpUsername,
        password,
        from: `"${config.fromName}" <${config.fromEmail}>`,
        replyTo: config.replyTo,
        to: [to.trim().toLowerCase()],
        subject: `Test email from ${company.name}`,
        text: `This is a test email from ${company.name} (${config.fromEmail}). Your sending account works.`,
        html: `<p>This is a test email from ${company.name} (${config.fromEmail}). Your sending account works.</p>`,
      });
      return { sent: true };
    } catch (error) {
      throw new ServiceUnavailableError(
        sanitizeSmtpError(error, config.smtpHost, [password, config.smtpUsername]),
      );
    }
  },

  async send(auth: AuthContext, input: EmailSendInput, context: EmailRequestContext) {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_SEND))) throw new ForbiddenError();
    const config = await requireConfiguration(auth);
    const password = decryptPassword(config);
    const to = normalizeRecipients(input.to);
    const cc = normalizeRecipients(input.cc ?? []);
    const bcc = normalizeRecipients(input.bcc ?? []);
    if (to.length === 0) throw new ValidationError('At least one To address is required.');
    const bodyText = stripHtml(input.bodyHtml);
    if (!bodyText) throw new ValidationError('The message body is required.');
    const log = await prisma.emailLog.create({
      data: {
        companyId: auth.companyId,
        fromName: config.fromName,
        fromEmail: config.fromEmail,
        to,
        cc,
        bcc,
        subject: input.subject.trim(),
        bodyHtml: input.bodyHtml,
        bodyText,
        status: 'SENDING',
        createdById: auth.userId,
      },
    });
    try {
      await sendViaSmtp({
        host: config.smtpHost,
        port: config.smtpPort,
        security: config.security,
        username: config.smtpUsername,
        password,
        from: `"${config.fromName}" <${config.fromEmail}>`,
        replyTo: config.replyTo,
        to,
        cc,
        bcc,
        subject: input.subject.trim(),
        text: bodyText,
        html: input.bodyHtml,
      });
    } catch (error) {
      const message = sanitizeSmtpError(error, config.smtpHost, [password, config.smtpUsername]);
      await prisma.$transaction(async (tx) => {
        const row = await tx.emailLog.update({
          where: { id: log.id },
          data: { status: 'FAILED', errorMessage: message },
        });
        await tx.activityLog.create({
          data: {
            companyId: auth.companyId,
            actorUserId: auth.userId,
            action: 'EMAIL_SEND_FAILED',
            entityType: 'EmailLog',
            entityId: log.id,
            metadata: { to, subject: input.subject.trim() },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
        });
        return row;
      });
      throw new ServiceUnavailableError(message);
    }
    const sent = await prisma.$transaction(async (tx) => {
      const row = await tx.emailLog.update({
        where: { id: log.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
      await tx.activityLog.create({
        data: {
          companyId: auth.companyId,
          actorUserId: auth.userId,
          action: 'EMAIL_SENT',
          entityType: 'EmailLog',
          entityId: log.id,
          metadata: { to, subject: input.subject.trim() },
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
      return row;
    });
    return presentLog(sent);
  },

  async list(auth: AuthContext, query: Record<string, unknown>) {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_VIEW))) throw new ForbiddenError();
    const page = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const where: Prisma.EmailLogWhereInput = {
      companyId: auth.companyId,
      ...(typeof query.status === 'string'
        ? { status: query.status as Prisma.EnumEmailStatusFilter }
        : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: 'insensitive' } },
              { fromEmail: { contains: search, mode: 'insensitive' } },
              { to: { has: search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        ...toPrismaPagination(page),
      }),
      prisma.emailLog.count({ where }),
    ]);
    return {
      data: rows.map((row) => {
        const { bodyHtml: _html, bodyText: _text, ...rest } = presentLog(row);
        void _html;
        void _text;
        return rest;
      }),
      pagination: buildPaginationMeta(page, total),
    };
  },

  async details(auth: AuthContext, id: string) {
    if (!(await hasPermission(auth, PERMISSIONS.EMAILS_VIEW))) throw new ForbiddenError();
    const row = await prisma.emailLog.findFirst({
      where: { id, companyId: auth.companyId },
    });
    if (!row) throw new NotFoundError('Email not found.');
    return presentLog(row);
  },
};

export { crypto };
