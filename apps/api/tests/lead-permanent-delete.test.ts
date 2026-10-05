import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import {
  normalizeCustomerName,
  normalizeCustomerPhone,
  normalizeEmail,
} from '../src/utils/normalize.js';

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

async function owner(email = 'owner@alpha.test', companyName = 'Alpha Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function employee(
  admin: Awaited<ReturnType<typeof owner>>,
  roleName: string,
  email: string,
  username: string,
) {
  const lookups = await admin.get('/api/users/lookups');
  const role = lookups.body.data.roles.find((value: { name: string }) => value.name === roleName);
  await admin.post('/api/users', {
    fullName: username.replaceAll('-', ' '),
    username,
    email,
    roleId: role.id,
    permissionTemplateId: null,
    status: 'ACTIVE',
    temporaryPassword: 'Temporary@2026',
    confirmTemporaryPassword: 'Temporary@2026',
    mustChangePassword: false,
  });
}

async function signIn(email: string) {
  const client = createAuthClient(app);
  const response = await client.post('/api/auth/login', {
    email,
    password: 'Temporary@2026',
    rememberMe: false,
  });
  expect(response.status).toBe(200);
  return client;
}

const leadPayload = (phone = '+91 98765 43210') => ({
  customerName: 'Aarav Mehta',
  phone,
  email: 'aarav@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-10',
  travelEndDate: '2026-09-14',
  rooms: 1,
  adults: 2,
  childrenWithBed: 1,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
});

async function createLead(client: ReturnType<typeof createAuthClient>, phone?: string) {
  const res = await client.post('/api/queries', leadPayload(phone));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function seedCustomer() {
  const company = await db.company.findFirstOrThrow({
    select: { id: true, users: { take: 1, select: { id: true } } },
  });
  const userId = company.users[0]!.id;
  const counter = await db.customerCounter.upsert({
    where: { companyId_year: { companyId: company.id, year: 0 } },
    create: { companyId: company.id, year: 0, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return db.customer.create({
    data: {
      companyId: company.id,
      customerNumber: `CUS-${String(counter.value).padStart(6, '0')}`,
      displayName: 'Aarav Mehta',
      normalizedName: normalizeCustomerName('Aarav Mehta'),
      primaryPhone: '+91 98765 43210',
      normalizedPhone: normalizeCustomerPhone('+91 98765 43210', 'IN'),
      email: 'aarav@example.test',
      normalizedEmail: normalizeEmail('aarav@example.test'),
      type: 'INDIVIDUAL',
      status: 'ACTIVE',
      lifecycleStage: 'PROSPECT',
      preferredCurrency: 'INR',
      assignedToId: userId,
      createdById: userId,
    },
  });
}

describe('lead permanent deletion (hard delete, no archive)', () => {
  it('A+B. deletes a clean lead permanently and the row no longer exists', async () => {
    const client = await owner();
    const lead = await createLead(client);
    const res = await client.delete(`/api/queries/${lead.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: true, id: lead.id });
    // T. no archive contract remains in the response.
    expect(res.body.data).not.toHaveProperty('archived');
    expect(res.body.message).toMatch(/permanently deleted/i);
    expect(await db.query.findUnique({ where: { id: lead.id } })).toBeNull();
    // Deleted leads disappear from the list because the row is gone.
    const list = await client.get('/api/queries?page=1&pageSize=50');
    expect(
      (list.body.data.data as Array<{ id: string }>).some((row) => row.id === lead.id),
    ).toBe(false);
  });

  it('C-G. cascades notes, stage history, assignment history, services and itinerary', async () => {
    const client = await owner();
    const lead = await createLead(client);
    const note = await client.post(`/api/queries/${lead.id}/notes`, { content: 'Call back' });
    expect(note.status).toBe(201);
    const followUp = await client.post(`/api/queries/${lead.id}/follow-ups`, {
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      notes: 'Keep, but detach',
    });
    expect(followUp.status).toBe(201);

    expect(await db.queryNote.count({ where: { queryId: lead.id } })).toBeGreaterThan(0);
    expect(await db.queryStageHistory.count({ where: { queryId: lead.id } })).toBeGreaterThan(0);
    expect(
      await db.queryAssignmentHistory.count({ where: { queryId: lead.id } }),
    ).toBeGreaterThan(0);
    expect(await db.queryService.count({ where: { queryId: lead.id } })).toBeGreaterThan(0);
    expect(await db.queryItinerary.count({ where: { queryId: lead.id } })).toBeGreaterThan(0);

    expect((await client.delete(`/api/queries/${lead.id}`)).status).toBe(200);

    expect(await db.queryNote.count({ where: { queryId: lead.id } })).toBe(0);
    expect(await db.queryStageHistory.count({ where: { queryId: lead.id } })).toBe(0);
    expect(await db.queryAssignmentHistory.count({ where: { queryId: lead.id } })).toBe(0);
    expect(await db.queryService.count({ where: { queryId: lead.id } })).toBe(0);
    expect(await db.queryItinerary.count({ where: { queryId: lead.id } })).toBe(0);
    // J. follow-ups survive with queryId nulled.
    const orphan = await db.queryFollowUp.findUniqueOrThrow({ where: { id: followUp.body.data.id } });
    expect(orphan.queryId).toBeNull();
  });

  it('H+I. shared customer and its other leads survive; metrics recalculated', async () => {
    const client = await owner();
    const customer = await seedCustomer();
    const doomed = await createLead(client, '+91 98765 43210');
    const survivor = await createLead(client, '+91 98765 43211');
    for (const lead of [doomed, survivor]) {
      await db.query.update({ where: { id: lead.id }, data: { customerId: customer.id } });
    }
    expect((await client.delete(`/api/queries/${doomed.id}`)).status).toBe(200);
    expect(await db.customer.findUnique({ where: { id: customer.id } })).not.toBeNull();
    expect(await db.query.findUnique({ where: { id: survivor.id } })).not.toBeNull();
    const refreshed = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(refreshed.queryCount).toBe(1);
  });

  it('K+L+M. calls, communications and WACRM links survive with nulled lead refs', async () => {
    const client = await owner();
    const customer = await seedCustomer();
    const lead = await createLead(client);
    await db.query.update({ where: { id: lead.id }, data: { customerId: customer.id } });
    const company = await db.company.findFirstOrThrow({
      select: { id: true, users: { take: 1, select: { id: true } } },
    });
    const userId = company.users[0]!.id;
    const call = await db.call.create({
      data: {
        companyId: company.id,
        userId,
        customerId: customer.id,
        queryId: lead.id,
        androidCallSessionId: 'sess-1',
        phone: '+91 98765 43210',
        normalizedPhone: '9876543210',
        direction: 'INCOMING',
        startedAt: new Date(),
      },
    });
    const recording = await db.callRecording.create({
      data: {
        callId: call.id,
        companyId: company.id,
        s3Key: 'companies/x/calls/y.mp3',
        s3Bucket: 'test-bucket',
        mimeType: 'audio/mpeg',
        sizeBytes: 10,
        sha256: 'abc',
        originalFilename: 'y.mp3',
      },
    });
    const comm = await db.customerCommunication.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        leadId: lead.id,
        performedById: userId,
        type: 'PHONE',
        direction: 'OUTBOUND',
        summary: 'Discussed Goa package',
      },
    });
    const link = await db.wacrmLeadLink.create({
      data: {
        companyId: company.id,
        wacrmAccountId: 'acc-1',
        flowRunId: 'run-1',
        queryId: lead.id,
      },
    });

    expect((await client.delete(`/api/queries/${lead.id}`)).status).toBe(200);

    expect((await db.call.findUnique({ where: { id: call.id } }))?.queryId).toBeNull();
    // Call recordings stay valid: their owning Call was preserved.
    expect(await db.callRecording.findUnique({ where: { id: recording.id } })).not.toBeNull();
    expect((await db.customerCommunication.findUnique({ where: { id: comm.id } }))?.leadId).toBeNull();
    expect((await db.wacrmLeadLink.findUnique({ where: { id: link.id } }))?.queryId).toBeNull();
  });

  it('N. writes QUERY_DELETED audit with identity metadata; logs survive', async () => {
    const client = await owner();
    const lead = await createLead(client);
    expect((await client.delete(`/api/queries/${lead.id}`)).status).toBe(200);
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Query', entityId: lead.id },
    });
    const deleted = logs.filter((row) => row.action === 'QUERY_DELETED');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.metadata).toMatchObject({
      queryNumber: lead.queryNumber,
      customerName: 'Aarav Mehta',
    });
    expect(logs.some((row) => row.action === 'QUERY_ARCHIVED')).toBe(false);
  });

  it('O. lead with quotation: 409 and quotation untouched', async () => {
    const client = await owner();
    const lead = await createLead(client);
    const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
    const res = await client.delete(`/api/queries/${lead.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/quotation/i);
    expect(await db.query.findUnique({ where: { id: lead.id } })).not.toBeNull();
    expect(await db.quotation.findUnique({ where: { id: quotation.id } })).not.toBeNull();
    expect(await db.quotationVersion.count({ where: { quotationId: quotation.id } })).toBeGreaterThan(0);
  });

  it('P. lead with booking: 409 and booking untouched', async () => {
    const client = await owner();
    const lead = await createLead(client);
    const company = await db.company.findFirstOrThrow({
      select: { id: true, users: { take: 1, select: { id: true } } },
    });
    const booking = await db.booking.create({
      data: {
        companyId: company.id,
        bookingNumber: 'BKG-TEST-001',
        queryId: lead.id,
        customerName: 'Aarav Mehta',
        customerPhone: '+91 98765 43210',
        destinationSummary: 'Goa',
        bookedById: company.users[0]!.id,
      },
    });
    const res = await client.delete(`/api/queries/${lead.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/booking/i);
    expect(await db.query.findUnique({ where: { id: lead.id } })).not.toBeNull();
    expect(await db.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();
  });

  it('Q. sales executive without queries.delete is denied', async () => {
    const admin = await owner();
    const lead = await createLead(admin);
    await employee(admin, 'Sales Executive', 'sales@alpha.test', 'sales-exec');
    const sales = await signIn('sales@alpha.test');
    const res = await sales.delete(`/api/queries/${lead.id}`);
    expect(res.status).toBe(403);
    expect(await db.query.findUnique({ where: { id: lead.id } })).not.toBeNull();
  });

  it('R. second DELETE returns 404', async () => {
    const client = await owner();
    const lead = await createLead(client);
    expect((await client.delete(`/api/queries/${lead.id}`)).status).toBe(200);
    const again = await client.delete(`/api/queries/${lead.id}`);
    expect(again.status).toBe(404);
  });
});
