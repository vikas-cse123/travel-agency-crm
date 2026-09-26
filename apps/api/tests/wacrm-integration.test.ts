import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

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

async function owner(email: string, companyName: string) {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function employeeEmail(ownerClient: Awaited<ReturnType<typeof owner>>, email: string) {
  const lookups = await ownerClient.get('/api/users/lookups');
  const role = lookups.body.data.roles.find((value: { name: string }) => value.name === 'Sales Executive')
    ?? lookups.body.data.roles[0];
  const username = email.split('@')[0].replaceAll(/[^a-z0-9]/gi, '-').slice(0, 30);
  const created = await ownerClient.post('/api/users', {
    fullName: 'Sales Person',
    username,
    email,
    roleId: role.id,
    permissionTemplateId: null,
    status: 'ACTIVE',
    temporaryPassword: 'Temporary@2026',
    confirmTemporaryPassword: 'Temporary@2026',
    mustChangePassword: false,
  });
  expect(created.status).toBe(201);
}

const WACRM_ACCOUNT = '11111111-1111-4111-8111-111111111111';
const FLOW_RUN = '22222222-2222-4222-8222-222222222222';

const payload = (overrides: Record<string, unknown> = {}) => ({
  wacrmAccountId: WACRM_ACCOUNT,
  flowRunId: FLOW_RUN,
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  email: 'aarav@example.com',
  leadSource: 'WHATSAPP',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  assignedToEmail: 'sales@alpha.test',
  dateOfBirth: '1990-05-01',
  travelStartDate: '2026-12-01',
  departureCountry: 'India',
  departureCity: 'Delhi',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 1,
  infants: 0,
  services: ['FLIGHT', 'HOTEL'],
  itinerary: [
    { country: 'Thailand', destination: 'Bangkok', nights: 3, sequence: 1 },
    { country: 'Thailand', destination: 'Phuket', nights: 4, sequence: 2 },
  ],
  ...overrides,
});

async function mintToken(
  adminClient: Awaited<ReturnType<typeof owner>>,
  userEmail: string,
  name = 'wacrm-sync',
) {
  const me = await db.user.findFirst({
    where: { normalizedEmail: userEmail.trim().toLowerCase(), deletedAt: null },
  });
  expect(me, `service user ${userEmail} must exist`).toBeDefined();
  const minted = await adminClient.post('/api/integrations/credentials', {
    name,
    userId: me.id,
  });
  expect(minted.status).toBe(201);
  expect(typeof minted.body.data.token).toBe('string');
  return minted.body.data.token as string;
}

const bearer = (token: string) => ({
  post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`),
  get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
});

describe('WACRM server-to-server lead integration', () => {
  it('1+4+16. creates a lead over Bearer auth and returns the real lead ID', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token).post('/api/integrations/wacrm/leads').send(payload());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    const leadId = res.body.data.leadId as string;
    expect(leadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.alreadyExists).toBe(false);

    const row = await db.query.findUniqueOrThrow({ where: { id: leadId } });
    expect(row.customerName).toBe('Aarav Mehta');
    expect(row.normalizedPhone).toBe('9876543210');
    expect(row.leadSource).toBe('WHATSAPP');
    expect(await db.queryService.count({ where: { queryId: leadId } })).toBe(2);
    expect(
      await db.queryItinerary.findMany({ where: { queryId: leadId }, orderBy: { sequence: 'asc' } }),
    ).toMatchObject([
      { country: 'Thailand', destination: 'Bangkok', nights: 3 },
      { country: 'Thailand', destination: 'Phuket', nights: 4 },
    ]);
  });

  it('2. rejects missing, malformed, and unknown tokens', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    // Headerless non-browser callers are rejected by the global
    // Origin check (403) before auth runs; callers from a trusted
    // origin reach the Bearer check (401).
    expect((await request(app).post('/api/integrations/wacrm/leads').send(payload())).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/integrations/wacrm/leads')
          .set('Origin', 'http://localhost:5173')
          .send(payload())
      ).status,
    ).toBe(401);
    expect(
      (await bearer('garbage').post('/api/integrations/wacrm/leads').send(payload())).status,
    ).toBe(401);
    expect(
      (await bearer('wacrm_' + '0'.repeat(43)).post('/api/integrations/wacrm/leads').send(payload())).status,
    ).toBe(401);
    // Tampered signature on a real prefix.
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    expect((await bearer(tampered).post('/api/integrations/wacrm/leads').send(payload())).status).toBe(401);
  });

  it('3+18. isolates tenants: cross-company assignee and lead access fail', async () => {
    const adminA = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(adminA, 'sales@alpha.test');
    const tokenA = await mintToken(adminA, 'owner@alpha.test');
    const adminB = await owner('owner@beta.test', 'Beta Travel');
    await employeeEmail(adminB, 'sales@beta.test');
    const tokenB = await mintToken(adminB, 'owner@beta.test');

    // B's token cannot resolve A's user by email.
    const cross = await bearer(tokenB)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: 'sales@alpha.test' }));
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe('ASSIGNED_USER_NOT_FOUND');

    // A creates; B cannot read the lead through any integration path.
    const created = await bearer(tokenA).post('/api/integrations/wacrm/leads').send(payload());
    const leadId = created.body.data.leadId as string;
    const lookupsB = await bearer(tokenB).get('/api/integrations/wacrm/lookups');
    expect(lookupsB.status).toBe(200);
    const ids = JSON.stringify(lookupsB.body);
    expect(ids).not.toContain(leadId);
    // B's link namespace is independent: same WACRM key creates B's own lead.
    const again = await bearer(tokenB)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: 'sales@beta.test' }));
    expect(again.status).toBe(201);
    expect(again.body.data.leadId).not.toBe(leadId);
  });

  it('5. duplicate retries return the existing lead without a second row', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    const first = await bearer(token).post('/api/integrations/wacrm/leads').send(payload());
    const second = await bearer(token).post('/api/integrations/wacrm/leads').send(payload());
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({
      leadId: first.body.data.leadId,
      alreadyExists: true,
    });
    expect(await db.query.count()).toBe(1);
    expect(await db.wacrmLeadLink.count()).toBe(1);
  });

  it('6. assignedToEmail resolves case-insensitively to the user id', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: '  SALES@ALPHA.TEST ' }));
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    const assignee = await db.user.findFirstOrThrow({ where: { email: 'sales@alpha.test' } });
    expect(row.assignedToId).toBe(assignee.id);
  });

  it('7+15. unknown assignee fails closed with no lead and a failed link', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: 'ghost@alpha.test' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNED_USER_NOT_FOUND');
    expect(await db.query.count()).toBe(0);
    const link = await db.wacrmLeadLink.findFirstOrThrow({
      where: { flowRunId: FLOW_RUN },
    });
    expect(link.status).toBe('failed');
    // Retry after fixing the email succeeds on the same key.
    await employeeEmail(admin, 'sales@alpha.test');
    const retry = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: 'sales@alpha.test' }));
    expect(retry.status).toBe(201);
    expect(await db.query.count()).toBe(1);
  });

  it('8. missing required fields are rejected with field errors', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    const { phone: _dropped, ...noPhone } = payload();

    const res = await bearer(token).post('/api/integrations/wacrm/leads').send(noPhone);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('phone');
    expect(await db.query.count()).toBe(0);
  });

  it('9+10+11. invalid leadSource, leadType, and leadStage are rejected', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    for (const [field, value] of [
      ['leadSource', 'SMOKE_SIGNALS'],
      ['leadType', 'VOLCANIC'],
      ['leadStage', 'TELEPORTED'],
    ] as const) {
      const res = await bearer(token)
        .post('/api/integrations/wacrm/leads')
        .send(payload({ [field]: value }));
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toHaveProperty(field);
    }
    expect(await db.query.count()).toBe(0);
  });

  it('12. unknown service enum values are rejected', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ services: ['FLIGHT', 'TELEPORT'] }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).some((k: string) => k.startsWith('services'))).toBe(true);
    expect(await db.query.count()).toBe(0);
  });

  it('13+14. itinerary requires a valid row; bad rows fail', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    const empty = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ itinerary: [] }));
    expect(empty.status).toBe(400);
    const badNights = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(
        payload({
          flowRunId: '33333333-3333-4333-8333-333333333333',
          itinerary: [{ country: 'Thailand', destination: 'Bangkok', nights: -2, sequence: 1 }],
        }),
      );
    expect(badNights.status).toBe(400);
    expect(await db.query.count()).toBe(0);
  });

  it('lookups serve live option values for the integration', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');
    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    const data = res.body.data;
    for (const key of ['leadSources', 'leadTypes', 'leadStages', 'serviceTypes', 'assignableUsers']) {
      expect(Array.isArray(data[key]), key).toBe(true);
    }
    expect(data.serviceTypes.map((s: { value: string }) => s.value)).toEqual(
      expect.arrayContaining(['FLIGHT', 'HOTEL']),
    );
    expect(
      data.assignableUsers.map((u: { email?: string }) => u.email ?? u),
    ).toBeDefined();
  });

  it('17. no credential secret ever leaves the server', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    const list = await admin.get('/api/integrations/credentials');
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain('keyHash');
    const lead = await bearer(token).post('/api/integrations/wacrm/leads').send(payload());
    expect(JSON.stringify(lead.body)).not.toContain(token);
    const stored = await db.integrationCredential.findFirstOrThrow({});
    expect(stored.keyHash).not.toContain('wacrm_');
    expect(stored.keyHash).toHaveLength(64);
  });

  it('revoked and expired credentials stop working', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const token = await mintToken(admin, 'owner@alpha.test');
    const list = await admin.get('/api/integrations/credentials');
    const id = list.body.data[0].id as string;
    const revoked = await admin.delete(`/api/integrations/credentials/${id}`);
    expect(revoked.status).toBe(200);
    expect(
      (await bearer(token).post('/api/integrations/wacrm/leads').send(payload())).status,
    ).toBe(401);
  });

  it('19. normal POST /queries behavior is unchanged', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const res = await admin.post('/api/queries', {
      customerName: 'Aarav Mehta',
      phone: '+91 98765 43210',
      leadSource: 'REFERRAL',
      services: ['FLIGHT'],
      itinerary: [{ country: 'Thailand', destination: 'Bangkok', nights: 3, sequence: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.queryNumber).toMatch(/^QRY-/);
  });
});

describe('WACRM lead creation: departure, travelers, and enum coverage', () => {
  const runId = (n: number) =>
    `33333333-3333-4333-8333-${n.toString(16).padStart(12, '0')}`;

  async function setup() {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');
    return { admin, token };
  }

  it('departureCountry/departureCity are accepted and persisted (no lookup call needed)', async () => {
    const { token } = await setup();
    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ departureCountry: 'India', departureCity: 'Delhi' }));
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    expect(row.departureCountry).toBe('India');
    expect(row.departureCity).toBe('Delhi');
  });

  it('arbitrary in-length values pass (free text, like the native form); over-max fails', async () => {
    const { token } = await setup();
    const free = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(
        payload({
          flowRunId: runId(10),
          departureCountry: 'Atlantis',
          departureCity: 'Poseidon Bay',
        }),
      );
    expect(free.status).toBe(201);
    const tooLong = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ flowRunId: runId(11), departureCountry: 'X'.repeat(81) }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.fields).toHaveProperty('departureCountry');
    expect(await db.query.count()).toBe(1);
  });

  it('adults = 1 accepted and stored; adults = 0 rejected', async () => {
    const { token } = await setup();
    const one = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ flowRunId: runId(20), adults: 1 }));
    expect(one.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: one.body.data.leadId } });
    expect(row.adults).toBe(1);
    const zero = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ flowRunId: runId(21), adults: 0 }));
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');
    expect(zero.body.error.fields).toHaveProperty('adults');
  });

  it('omitted CWB/CWOB/infants default to 0 without rejection', async () => {
    const { token } = await setup();
    const base = payload({ flowRunId: runId(30) });
    delete (base as Record<string, unknown>).childrenWithBed;
    delete (base as Record<string, unknown>).childrenWithoutBed;
    delete (base as Record<string, unknown>).infants;
    const res = await bearer(token).post('/api/integrations/wacrm/leads').send(base);
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    expect(row.childrenWithBed).toBe(0);
    expect(row.childrenWithoutBed).toBe(0);
    expect(row.infants).toBe(0);
    expect(row.childrenWithBedAges).toEqual([]);
    expect(row.childrenWithoutBedAges).toEqual([]);
    expect(row.infantAges).toEqual([]);
  });

  it('optional age arrays are accepted, persisted, and nullable when absent', async () => {
    const { token } = await setup();
    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(
        payload({
          flowRunId: runId(40),
          childrenWithBed: 2,
          childrenWithBedAges: [8, 10],
          childrenWithoutBedAges: [],
          infantAges: [1],
        }),
      );
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    expect(row.childrenWithBedAges).toEqual([8, 10]);
    expect(row.childrenWithoutBedAges).toEqual([]);
    expect(row.infantAges).toEqual([1]);
  });

  it('invalid ages are rejected with field errors and create nothing', async () => {
    const { token } = await setup();
    const cases = [
      { field: 'childrenWithBedAges', value: ['old'] },
      { field: 'childrenWithBedAges', value: [45] },
      { field: 'infantAges', value: [50] },
    ] as const;
    let n = 50;
    for (const { field, value } of cases) {
      const res = await bearer(token)
        .post('/api/integrations/wacrm/leads')
        .send(payload({ flowRunId: runId(n++), [field]: value }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(
        Object.keys(res.body.error.fields).some(
          (k: string) => k === field || k.startsWith(`${field}.`),
        ),
        field,
      ).toBe(true);
    }
    expect(await db.query.count()).toBe(0);
  });

  it('all Type values are accepted', async () => {
    const { token } = await setup();
    const types = ['FRESH', 'HOT', 'WARM', 'COLD', 'PROSPECT'] as const;
    let n = 60;
    for (const leadType of types) {
      const res = await bearer(token)
        .post('/api/integrations/wacrm/leads')
        .send(payload({ flowRunId: runId(n++), leadType }));
      expect(res.status, leadType).toBe(201);
    }
    const rows = await db.query.findMany({ select: { leadType: true } });
    expect(rows.map((r) => r.leadType).sort()).toEqual([...types].sort());
  });

  it('all Stage values are accepted', async () => {
    const { token } = await setup();
    const stages = [
      'NEW_LEAD',
      'CONTACTED',
      'QUALIFIED',
      'QUOTATION_REQUIRED',
      'QUOTATION_SENT',
      'IN_NEGOTIATION',
      'READY_TO_BOOK',
      'BOOKING_CONFIRMED',
      'FOLLOW_UP',
      'AMENDMENT',
      'LOST',
      'CANCELLED',
      'INVALID',
      'ON_HOLD',
    ] as const;
    let n = 70;
    for (const leadStage of stages) {
      const res = await bearer(token)
        .post('/api/integrations/wacrm/leads')
        .send(payload({ flowRunId: runId(n++), leadStage }));
      expect(res.status, leadStage).toBe(201);
    }
    const rows = await db.query.findMany({ select: { leadStage: true } });
    expect(rows.map((r) => r.leadStage).sort()).toEqual([...stages].sort());
  });

  it('all Received values are accepted', async () => {
    const { token } = await setup();
    const sources = [
      'WEBSITE',
      'SOCIAL_MEDIA',
      'FACEBOOK_ADS',
      'INSTAGRAM_ADS',
      'GOOGLE_ADS',
      'WHATSAPP',
      'PHONE_CALL',
      'REFERRAL',
      'WALK_IN',
      'REPEAT_CUSTOMER',
      'PARTNER',
      'OTHER',
    ] as const;
    let n = 90;
    for (const leadSource of sources) {
      const res = await bearer(token)
        .post('/api/integrations/wacrm/leads')
        .send(payload({ flowRunId: runId(n++), leadSource }));
      expect(res.status, leadSource).toBe(201);
    }
    const rows = await db.query.findMany({ select: { leadSource: true } });
    expect(rows.map((r) => r.leadSource).sort()).toEqual([...sources].sort());
  });

  it('all six WACRM service values are accepted', async () => {
    const { token } = await setup();
    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(
        payload({
          services: ['CRUISE', 'FLIGHT', 'HOTEL', 'VEHICLE_TRANSFER', 'SIGHTSEEING', 'OTHER_ADD_ON'],
        }),
      );
    expect(res.status).toBe(201);
    const services = await db.queryService.findMany({
      where: { queryId: res.body.data.leadId },
    });
    expect(services.map((s) => s.serviceType).sort()).toEqual(
      ['CRUISE', 'FLIGHT', 'HOTEL', 'OTHER_ADD_ON', 'SIGHTSEEING', 'VEHICLE_TRANSFER'].sort(),
    );
  });
});
