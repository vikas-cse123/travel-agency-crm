import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { __setSmtpTransportFactory } from '../src/modules/email/email.service.js';
import { hashPassword } from '../src/utils/crypto.js';

let app: Express;
let db: PrismaClient;

beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => {
  __setSmtpTransportFactory(null);
  await db.$disconnect();
});
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
  __setSmtpTransportFactory(null);
});

async function owner(email = 'owner@rmemail.test', companyName = 'Remove Email Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

const settingsPayload = (overrides: Record<string, unknown> = {}) => ({
  provider: 'CUSTOM_SMTP',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  security: 'STARTTLS',
  smtpUsername: 'bookings@example.com',
  smtpPassword: 's3cret-password',
  fromName: 'ABC Travels',
  fromEmail: 'bookings@example.com',
  replyTo: 'bookings@example.com',
  ...overrides,
});

async function saveSettings(client: Client, overrides: Record<string, unknown> = {}) {
  const response = await client.put('/api/email-settings', settingsPayload(overrides));
  expect(response.status).toBe(200);
  return response.body.data;
}

/** A company user without the settings permission (mirrors email.test.ts). */
async function salesClient(companyOwnerEmail: string) {
  const email = 'sales@rmemail.test';
  const ownerUser = await db.user.findUniqueOrThrow({
    where: { normalizedEmail: companyOwnerEmail },
  });
  const role = await db.role.findFirstOrThrow({
    where: { companyId: ownerUser.companyId, name: 'Sales Executive' },
  });
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: 'salesrmemail',
      fullName: 'Sales User',
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Sales@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  const login = await client.post('/api/auth/login', {
    email,
    password: 'Sales@2026',
    rememberMe: false,
  });
  expect(login.status).toBe(200);
  return client;
}

function stubTransportOk() {
  __setSmtpTransportFactory(() => ({
    sendMail: async () => ({ accepted: ['a@example.test'], messageId: '<test@localhost>' }),
  }));
}

describe('Email configuration removal', () => {
  it('removes an existing configuration with all its values', async () => {
    const client = await owner();
    await saveSettings(client);
    const before = await db.companyEmailConfiguration.findFirstOrThrow({});
    expect(before.smtpPasswordEncrypted).toBeTruthy();

    const res = await client.delete('/api/email-settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ removed: true });

    // Row (including the encrypted password) is gone for this company.
    expect(await db.companyEmailConfiguration.count()).toBe(0);
    expect((await client.get('/api/email-settings')).status).toBe(404);

    // Audited without secrets (existing UPDATED action, removal flagged).
    // Latest first: the save audit shares the same action and entity.
    const audit = await db.activityLog.findFirstOrThrow({
      where: { action: 'EMAIL_SETTINGS_UPDATED', entityId: before.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ removed: true, smtpHost: 'smtp.example.com' });
    expect(JSON.stringify(audit.metadata ?? {})).not.toContain('s3cret');
  });

  it('returns 404 when no configuration exists', async () => {
    const client = await owner();
    const res = await client.delete('/api/email-settings');
    expect(res.status).toBe(404);
  });

  it('prevents unauthorized and forbidden access', async () => {
    const client = await owner();
    await saveSettings(client);

    const anonymous = createAuthClient(app);
    expect((await anonymous.delete('/api/email-settings')).status).toBe(401);

    const sales = await salesClient('owner@rmemail.test');
    expect((await sales.delete('/api/email-settings')).status).toBe(403);

    // Failed attempts leave the configuration untouched.
    expect(await db.companyEmailConfiguration.count()).toBe(1);
  });

  it('cannot remove another company\u2019s configuration', async () => {
    const alpha = await owner('alpha@rmemail.test', 'Alpha Travel');
    await saveSettings(alpha, { smtpHost: 'smtp.alpha.example' });
    const beta = await owner('beta@rmemail.test', 'Beta Travel');

    // Beta has nothing configured: removal reports 404, not alpha's row.
    expect((await beta.delete('/api/email-settings')).status).toBe(404);
    const alphaRow = await db.companyEmailConfiguration.findFirstOrThrow({});
    expect(alphaRow.smtpHost).toBe('smtp.alpha.example');
    expect((await alpha.get('/api/email-settings')).status).toBe(200);

    // Beta configures its own account and removes it; alpha is unaffected.
    await saveSettings(beta, { smtpHost: 'smtp.beta.example' });
    expect((await beta.delete('/api/email-settings')).status).toBe(200);
    expect((await alpha.get('/api/email-settings')).status).toBe(200);
    expect((await beta.get('/api/email-settings')).status).toBe(404);
  });

  it('blocks test emails and sends after removal until reconfigured', async () => {
    const client = await owner();
    await saveSettings(client);
    expect((await client.delete('/api/email-settings')).status).toBe(200);

    stubTransportOk();
    const test = await client.post('/api/email-settings/test', { to: 'a@example.test' });
    expect(test.status).toBe(400);
    expect(JSON.stringify(test.body)).toContain('No email sending account');

    const send = await client.post('/api/emails', {
      to: ['a@example.test'],
      subject: 'Hi',
      bodyHtml: '<p>x</p>',
    });
    expect(send.status).toBe(400);
    expect(await db.emailLog.count()).toBe(0);

    // Saving again restores sending.
    await saveSettings(client);
    const retry = await client.post('/api/email-settings/test', { to: 'a@example.test' });
    expect(retry.status).toBe(200);
  });

  it('keeps email history intact after removal', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransportOk();
    const sent = await client.post('/api/emails', {
      to: ['a@example.test'],
      subject: 'History mail',
      bodyHtml: '<p>keep me</p>',
    });
    expect(sent.status).toBe(201);

    expect((await client.delete('/api/email-settings')).status).toBe(200);
    const history = await client.get('/api/emails');
    expect(history.status).toBe(200);
    expect(history.body.data.data).toHaveLength(1);
    expect(history.body.data.data[0]).toMatchObject({ subject: 'History mail', status: 'SENT' });
  });
});
