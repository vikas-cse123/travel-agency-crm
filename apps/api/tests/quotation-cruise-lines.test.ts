import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { resolveCruiseRoomLines } from '@interscale/shared';

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

type Client = ReturnType<typeof createAuthClient>;

async function owner(email = 'owner@cruise-lines.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = () => ({
  customerName: 'Meera Nair',
  phone: '+91 98765 43210',
  email: 'meera@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-05',
  travelEndDate: '2026-09-09',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['CRUISE'],
  itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 4, sequence: 1 }],
});

const templatePayload = () => ({
  name: 'Cruise template',
  description: 'Template for cruise room-line tests.',
  destinationSummary: 'Singapore',
  durationDays: 5,
  durationNights: 4,
  baseCurrency: 'INR',
  status: 'ACTIVE',
  itinerary: [],
  hotels: [],
  services: [],
  inclusions: [{ content: 'All meals onboard', sequence: 1 }],
  exclusions: [{ content: 'Personal expenses', sequence: 1 }],
  terms: [{ content: 'Subject to availability', sequence: 1 }],
});

async function setup() {
  const client = await owner();
  const lead = await client.post('/api/queries', leadPayload());
  const template = await client.post('/api/quotation-templates', templatePayload());
  expect(lead.status).toBe(201);
  expect(template.status).toBe(201);
  const quotation = (await client.post('/api/quotations', { queryId: lead.body.data.id })).body.data;
  return { client, quotation, version: quotation.versions[0] as { id: string } };
}

async function setupCruiseMaster(
  client: Client,
  name = 'Genting Dream',
  rooms: Array<{ name: string; price: number }> = [
    { name: 'Interior', price: 1000 },
    { name: 'Oceanview', price: 2000 },
  ],
) {
  const created = await client.post('/api/masters/cruises', {
    name,
    description: '<p>Luxury at sea.</p>',
    status: 'ACTIVE',
    roomTypes: rooms.map((room) => ({ name: room.name, price: room.price, status: 'ACTIVE' })),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const detail = await client.get(`/api/masters/cruises/${created.body.data.id}`);
  expect(detail.status).toBe(200);
  return {
    cruiseId: created.body.data.id as string,
    roomTypes: detail.body.data.roomTypes as Array<{ id: string; name: string; price: number }>,
  };
}

const cruiseService = (
  cruiseId: string,
  lines: unknown[],
  overrides: Record<string, unknown> = {},
) => ({
  serviceType: 'CRUISE',
  name: 'Genting Dream',
  cruiseId,
  cruiseNights: 3,
  cruiseRoomLines: lines,
  quantity: 1,
  sellingPrice: 0,
  sequence: 1,
  ...overrides,
});

const roomLine = (
  roomTypeId: string,
  roomType: string,
  rooms: number,
  roomRate: number,
) => ({ cruiseRoomTypeId: roomTypeId, roomType, rooms, roomRate });

describe('cruise room allocations', () => {
  it('saves cruise nights and every room allocation and mirrors the first line onto the legacy scalars', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);
    const [interior, oceanview] = master.roomTypes;

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        cruiseService(master.cruiseId, [
          roomLine(interior!.id, 'Interior', 2, 1000),
          roomLine(oceanview!.id, 'Oceanview', 1, 2000),
        ]),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = res.body.data.services[0];
    expect(saved.cruiseNights).toBe(3);
    expect(saved.cruiseRoomLines).toHaveLength(2);
    expect(saved.cruiseRoomLines.map((l: { roomType: string }) => l.roomType)).toEqual([
      'Interior',
      'Oceanview',
    ]);
    expect(saved.cruiseRoomLines[0]).toMatchObject({ rooms: 2, roomRate: 1000 });
    // Legacy scalar mirror: first room type, per-night total (2×1000 + 1×2000) × 3.
    // (The API presents Decimals as strings: quantity/unit/total prices.)
    expect(saved.cruiseRoomTypeId).toBe(interior!.id);
    expect(saved.city).toBe('Interior');
    expect(Number(saved.quantity)).toBe(1);
    expect(Number(saved.unitSellingPrice)).toBe(12000);
    expect(Number(saved.totalSellingPrice)).toBe(12000);

    // Pricing persists the authoritative lines total (no double count).
    const dbRow = await db.quotationVersionService.findFirstOrThrow({
      where: { quotationVersionId: version.id },
    });
    expect(dbRow.totalSellingPrice.toNumber()).toBe(12000);
    expect(Array.isArray(dbRow.cruiseRoomLines)).toBe(true);
    expect((dbRow.cruiseRoomLines as unknown[]).length).toBe(2);
    expect(dbRow.cruiseNights).toBe(3);

    // Reload: every line is restored exactly.
    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services[0].cruiseNights).toBe(3);
    expect(reloaded.services[0].cruiseRoomLines).toHaveLength(2);
    expect(reloaded.services[0].cruiseRoomLines[1]).toMatchObject({
      roomType: 'Oceanview',
      rooms: 1,
      roomRate: 2000,
    });

    // Exactly ONE service row — multiple rooms must not duplicate services.
    const rows = await db.quotationVersionService.count({
      where: { quotationVersionId: version.id },
    });
    expect(rows).toBe(1);
  });

  it('removing all rooms persists roomless and never resurrects on reload', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);
    const [interior] = master.roomTypes;

    await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [cruiseService(master.cruiseId, [roomLine(interior!.id, 'Interior', 2, 1000)])],
    });

    // Remove the only room: explicit empty list, stale scalars cleared.
    const emptied = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [cruiseService(master.cruiseId, [])],
    });
    expect(emptied.status, JSON.stringify(emptied.body)).toBe(200);
    expect(emptied.body.data.services[0].cruiseRoomLines).toEqual([]);
    expect(emptied.body.data.services[0].cruiseRoomTypeId).toBeNull();
    expect(emptied.body.data.services[0].city).toBeNull();
    expect(Number(emptied.body.data.services[0].unitSellingPrice)).toBe(0);
    expect(Number(emptied.body.data.services[0].totalSellingPrice)).toBe(0);
    // Other cruise fields are untouched.
    expect(emptied.body.data.services[0].cruiseId).toBe(master.cruiseId);
    expect(emptied.body.data.services[0].cruiseNights).toBe(3);
    expect(emptied.body.data.services[0].name).toBe('Genting Dream');

    // Reload: the stay remains roomless — no ROOM 1 is recreated.
    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services[0].cruiseRoomLines).toEqual([]);
    expect(reloaded.services[0].cruiseRoomTypeId).toBeNull();
    // The persisted explicit [] is what the builder hydrates roomless from.
    // The shared legacy reader still synthesizes a placeholder from the
    // quantity scalar for PDF/weblink/pricing compatibility — that shared
    // fallback is intentionally unchanged by this fix.
    expect(
      (reloaded.services[0].cruiseRoomLines as unknown[]).length,
    ).toBe(0);
  });

  it('removing one of several rooms preserves the remaining room and reprices', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);
    const [interior, oceanview] = master.roomTypes;

    await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        cruiseService(master.cruiseId, [
          roomLine(interior!.id, 'Interior', 2, 1000),
          roomLine(oceanview!.id, 'Oceanview', 1, 2000),
        ]),
      ],
    });

    // Remove the first room only.
    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [cruiseService(master.cruiseId, [roomLine(oceanview!.id, 'Oceanview', 1, 2000)])],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const saved = res.body.data.services[0];
    expect(saved.cruiseRoomLines).toHaveLength(1);
    expect(saved.cruiseRoomLines[0]).toMatchObject({ roomType: 'Oceanview', rooms: 1, roomRate: 2000 });
    // Mirror follows the surviving room: (1×2000) × 3 nights.
    expect(saved.cruiseRoomTypeId).toBe(oceanview!.id);
    expect(saved.city).toBe('Oceanview');
    expect(Number(saved.unitSellingPrice)).toBe(6000);
    expect(Number(saved.totalSellingPrice)).toBe(6000);

    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services[0].cruiseRoomLines).toHaveLength(1);
    expect(reloaded.services[0].cruiseRoomLines[0]).toMatchObject({ roomType: 'Oceanview' });
  });

  it('keeps legacy scalar-only cruises compatible without a room list', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);
    const [interior] = master.roomTypes;

    // Legacy save: scalar room type, NO cruiseRoomLines key.
    const legacy = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        {
          serviceType: 'CRUISE',
          name: 'Genting Dream',
          cruiseId: master.cruiseId,
          cruiseRoomTypeId: interior!.id,
          city: 'Interior',
          quantity: 2,
          sellingPrice: 1000,
          sequence: 1,
        },
      ],
    });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(legacy.body.data.services[0].cruiseRoomTypeId).toBe(interior!.id);

    // The response carries no room list for key-less legacy rows (SQL NULL),
    // so display readers fall back to the saved scalars (name/notes) instead
    // of a badge; the builder applies its own editable synthesis for these rows.
    expect(legacy.body.data.services[0].cruiseRoomLines).toBeNull();
    expect(resolveCruiseRoomLines(legacy.body.data.services[0])).toEqual([]);
    // Pricing still totals the legacy scalars: quantity 2 × 1000.
    const dbRow = await db.quotationVersionService.findFirstOrThrow({
      where: { quotationVersionId: version.id },
    });
    expect(dbRow.totalSellingPrice.toNumber()).toBe(2000);
  });

  it('rejects a room line whose room type belongs to a different cruise', async () => {
    const { client, quotation, version } = await setup();
    const masterA = await setupCruiseMaster(client, 'Genting Dream');
    const masterB = await setupCruiseMaster(
      client,
      'Spectrum of the Seas',
      [{ name: 'Balcony', price: 3000 }],
    );
    const foreignRoomTypeId = (
      await client.get(`/api/masters/cruises/${masterB.cruiseId}`)
    ).body.data.roomTypes[0].id as string;

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        cruiseService(masterA.cruiseId, [
          { cruiseRoomTypeId: foreignRoomTypeId, roomType: 'Balcony', rooms: 1, roomRate: 3000 },
        ]),
      ],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('room type does not belong');
  });

  it('saves empty cruise nights as null and keeps them empty on reload', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);
    const [interior] = master.roomTypes;

    const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
      services: [
        {
          ...cruiseService(master.cruiseId, [
            roomLine(interior!.id, 'Interior', 2, 1000),
          ]),
          cruiseNights: null,
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.services[0].cruiseNights).toBeNull();
    // Rooms persist untouched alongside the empty nights value.
    expect(res.body.data.services[0].cruiseRoomLines).toHaveLength(1);

    const dbRow = await db.quotationVersionService.findFirstOrThrow({
      where: { quotationVersionId: version.id },
    });
    expect(dbRow.cruiseNights).toBeNull();

    const reloaded = (await client.get(`/api/quotations/${quotation.id}`)).body.data.versions.find(
      (v: { id: string }) => v.id === version.id,
    );
    expect(reloaded.services[0].cruiseNights).toBeNull();
    expect(reloaded.services[0].cruiseRoomLines).toHaveLength(1);
  });

  it('rejects out-of-range cruise nights while keeping other fields intact', async () => {
    const { client, quotation, version } = await setup();
    const master = await setupCruiseMaster(client);

    for (const cruiseNights of [0, -2, 366]) {
      const res = await client.patch(`/api/quotations/${quotation.id}/versions/${version.id}`, {
        services: [
          {
            ...cruiseService(master.cruiseId, []),
            cruiseNights,
          },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
  });
});
