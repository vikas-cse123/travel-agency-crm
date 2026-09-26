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

async function createCity(
  client: Awaited<ReturnType<typeof owner>>,
  name: string,
  countryCode = 'IN',
) {
  const response = await client.post('/api/masters/cities', {
    countryCode,
    name,
    airportCode: null,
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; name: string };
}

async function createDestination(
  client: Awaited<ReturnType<typeof owner>>,
  name: string,
  cityIds: string[],
  countryCode = 'IN',
) {
  const response = await client.post('/api/masters/destinations', {
    countryCode,
    name,
    destinationType: 'DOMESTIC',
    cityIds,
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; name: string };
}

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
    // Backward compatibility: every pre-existing lookup field stays present.
    for (const key of [
      'countries',
      'cities',
      'leadSources',
      'leadTypes',
      'leadStages',
      'priorities',
      'serviceTypes',
      'tripTypes',
      'currencies',
      'assignableUsers',
    ]) {
      expect(data, key).toHaveProperty(key);
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

describe('WACRM lookups: itinerary destinations come from the Destinations master', () => {
  async function setup() {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');
    return { admin, token };
  }

  it('exposes destinations + linked cities from the real masters', async () => {
    const { admin, token } = await setup();
    const jaipur = await createCity(admin, 'Wacrm Jaipur');
    const jodhpur = await createCity(admin, 'Wacrm Jodhpur');
    const destRajasthan = await createDestination(admin, 'Wacrm Rajasthan', [jaipur.id, jodhpur.id]);

    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.destinations).toEqual(
      expect.arrayContaining([{ value: destRajasthan.id, label: 'Wacrm Rajasthan' }]),
    );
    expect(data.cities).toEqual(
      expect.arrayContaining([
        { value: jaipur.id, label: 'Wacrm Jaipur', destinationValue: destRajasthan.id },
        { value: jodhpur.id, label: 'Wacrm Jodhpur', destinationValue: destRajasthan.id },
      ]),
    );
  });

  it('preserves the exact Destination → City relationship across destinations', async () => {
    const { admin, token } = await setup();
    const north = await createCity(admin, 'Wacrm North City');
    const south = await createCity(admin, 'Wacrm South City');
    const destNorth = await createDestination(admin, 'Wacrm North Dest', [north.id]);
    const destSouth = await createDestination(admin, 'Wacrm South Dest', [south.id]);

    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    const cities = res.body.data.cities as Array<{
      value: string;
      label: string;
      destinationValue: string;
    }>;
    const byValue = new Map(cities.map((c) => [c.value, c]));
    // Every city references its own parent destination — never a sibling's.
    expect(byValue.get(north.id)).toMatchObject({ destinationValue: destNorth.id });
    expect(byValue.get(south.id)).toMatchObject({ destinationValue: destSouth.id });
    expect(byValue.get(north.id)?.destinationValue).not.toBe(destSouth.id);
    expect(byValue.get(south.id)?.destinationValue).not.toBe(destNorth.id);
  });

  it('excludes archived destinations and inactive cities', async () => {
    const { admin, token } = await setup();
    const activeCity = await createCity(admin, 'Wacrm Active City');
    const retiringCity = await createCity(admin, 'Wacrm Retiring City');
    const live = await createDestination(admin, 'Wacrm Live Dest', [activeCity.id]);
    const retiring = await createDestination(admin, 'Wacrm Retiring Dest', [retiringCity.id]);

    expect((await admin.delete(`/api/masters/destinations/${retiring.id}`)).status).toBe(200);
    expect(
      (await admin.patch(`/api/masters/cities/${retiringCity.id}/status`, { status: 'INACTIVE' }))
        .status,
    ).toBe(200);

    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    const data = res.body.data;
    const destValues = (data.destinations as Array<{ value: string }>).map((d) => d.value);
    const cityValues = (data.cities as Array<{ value: string }>).map((c) => c.value);
    expect(destValues).toContain(live.id);
    expect(destValues).not.toContain(retiring.id);
    expect(cityValues).toContain(activeCity.id);
    expect(cityValues).not.toContain(retiringCity.id);
  });

  it('uses live master ids — never hardcoded values', async () => {
    const { admin, token } = await setup();
    const city = await createCity(admin, 'Wacrm Unique City');
    const dest = await createDestination(admin, 'Wacrm Unique Dest', [city.id]);

    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    // Ids are generated per test run, so matching them proves the feed
    // reads the database rather than returning canned values.
    expect(JSON.stringify(res.body.data.destinations)).toContain(dest.id);
    expect(JSON.stringify(res.body.data.cities)).toContain(city.id);
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

describe('WACRM integration credential authentication', () => {
  async function setup() {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');
    const user = await db.user.findFirstOrThrow({
      where: { normalizedEmail: 'owner@alpha.test', deletedAt: null },
    });
    return { admin, token, user };
  }

  it('valid database-backed credential accesses GET /api/integrations/wacrm/lookups', async () => {
    const { token } = await setup();
    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.data).toHaveProperty('destinations');
    expect(res.body.data).toHaveProperty('cities');
  });

  it('well-formed unknown secret and malformed tokens are rejected on lookups', async () => {
    await setup();
    expect(
      (await bearer('wacrm_' + '0'.repeat(43)).get('/api/integrations/wacrm/lookups')).status,
    ).toBe(401);
    expect((await bearer('garbage').get('/api/integrations/wacrm/lookups')).status).toBe(401);
    // GET skips the Origin check (safe method), so a missing Bearer
    // token reaches integration auth and is rejected as unauthorized.
    expect((await request(app).get('/api/integrations/wacrm/lookups')).status).toBe(401);
  });

  it('revoked credential is rejected on lookups', async () => {
    const { admin, token } = await setup();
    const list = await admin.get('/api/integrations/credentials');
    const id = list.body.data[0].id as string;
    expect((await admin.delete(`/api/integrations/credentials/${id}`)).status).toBe(200);
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);
  });

  it('expired credential is rejected on lookups', async () => {
    const { token, user } = await setup();
    const credential = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: user.companyId, revokedAt: null },
    });
    await db.integrationCredential.update({
      where: { id: credential.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);
  });

  it('inactive and deleted service users are rejected on lookups', async () => {
    const { token, user } = await setup();
    await db.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);
    await db.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', deletedAt: new Date() },
    });
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);
  });

  it('inactive company is rejected on lookups', async () => {
    const { token, user } = await setup();
    await db.company.update({ where: { id: user.companyId }, data: { status: 'INACTIVE' } });
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);
  });

  it('service user without queries.view gets 403 on lookups (permission behavior kept)', async () => {
    const { token, user } = await setup();
    const permission = await db.permission.findFirstOrThrow({ where: { key: 'queries.view' } });
    const removed = await db.rolePermission.deleteMany({
      where: { roleId: user.roleId, permissionId: permission.id },
    });
    expect(removed.count).toBe(1);
    // Authentication succeeds (valid hash) but authorization fails:
    // 403, never 401, and never a success payload.
    const res = await bearer(token).get('/api/integrations/wacrm/lookups');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false });
  });

  it('integration auth needs no TRAVEL_CRM_INTEGRATION_SECRET and stores no plaintext secret', async () => {
    // The plaintext secret belongs only to the WACRM caller: Travel CRM
    // validates the presented Bearer value against the stored SHA-256
    // hash, so no shared-secret env var exists here.
    expect(process.env.TRAVEL_CRM_INTEGRATION_SECRET).toBeUndefined();
    const { token } = await setup();
    const stored = await db.integrationCredential.findFirstOrThrow({});
    expect(stored.keyHash).toHaveLength(64);
    expect(stored.keyHash).not.toContain('wacrm_');
    expect(token).toContain('wacrm_');
    // Only the hash is persisted — the presented token is unrecoverable
    // from the database row.
    expect(stored.keyHash).not.toContain(token.slice('wacrm_'.length));
  });

  it('no plaintext WACRM secret is hardcoded in Travel CRM source', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      '../src/middleware/wacrm-auth.middleware.ts',
      '../src/modules/integrations/wacrm.service.ts',
      '../src/modules/integrations/wacrm.controller.ts',
      '../src/modules/integrations/credentials.service.ts',
      '../src/modules/integrations/integrations.routes.ts',
    ];
    for (const relative of files) {
      const content = readFileSync(join(here, relative), 'utf8');
      // A real presented token is `wacrm_` + 43 secret chars; the
      // prefix constant alone (`wacrm_`) must not trip this check.
      expect(content, relative).not.toMatch(/wacrm_[A-Za-z0-9_-]{20,}/);
    }
  });
});

describe('WACRM per-account permanent credential', () => {
  async function setupCompany(ownerEmail: string, companyName: string, salesEmail: string) {
    const admin = await owner(ownerEmail, companyName);
    await employeeEmail(admin, salesEmail);
    const token = await mintToken(admin, ownerEmail);
    const user = await db.user.findFirstOrThrow({
      where: { normalizedEmail: ownerEmail, deletedAt: null },
    });
    return { admin, token, user };
  }

  async function liveCredentialCount(companyId: string) {
    return db.integrationCredential.count({
      where: {
        companyId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  it('repeat setup does not duplicate the credential; the same secret keeps working', async () => {
    const { admin, token, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const second = await admin.post('/api/integrations/credentials', {
      name: 'wacrm-sync-again',
      userId: user.id,
    });
    expect(second.status).toBe(409);
    expect(await liveCredentialCount(user.companyId)).toBe(1);
    // The original permanent secret is unaffected by the refused mint.
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(200);
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('explicit revoke then mint rotates to exactly one live credential', async () => {
    const { admin, token, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const list = await admin.get('/api/integrations/credentials');
    const id = list.body.data[0].id as string;
    expect((await admin.delete(`/api/integrations/credentials/${id}`)).status).toBe(200);
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);

    const rotated = await admin.post('/api/integrations/credentials', {
      name: 'wacrm-sync-rotated',
      userId: user.id,
    });
    expect(rotated.status).toBe(201);
    expect(typeof rotated.body.data.token).toBe('string');
    expect(await liveCredentialCount(user.companyId)).toBe(1);
    const newToken = rotated.body.data.token as string;
    expect(newToken).not.toBe(token);
    expect((await bearer(newToken).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('an expired credential no longer blocks minting its replacement', async () => {
    const { admin, token, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const credential = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: user.companyId, revokedAt: null },
    });
    await db.integrationCredential.update({
      where: { id: credential.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await bearer(token).get('/api/integrations/wacrm/lookups')).status).toBe(401);

    const replacement = await admin.post('/api/integrations/credentials', {
      name: 'wacrm-sync-replacement',
      userId: user.id,
    });
    expect(replacement.status).toBe(201);
    expect(await liveCredentialCount(user.companyId)).toBe(1);
  });

  it("account A's secret authenticates A only and never B", async () => {
    const alpha = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const beta = await setupCompany('owner@beta.test', 'Beta Travel', 'sales@beta.test');
    // Company-scoped proof: a Destinations master row in Alpha is
    // visible through Alpha's credential and invisible through Beta's.
    const city = await createCity(alpha.admin, 'Alpha Only City');
    const dest = await createDestination(alpha.admin, 'Alpha Only Dest', [city.id]);

    const resA = await bearer(alpha.token).get('/api/integrations/wacrm/lookups');
    expect(resA.status).toBe(200);
    expect(resA.body.data.destinations).toEqual(
      expect.arrayContaining([{ value: dest.id, label: 'Alpha Only Dest' }]),
    );

    const resB = await bearer(beta.token).get('/api/integrations/wacrm/lookups');
    expect(resB.status).toBe(200);
    const destValuesB = (resB.body.data.destinations as Array<{ value: string }>).map(
      (d) => d.value,
    );
    expect(destValuesB).not.toContain(dest.id);

    // One live credential per company, each bound to its own company.
    expect(await liveCredentialCount(alpha.user.companyId)).toBe(1);
    expect(await liveCredentialCount(beta.user.companyId)).toBe(1);
    const rowA = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: alpha.user.companyId, revokedAt: null },
    });
    const rowB = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: beta.user.companyId, revokedAt: null },
    });
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.keyHash).not.toBe(rowB.keyHash);
  });
});

describe('WACRM credential reconciliation of a caller-owned secret', () => {
  // Synthetic tokens only — these fixtures never touch a real secret.
  const synthetic = (tag: string) => `wacrm_test_reconcile_${tag}_${'x'.repeat(16)}`;

  async function setupCompany(ownerEmail: string, companyName: string, salesEmail: string) {
    const admin = await owner(ownerEmail, companyName);
    await employeeEmail(admin, salesEmail);
    const user = await db.user.findFirstOrThrow({
      where: { normalizedEmail: ownerEmail, deletedAt: null },
    });
    return { admin, user };
  }

  it('derived parts match the mint implementation and reject malformed input', async () => {
    const { deriveIntegrationCredentialParts, mintIntegrationToken } = await import(
      '../src/middleware/wacrm-auth.middleware.js'
    );
    const minted = mintIntegrationToken();
    expect(deriveIntegrationCredentialParts(minted.presented)).toEqual({
      prefix: minted.prefix,
      hash: minted.hash,
    });
    for (const bad of ['', 'garbage', 'wacrm_', `wacrm_${'y'.repeat(200)}`]) {
      expect(() => deriveIntegrationCredentialParts(bad)).toThrow();
    }
  });

  it('reconcile stores hash-only and the secret authenticates lookups', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const presented = synthetic('alpha');

    const result = await credentialsService.reconcile({
      companyId: user.companyId,
      userId: user.id,
      presented,
      name: 'wacrm-sync',
    });
    expect(result.created).toBe(true);

    const stored = await db.integrationCredential.findFirstOrThrow({ where: { id: result.id } });
    expect(stored.keyHash).toHaveLength(64);
    expect(stored.keyHash).not.toContain('wacrm_');
    expect(JSON.stringify(stored)).not.toContain(presented);

    expect((await bearer(presented).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('reconciling the same secret twice stays at one row (idempotent)', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const presented = synthetic('idem');

    const first = await credentialsService.reconcile({
      companyId: user.companyId,
      userId: user.id,
      presented,
      name: 'wacrm-sync',
    });
    const second = await credentialsService.reconcile({
      companyId: user.companyId,
      userId: user.id,
      presented,
      name: 'wacrm-sync',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(
      await db.integrationCredential.count({
        where: { companyId: user.companyId, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('reconciling a different secret while one is live is refused', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    await credentialsService.reconcile({
      companyId: user.companyId,
      userId: user.id,
      presented: synthetic('first'),
      name: 'wacrm-sync',
    });
    await expect(
      credentialsService.reconcile({
        companyId: user.companyId,
        userId: user.id,
        presented: synthetic('second'),
        name: 'wacrm-sync',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      await db.integrationCredential.count({
        where: { companyId: user.companyId, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('reconcile rejects malformed secrets and cross-company users', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const beta = await setupCompany('owner@beta.test', 'Beta Travel', 'sales@beta.test');
    await expect(
      credentialsService.reconcile({
        companyId: user.companyId,
        userId: user.id,
        presented: 'not-a-token',
        name: 'wacrm-sync',
      }),
    ).rejects.toThrow();
    await expect(
      credentialsService.reconcile({
        companyId: user.companyId,
        userId: beta.user.id,
        presented: synthetic('cross'),
        name: 'wacrm-sync',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('WACRM credential reconciliation by owner email', () => {
  const synthetic = (tag: string) => `wacrm_test_owner_${tag}_${'x'.repeat(16)}`;

  async function setupCompany(ownerEmail: string, companyName: string, salesEmail: string) {
    const admin = await owner(ownerEmail, companyName);
    await employeeEmail(admin, salesEmail);
    const user = await db.user.findFirstOrThrow({
      where: { normalizedEmail: ownerEmail, deletedAt: null },
    });
    const sales = await db.user.findFirstOrThrow({
      where: { normalizedEmail: salesEmail, deletedAt: null },
    });
    return { admin, user, sales };
  }

  it('owner email resolves to the owner company and owner service user', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const presented = synthetic('owner');

    const result = await credentialsService.reconcileByOwnerEmail({
      ownerEmail: '  OWNER@alpha.test ',
      presented,
      name: 'wacrm-sync',
    });
    expect(result.created).toBe(true);
    expect(result.companyId).toBe(user.companyId);
    expect(result.userId).toBe(user.id);

    const stored = await db.integrationCredential.findFirstOrThrow({ where: { id: result.id } });
    expect(stored.companyId).toBe(user.companyId);
    expect(stored.userId).toBe(user.id);
    expect(stored.keyHash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain(presented);

    expect((await bearer(presented).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('regular user email resolves to that user company and user', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user, sales } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const presented = synthetic('sales');

    const result = await credentialsService.reconcileByOwnerEmail({
      ownerEmail: 'sales@alpha.test',
      presented,
      name: 'wacrm-sync',
    });
    expect(result.created).toBe(true);
    expect(result.companyId).toBe(user.companyId);
    expect(result.userId).toBe(sales.id);

    // The secret passes Bearer authentication (a non-401 proves auth
    // accepted it; authorization depends on the member's permissions).
    expect((await bearer(presented).get('/api/integrations/wacrm/lookups')).status).not.toBe(401);
  });

  it('unknown and deleted-only emails fail with a clear error', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    const { user } = await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    await expect(
      credentialsService.reconcileByOwnerEmail({
        ownerEmail: 'nobody@alpha.test',
        presented: synthetic('missing'),
        name: 'wacrm-sync',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await expect(
      credentialsService.reconcileByOwnerEmail({
        ownerEmail: 'owner@alpha.test',
        presented: synthetic('deleted'),
        name: 'wacrm-sync',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      await db.integrationCredential.count({ where: { companyId: user.companyId } }),
    ).toBe(0);
  });

  it('email rematch is idempotent, a different live secret conflicts', async () => {
    const { credentialsService } = await import(
      '../src/modules/integrations/credentials.service.js'
    );
    await setupCompany('owner@alpha.test', 'Alpha Travel', 'sales@alpha.test');
    const presented = synthetic('stable');

    const first = await credentialsService.reconcileByOwnerEmail({
      ownerEmail: 'owner@alpha.test',
      presented,
      name: 'wacrm-sync',
    });
    const second = await credentialsService.reconcileByOwnerEmail({
      ownerEmail: 'owner@alpha.test',
      presented,
      name: 'wacrm-sync',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    await expect(
      credentialsService.reconcileByOwnerEmail({
        ownerEmail: 'owner@alpha.test',
        presented: synthetic('other'),
        name: 'wacrm-sync',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('WACRM credential import of the caller-owned secret', () => {
  // Synthetic tokens only — these fixtures never touch a real secret.
  // Each tag yields a distinct 12-char key prefix on purpose: the schema
  // enforces one row per (company, prefix), so sharing a prefix across
  // different test secrets would collide for realistic reasons.
  const synthetic = (tag: string) => `wacrm_${tag}_${'x'.repeat(24)}`;

  async function setupCompany(ownerEmail: string, companyName: string, salesEmail: string) {
    const admin = await owner(ownerEmail, companyName);
    await employeeEmail(admin, salesEmail);
    const user = await db.user.findFirstOrThrow({
      where: { normalizedEmail: ownerEmail, deletedAt: null },
    });
    return { admin, user };
  }

  async function liveCredentials(companyId: string) {
    return db.integrationCredential.findMany({
      where: {
        companyId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  function importBody(userId: string, secret: string, name = 'wacrm-sync') {
    return { name, userId, secret };
  }

  it('import registers the existing secret; it authenticates lookups immediately', async () => {
    const { deriveIntegrationCredentialParts } = await import(
      '../src/middleware/wacrm-auth.middleware.js'
    );
    const { admin, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const presented = synthetic('importfresh');
    const expected = deriveIntegrationCredentialParts(presented);

    const res = await admin.post('/api/integrations/credentials/import', 
      importBody(user.id, presented),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.data).toMatchObject({ companyId: user.companyId, userId: user.id });

    // The response carries metadata only — never the plaintext.
    expect(JSON.stringify(res.body)).not.toContain(presented);

    const stored = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: user.companyId, revokedAt: null },
    });
    expect(stored.keyPrefix).toBe(expected.prefix);
    expect(stored.keyHash).toBe(expected.hash);
    expect(JSON.stringify(stored)).not.toContain(presented);

    expect((await bearer(presented).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('importing the same secret again is idempotent (no duplicate)', async () => {
    const { admin, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const presented = synthetic('importidem1');

    const first = await admin.post('/api/integrations/credentials/import', 
      importBody(user.id, presented),
    );
    const second = await admin.post('/api/integrations/credentials/import', 
      importBody(user.id, presented),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await liveCredentials(user.companyId)).toHaveLength(1);
  });

  it('importing a different secret while one is live returns 409', async () => {
    const { admin, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const liveToken = synthetic('importlive1');
    expect(
      (await admin.post('/api/integrations/credentials/import', 
        importBody(user.id, liveToken),
      )).status,
    ).toBe(201);

    const conflict = await admin.post('/api/integrations/credentials/import', 
      importBody(user.id, synthetic('importoth1')),
    );
    expect(conflict.status).toBe(409);
    expect(await liveCredentials(user.companyId)).toHaveLength(1);
    expect((await bearer(liveToken).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('revoked or expired credentials can be replaced through import', async () => {
    const { admin, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const stale = synthetic('importstale');
    expect(
      (await admin.post('/api/integrations/credentials/import', importBody(user.id, stale)))
        .status,
    ).toBe(201);
    const row = await db.integrationCredential.findFirstOrThrow({
      where: { companyId: user.companyId, revokedAt: null },
    });
    expect((await admin.delete(`/api/integrations/credentials/${row.id}`)).status).toBe(200);

    const presented = synthetic('importnew01');
    const res = await admin.post('/api/integrations/credentials/import', 
      importBody(user.id, presented),
    );
    expect(res.status).toBe(201);
    expect(await liveCredentials(user.companyId)).toHaveLength(1);
    expect((await bearer(presented).get('/api/integrations/wacrm/lookups')).status).toBe(200);
  });

  it('import rejects bad input without creating rows', async () => {
    const { admin, user } = await setupCompany(
      'owner@alpha.test',
      'Alpha Travel',
      'sales@alpha.test',
    );
    const beta = await setupCompany('owner@beta.test', 'Beta Travel', 'sales@beta.test');

    // Unauthenticated (trusted origin so the request reaches session auth).
    expect(
      (
        await request(app)
          .post('/api/integrations/credentials/import')
          .set('Origin', 'http://localhost:5173')
          .send(importBody(user.id, synthetic('noauth00001')))
      ).status,
    ).toBe(401);
    // Malformed secret (long enough to pass input validation, wrong shape).
    expect(
      (
        await admin.post('/api/integrations/credentials/import', 
          importBody(user.id, 'invalid-secret-value'),
        )
      ).status,
    ).toBe(400);
    // Service user from another company.
    expect(
      (
        await admin.post('/api/integrations/credentials/import', 
          importBody(beta.user.id, synthetic('crosscomp1')),
        )
      ).status,
    ).toBe(400);
    expect(await db.integrationCredential.count()).toBe(0);
  });

  it('no secret-bearing environment wiring remains in Travel CRM source', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith('.ts')) continue;
        const content = readFileSync(full, 'utf8');
        if (
          content.includes('WACRM_RECONCILE_TOKEN') ||
          content.includes('WACRM_OWNER_EMAIL') ||
          /wacrm_[A-Za-z0-9_-]{20,}/.test(content)
        ) {
          offenders.push(full);
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
    // server.ts boots with no credential provisioning hook.
    const server = readFileSync(join(src, 'server.ts'), 'utf8');
    expect(server).not.toContain('reconcile');
    expect(server).not.toContain('wacrm-bootstrap');
  });
});
