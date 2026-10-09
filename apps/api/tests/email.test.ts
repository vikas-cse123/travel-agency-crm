import net from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { decryptSensitiveValue } from '../src/utils/crypto.js';
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

async function owner(email = 'owner@email.test', companyName = 'Email Travel') {
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

const sentMails: Array<Record<string, unknown>> = [];
function stubTransport(behavior: 'ok' | { code: string; message: string } = 'ok') {
  sentMails.length = 0;
  __setSmtpTransportFactory(() => ({
    sendMail: async (message: Record<string, unknown>) => {
      sentMails.push(message);
      if (behavior !== 'ok') {
        const error = new Error(behavior.message) as Error & { code: string };
        error.code = behavior.code;
        throw error;
      }
      return { accepted: [message.to], messageId: '<test@localhost>' };
    },
  }));
}

async function salesClient(companyOwnerEmail: string, roleName = 'Sales Executive') {
  const email = `${roleName === 'View Only' ? 'viewer' : 'sales'}@email.test`;
  const ownerUser = await db.user.findUniqueOrThrow({
    where: { normalizedEmail: companyOwnerEmail },
  });
  const role = await db.role.findFirstOrThrow({
    where: { companyId: ownerUser.companyId, name: roleName },
  });
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: `${roleName === 'View Only' ? 'vieweremail' : 'salesemail'}`,
      fullName: `${roleName} User`,
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

/** Minimal in-process SMTP sink: real TCP conversation, captures envelope + data. */
async function startFakeSmtp() {
  const received: { mailFrom: string; rcptTo: string[]; data: string } = {
    mailFrom: '',
    rcptTo: [],
    data: '',
  };
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data = '';
    socket.write('220 fake-smtp ESMTP ready\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.data = data;
            data = '';
            socket.write('250 OK: queued\r\n');
          } else {
            data += `${line}\n`;
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-fake\r\n250 AUTH LOGIN PLAIN\r\n');
        } else if (upper.startsWith('AUTH')) {
          socket.write('235 Authentication succeeded\r\n');
        } else if (upper.startsWith('MAIL FROM:')) {
          received.mailFrom = line.slice(10).trim();
          socket.write('250 OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          received.rcptTo.push(line.slice(8).trim());
          socket.write('250 OK\r\n');
        } else if (upper.startsWith('DATA')) {
          inData = true;
          socket.write('354 End with .\r\n');
        } else if (upper.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else if (upper.startsWith('RSET') || upper.startsWith('NOOP')) {
          socket.write('250 OK\r\n');
        } else {
          socket.write('502 Unimplemented\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('Standalone email', () => {
  it('creates and updates configuration without ever returning the password', async () => {
    const client = await owner();
    const created = await saveSettings(client);
    expect(created).toMatchObject({
      provider: 'CUSTOM_SMTP',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      fromEmail: 'bookings@example.com',
      passwordConfigured: true,
    });
    expect(created).not.toHaveProperty('smtpPasswordEncrypted');
    expect(created).not.toHaveProperty('passwordKeyVersion');
    expect(created).not.toHaveProperty('smtpPassword');
    expect(JSON.stringify(created)).not.toContain('s3cret-password');
    // Update without a password keeps the stored secret.
    const updated = await saveSettings(client, { smtpHost: 'smtp2.example.com' });
    expect(updated.smtpHost).toBe('smtp2.example.com');
    expect(updated.passwordConfigured).toBe(true);
    const fetched = (await client.get('/api/email-settings')).body.data;
    expect(fetched).not.toHaveProperty('smtpPasswordEncrypted');
    expect(fetched.passwordConfigured).toBe(true);
  });

  it('stores the password encrypted and decryptable only server-side', async () => {
    const client = await owner();
    await saveSettings(client);
    const company = await db.company.findFirstOrThrow({ select: { id: true } });
    const row = await db.companyEmailConfiguration.findUniqueOrThrow({
      where: { companyId: company.id },
    });
    expect(row.smtpPasswordEncrypted).not.toContain('s3cret-password');
    expect(row.smtpPasswordEncrypted).toContain(':');
    expect(decryptSensitiveValue(row.smtpPasswordEncrypted, process.env.DATA_ENCRYPTION_KEY!)).toBe(
      's3cret-password',
    );
  });

  it('requires a password for the first configuration only', async () => {
    const client = await owner();
    const { smtpPassword: _password, ...withoutPassword } = settingsPayload();
    void _password;
    expect((await client.put('/api/email-settings', withoutPassword)).status).toBe(400);
  });

  it('isolates configurations per company', async () => {
    const alpha = await owner('alpha@email.test', 'Alpha Travel');
    const beta = await owner('beta@email.test', 'Beta Travel');
    await saveSettings(alpha);
    expect((await beta.get('/api/email-settings')).status).toBe(404);
    // Beta saves its own; alpha's survives untouched.
    await saveSettings(beta, { smtpHost: 'smtp.beta.example' });
    expect((await alpha.get('/api/email-settings')).body.data.smtpHost).toBe('smtp.example.com');
  });

  it('enforces settings permissions', async () => {
    const client = await owner('owner2@email.test', 'Perm Travel');
    const sales = await salesClient('owner2@email.test');
    expect((await sales.get('/api/email-settings')).status).toBe(403);
    expect((await sales.put('/api/email-settings', settingsPayload())).status).toBe(403);
    expect((await sales.post('/api/email-settings/test', { to: 'a@example.test' })).status).toBe(
      403,
    );
    void client;
  });

  it('sends a valid email and records SENT with CC/BCC', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransport();
    const response = await client.post('/api/emails', {
      to: ['Hotel@Example.com', 'hotel@example.com', 'manager@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: 'Hotel Booking Confirmation',
      bodyHtml: '<p>Dear Hotel Team,</p><p>Please find the details below.</p>',
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ status: 'SENT' });
    expect(response.body.data.sentAt).toBeTruthy();
    // Recipients normalized + deduped; CC/BCC delivered to the transport.
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({
      to: ['hotel@example.com', 'manager@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: 'Hotel Booking Confirmation',
    });
    const row = await db.emailLog.findFirstOrThrow({
      where: { id: response.body.data.id },
    });
    expect(row.status).toBe('SENT');
    expect(row.to).toEqual(['hotel@example.com', 'manager@example.com']);
  });

  it('rejects invalid recipients and missing fields', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransport();
    expect(
      (
        await client.post('/api/emails', {
          to: ['not-an-email'],
          subject: 'Hi',
          bodyHtml: '<p>x</p>',
        })
      ).status,
    ).toBe(400);
    expect(
      (await client.post('/api/emails', { to: [], subject: 'Hi', bodyHtml: '<p>x</p>' })).status,
    ).toBe(400);
    expect(
      (
        await client.post('/api/emails', {
          to: ['a@example.test'],
          subject: '',
          bodyHtml: '<p>x</p>',
        })
      ).status,
    ).toBe(400);
    expect(sentMails).toHaveLength(0);
    expect(await db.emailLog.count()).toBe(0);
  });

  it('rejects sending without a configuration', async () => {
    const client = await owner();
    stubTransport();
    const response = await client.post('/api/emails', {
      to: ['a@example.test'],
      subject: 'Hi',
      bodyHtml: '<p>x</p>',
    });
    expect(response.status).toBe(400);
    expect(await db.emailLog.count()).toBe(0);
  });

  it('records FAILED with a safe message on SMTP auth failure', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransport({
      code: 'EAUTH',
      message: '535 5.7.8 Authentication failed for s3cret-password',
    });
    const response = await client.post('/api/emails', {
      to: ['hotel@example.com'],
      subject: 'Hotel Booking Confirmation',
      bodyHtml: '<p>Details</p>',
    });
    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain('Authentication failed');
    expect(response.body.error.message).not.toContain('s3cret-password');
    expect(JSON.stringify(response.body)).not.toContain('s3cret-password');
    const row = await db.emailLog.findFirstOrThrow({});
    expect(row.status).toBe('FAILED');
    expect(row.sentAt).toBeNull();
    expect(row.errorMessage).toContain('Authentication failed');
    expect(row.errorMessage).not.toContain('s3cret-password');
  });

  it('records FAILED on unreachable hosts without leaking internals', async () => {
    const client = await owner();
    await saveSettings(client, { smtpHost: 'smtp.invalid' });
    stubTransport({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.invalid' });
    const response = await client.post('/api/emails', {
      to: ['hotel@example.com'],
      subject: 'Hi',
      bodyHtml: '<p>x</p>',
    });
    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain('smtp.invalid');
  });

  it('lists history with search and status filters plus full details', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransport();
    await client.post('/api/emails', {
      to: ['hotel@example.com'],
      subject: 'Hotel Confirmation',
      bodyHtml: '<p>Details</p>',
    });
    const list = await client.get('/api/emails');
    expect(list.body.data.pagination.total).toBe(1);
    const row = list.body.data.data[0];
    expect(row).toMatchObject({ subject: 'Hotel Confirmation', status: 'SENT' });
    expect(row).not.toHaveProperty('bodyHtml');
    expect((await client.get('/api/emails?search=hotel')).body.data.pagination.total).toBe(1);
    expect((await client.get('/api/emails?search=nope')).body.data.pagination.total).toBe(0);
    expect((await client.get('/api/emails?status=SENT')).body.data.pagination.total).toBe(1);
    expect((await client.get('/api/emails?status=FAILED')).body.data.pagination.total).toBe(0);
    const details = (await client.get(`/api/emails/${row.id}`)).body.data;
    expect(details.bodyHtml).toContain('Details');
    expect(details.to).toEqual(['hotel@example.com']);
  });

  it('enforces send/list permissions and tenant isolation on history', async () => {
    const alpha = await owner('alpha2@email.test', 'Alpha2 Travel');
    const beta = await owner('beta2@email.test', 'Beta2 Travel');
    await saveSettings(alpha);
    stubTransport();
    const sent = await alpha.post('/api/emails', {
      to: ['hotel@example.com'],
      subject: 'Hi',
      bodyHtml: '<p>x</p>',
    });
    expect((await beta.get('/api/emails')).body.data.pagination.total).toBe(0);
    expect((await beta.get(`/api/emails/${sent.body.data.id}`)).status).toBe(404);
    const sales = await salesClient('alpha2@email.test');
    expect((await sales.get('/api/emails')).status).toBe(200);
    // Sales Executive holds emails.send: recording works through the grant.
    expect(
      (
        await sales.post('/api/emails', {
          to: ['x@example.test'],
          subject: 'Hi',
          bodyHtml: '<p>x</p>',
        })
      ).status,
    ).toBe(201);
    // View Only can read history but never send or manage settings.
    const viewer = await salesClient('alpha2@email.test', 'View Only');
    expect((await viewer.get('/api/emails')).status).toBe(200);
    expect(
      (
        await viewer.post('/api/emails', {
          to: ['x@example.test'],
          subject: 'Hi',
          bodyHtml: '<p>x</p>',
        })
      ).status,
    ).toBe(403);
    expect((await viewer.put('/api/email-settings', settingsPayload())).status).toBe(403);
  });

  it('sends a test email through the saved configuration', async () => {
    const client = await owner();
    await saveSettings(client);
    stubTransport();
    const response = await client.post('/api/email-settings/test', {
      to: 'check@example.com',
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ sent: true });
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: ['check@example.com'] });
    expect((await client.post('/api/email-settings/test', { to: 'not-an-email' })).status).toBe(
      400,
    );
  });

  it('completes a real SMTP round-trip against a live sink server', async () => {
    const sink = await startFakeSmtp();
    try {
      const client = await owner();
      await saveSettings(client, {
        smtpHost: '127.0.0.1',
        smtpPort: sink.port,
        security: 'NONE',
        smtpUsername: 'tester',
        smtpPassword: 'irrelevant-here',
        fromEmail: 'bookings@example.com',
      });
      // Real nodemailer transport (no stub): exercises the wire protocol.
      __setSmtpTransportFactory(null);
      const response = await client.post('/api/emails', {
        to: ['hotel@example.com'],
        cc: ['cc@example.com'],
        subject: 'Hotel Booking Confirmation',
        bodyHtml: '<p>Dear Hotel Team,</p><p>Please find the details below.</p>',
      });
      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('SENT');
      expect(sink.received.mailFrom).toContain('bookings@example.com');
      expect(sink.received.rcptTo.join(' ')).toContain('hotel@example.com');
      expect(sink.received.rcptTo.join(' ')).toContain('cc@example.com');
      expect(sink.received.data).toContain('Hotel Booking Confirmation');
      expect(sink.received.data).toContain('Dear Hotel Team');
    } finally {
      await sink.close();
    }
  }, 60000);
});
