import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { hashPassword } from '../src/utils/crypto.js';

let app: Express;
let db: PrismaClient;
beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
});

async function owner(email = 'owner@emailcfg.test', companyName = 'EmailCfg Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

/** A client whose custom role holds exactly the given permission keys. */
async function scopedClient(ownerEmail: string, keys: string[], email: string) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { normalizedEmail: ownerEmail } });
  const role = await db.role.create({
    data: {
      companyId: ownerUser.companyId,
      name: `Role ${email.split('@')[0]}`,
      description: 'Test role',
      hierarchyLevel: 10,
      isSystem: false,
    },
  });
  for (const key of keys) {
    const permission = await db.permission.findUniqueOrThrow({ where: { key } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: email.split('@')[0]!,
      fullName: 'Scoped User',
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Scoped@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  expect(
    (await client.post('/api/auth/login', { email, password: 'Scoped@2026', rememberMe: false }))
      .status,
  ).toBe(200);
  return client;
}

const settingsPayload = (overrides: Record<string, unknown> = {}) => ({
  provider: 'CUSTOM_SMTP',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  security: 'STARTTLS',
  smtpUsername: 'bookings@example.com',
  smtpPassword: 's3cret-password',
  fromName: 'EmailCfg Travel',
  fromEmail: 'contact@emailcfg.test',
  replyTo: null,
  ...overrides,
});

describe('Email sending status', () => {
  it('reports disconnected for a company with no configuration', async () => {
    const client = await owner();
    const res = await client.get('/api/email-settings/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ connected: false, fromName: null, fromEmail: null });
  });

  it('reports the connected From identity without any secrets', async () => {
    const client = await owner();
    const saved = await client.put('/api/email-settings', settingsPayload());
    expect(saved.status).toBe(200);
    const res = await client.get('/api/email-settings/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      connected: true,
      fromName: 'EmailCfg Travel',
      fromEmail: 'contact@emailcfg.test',
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('s3cret-password');
    expect(raw).not.toContain('smtpPasswordEncrypted');
    expect(raw).not.toContain('passwordKeyVersion');
    expect(res.body.data).not.toHaveProperty('smtpPassword');
    expect(res.body.data).not.toHaveProperty('smtpPasswordEncrypted');
    expect(res.body.data).not.toHaveProperty('smtpUsername');
    expect(res.body.data).not.toHaveProperty('smtpHost');
  });

  it('is tenant-isolated: another company still reads disconnected', async () => {
    const alpha = await owner('owner@alpha-mail.test', 'Alpha Mail');
    await alpha.put('/api/email-settings', settingsPayload());
    const beta = await owner('owner@beta-mail.test', 'Beta Mail');
    const res = await beta.get('/api/email-settings/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ connected: false, fromName: null, fromEmail: null });
  });

  it('is visible with emails.view but forbidden without it', async () => {
    const ownerEmail = 'owner@scoped-mail.test';
    await owner(ownerEmail, 'Scoped Mail');
    const viewer = await scopedClient(ownerEmail, ['emails.view'], 'viewer@scoped-mail.test');
    expect((await viewer.get('/api/email-settings/status')).status).toBe(200);
    const sender = await scopedClient(ownerEmail, ['emails.send'], 'sender@scoped-mail.test');
    expect((await sender.get('/api/email-settings/status')).status).toBe(403);
  });
});

describe('Email provider options', () => {
  const providers = [
    'HOSTINGER_SMTP',
    'GODADDY_M365_SMTP',
    'GODADDY_WORKSPACE_SMTP',
    'ZOHO_SMTP',
    'CLOUDFLARE_EMAIL',
  ];
  for (const provider of providers) {
    it(`accepts and persists provider ${provider}`, async () => {
      const client = await owner();
      const res = await client.put(
        '/api/email-settings',
        settingsPayload({ provider, smtpHost: 'smtp.example.com' }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.provider).toBe(provider);
      const status = await client.get('/api/email-settings/status');
      expect(status.body.data.connected).toBe(true);
    });
  }

  it('rejects an unknown provider value', async () => {
    const client = await owner();
    const res = await client.put('/api/email-settings', settingsPayload({ provider: 'NOPE' }));
    expect(res.status).toBe(400);
  });

  it('keeps the stored password when an update omits it', async () => {
    const ownerEmail = 'owner@emailcfg.test';
    const client = await owner(ownerEmail, 'EmailCfg Travel');
    expect(
      (await client.put('/api/email-settings', settingsPayload({ smtpHost: 'smtp.example.com' })))
        .status,
    ).toBe(200);
    const ownerUser = await db.user.findUniqueOrThrow({ where: { normalizedEmail: ownerEmail } });
    const before = await db.companyEmailConfiguration.findUniqueOrThrow({
      where: { companyId: ownerUser.companyId },
    });
    // Update host/port only — no password in the payload.
    const updated = await client.put(
      '/api/email-settings',
      settingsPayload({ smtpHost: 'smtp.hostinger.com', smtpPassword: undefined }),
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const after = await db.companyEmailConfiguration.findUniqueOrThrow({
      where: { companyId: ownerUser.companyId },
    });
    expect(after.smtpHost).toBe('smtp.hostinger.com');
    expect(after.smtpPasswordEncrypted).toBe(before.smtpPasswordEncrypted);
  });

  it('refuses to send when no configuration exists', async () => {
    const client = await owner();
    const res = await client.post('/api/emails', {
      to: ['guest@example.com'],
      subject: 'Hello',
      bodyHtml: '<p>Hello</p>',
    });
    expect(res.status).toBe(400);
  });
});
