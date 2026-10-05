import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import {
  storageService,
  type MemoryStorageService,
} from '../src/services/storage/storage.service.js';
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

async function owner(email = 'owner@masters.test', companyName = 'Master Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function roleClient(ownerEmail: string, roleName: string, email: string) {
  const ownerUser = await db.user.findUniqueOrThrow({ where: { normalizedEmail: ownerEmail } });
  const role = await db.role.findFirstOrThrow({
    where: { companyId: ownerUser.companyId, name: roleName },
  });
  await db.user.create({
    data: {
      companyId: ownerUser.companyId,
      roleId: role.id,
      username: email.split('@')[0]!,
      fullName: `${roleName} User`,
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword('Sales@2026'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const client = createAuthClient(app);
  expect(
    (await client.post('/api/auth/login', { email, password: 'Sales@2026', rememberMe: false }))
      .status,
  ).toBe(200);
  return client;
}

async function createCity(client: Awaited<ReturnType<typeof owner>>, name = 'Jaipur') {
  const response = await client.post('/api/masters/cities', {
    countryCode: 'IN',
    name,
    airportCode: name === 'Jaipur' ? 'JAI' : null,
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string };
}

async function createDestination(
  client: Awaited<ReturnType<typeof owner>>,
  cityIds: string[],
  name = 'Rajasthan Highlights',
) {
  const response = await client.post('/api/masters/destinations', {
    countryCode: 'IN',
    name,
    destinationType: 'DOMESTIC',
    cityIds,
    inclusions: '<p>Breakfast and <strong>transfers</strong></p>',
    exclusions: null,
    paymentPolicies: null,
    cancellationPolicies: null,
    bookingTerms: null,
    status: 'ACTIVE',
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; cities: Array<{ cityId: string }> };
}

describe('Phase 13A cities and destinations masters', () => {
  it('validates city input and supports pagination, search, country, status, and sorting', async () => {
    const client = await owner();
    expect(
      (
        await client.post('/api/masters/cities', {
          countryCode: 'IN',
          name: '',
          airportCode: 'DE',
        })
      ).status,
    ).toBe(400);
    await createCity(client, 'Udaipur');
    const jaipur = await createCity(client);
    await client.patch(`/api/masters/cities/${jaipur.id}/status`, { status: 'INACTIVE' });
    const otherCountry = await client.post('/api/masters/cities', {
      countryCode: 'AE',
      name: 'Udaipur',
      airportCode: null,
      status: 'ACTIVE',
    });
    expect(otherCountry.status).toBe(201);
    const result = await client.get(
      '/api/masters/cities?page=1&pageSize=1&search=udai&country=IN&status=ACTIVE&sortBy=name&sortOrder=desc',
    );
    expect(result.status).toBe(200);
    expect(result.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(result.body.data.data[0]).toMatchObject({ name: 'Udaipur', countryCode: 'IN' });
  });

  it('provides country lookups and normalized, tenant-scoped city CRUD', async () => {
    const client = await owner();
    const lookup = await client.get('/api/masters/cities/lookups?country=IN&search=jai');
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.countries).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IN', name: 'India' })]),
    );

    const city = await createCity(client);
    const duplicate = await client.post('/api/masters/cities', {
      countryCode: 'in',
      name: '  JAIPUR  ',
      airportCode: 'jai',
      status: 'ACTIVE',
    });
    expect(duplicate.status).toBe(409);
    const updated = await client.patch(`/api/masters/cities/${city.id}`, {
      name: 'Jaipur City',
      airportCode: 'JAI',
    });
    expect(updated.body.data).toMatchObject({
      countryCode: 'IN',
      countryName: 'India',
      name: 'Jaipur City',
      airportCode: 'JAI',
    });
    expect(updated.body.data).not.toHaveProperty('companyId');
    expect(updated.body.data).not.toHaveProperty('normalizedName');

    const other = await owner('other@masters.test', 'Other Master Travel');
    expect((await other.get(`/api/masters/cities/${city.id}`)).status).toBe(404);
  });

  it('creates ordered same-country destination cities and sanitizes rich text', async () => {
    const client = await owner();
    const jaipur = await createCity(client);
    const jodhpur = await createCity(client, 'Jodhpur');
    const destination = await createDestination(client, [jaipur.id, jodhpur.id]);
    const updated = await client.patch(`/api/masters/destinations/${destination.id}`, {
      cityIds: [jodhpur.id, jaipur.id],
      inclusions:
        '<p onclick="steal()">Safe</p><script>alert(1)</script><a href="javascript:bad">Link</a>',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.cities.map((link: { cityId: string }) => link.cityId)).toEqual([
      jodhpur.id,
      jaipur.id,
    ]);
    expect(updated.body.data.inclusions).toContain('<p>Safe</p>');
    expect(updated.body.data.inclusions).not.toContain('onclick');
    expect(updated.body.data.inclusions).not.toContain('<script');
    expect(updated.body.data.inclusions).not.toContain('javascript:');

    // The rich-text editor emits <div> per line (Chrome contentEditable),
    // alignment attributes, and font colors — none of that may be lost on save.
    const formatted = await client.patch(`/api/masters/destinations/${destination.id}`, {
      inclusions:
        '<div><strong>Heading</strong></div><div>Second line</div><ul><li>Bullet one</li><li>Bullet two</li></ul><ol><li>Step one</li></ol><div align="center">Centered</div><div>Colored <font color="#ff0000">text</font></div><em>i</em><u>u</u><s>s</s><pre>code</pre>',
    });
    expect(formatted.status).toBe(200);
    expect(formatted.body.data.inclusions).toContain('<div><strong>Heading</strong></div>');
    expect(formatted.body.data.inclusions).toContain('<div>Second line</div>');
    expect(formatted.body.data.inclusions).toContain('<ul><li>Bullet one</li><li>Bullet two</li></ul>');
    expect(formatted.body.data.inclusions).toContain('<ol><li>Step one</li></ol>');
    expect(formatted.body.data.inclusions).toContain('<div align="center">Centered</div>');
    expect(formatted.body.data.inclusions).toContain('<font color="#ff0000">text</font>');
    expect(formatted.body.data.inclusions).toContain('<em>i</em>');
    expect(formatted.body.data.inclusions).toContain('<u>u</u>');
    expect(formatted.body.data.inclusions).toContain('<s>s</s>');
    expect(formatted.body.data.inclusions).toContain('<pre>code</pre>');
    // Plain-text values (Excel imports) pass through with their bullets intact.
    const plain = await client.patch(`/api/masters/destinations/${destination.id}`, {
      inclusions: '• Airfare\n• Visa fees',
    });
    expect(plain.status).toBe(200);
    expect(plain.body.data.inclusions).toBe('• Airfare\n• Visa fees');
    expect(updated.body.data).not.toHaveProperty('imageObjectKey');

    const dubai = await client.post('/api/masters/cities', {
      countryCode: 'AE',
      name: 'Dubai',
      airportCode: 'DXB',
      status: 'ACTIVE',
    });
    expect(
      (
        await client.patch(`/api/masters/destinations/${destination.id}`, {
          cityIds: [dubai.body.data.id],
        })
      ).status,
    ).toBe(400);
  });

  it('supports domestic/international uniqueness, destination filters, counts, and isolation', async () => {
    const client = await owner();
    const jaipur = await createCity(client);
    const domestic = await createDestination(client, [jaipur.id]);
    const duplicate = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: '  RAJASTHAN HIGHLIGHTS ',
      destinationType: 'INTERNATIONAL',
      cityIds: [jaipur.id],
      status: 'ACTIVE',
    });
    expect(duplicate.status).toBe(409);
    const international = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'International India Circuit',
      destinationType: 'INTERNATIONAL',
      cityIds: [jaipur.id],
      status: 'ACTIVE',
    });
    expect(international.status).toBe(201);
    const list = await client.get(
      `/api/masters/destinations?page=1&pageSize=1&search=international&country=IN&destinationType=INTERNATIONAL&cityId=${jaipur.id}&sortBy=cityCount&sortOrder=desc`,
    );
    expect(list.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(list.body.data.data[0]).toMatchObject({
      id: international.body.data.id,
      destinationType: 'INTERNATIONAL',
      _count: { cities: 1 },
    });
    const other = await owner('isolated@masters.test', 'Isolated Masters');
    expect((await other.get(`/api/masters/destinations/${domestic.id}`)).status).toBe(404);
    expect(
      (
        await other.post(`/api/masters/destinations/${domestic.id}/cities`, {
          cityId: jaipur.id,
        })
      ).status,
    ).toBe(404);
  });

  it('hard-deletes unreferenced cities and blocks deletion of referenced ones', async () => {
    const client = await owner();
    const city = await createCity(client);
    const destination = await createDestination(client, [city.id]);
    // Referenced by a destination → 409, nothing removed.
    const blocked = await client.delete(`/api/masters/cities/${city.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/being used/i);
    expect(await db.city.findUnique({ where: { id: city.id } })).not.toBeNull();
    // Destination with no other blockers → hard delete cascades its city links.
    expect((await client.delete(`/api/masters/destinations/${destination.id}`)).status).toBe(200);
    expect(await db.destination.findUnique({ where: { id: destination.id } })).toBeNull();
    expect(await db.destinationCity.count({ where: { destinationId: destination.id } })).toBe(0);
    // City is now unreferenced → hard delete removes the row.
    const removed = await client.delete(`/api/masters/cities/${city.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, id: city.id });
    expect(await db.city.findUnique({ where: { id: city.id } })).toBeNull();
    expect((await client.delete(`/api/masters/cities/${city.id}`)).status).toBe(404);
  });

  it('enforces role permissions and active-only visibility for read-only roles', async () => {
    const client = await owner();
    const active = await createCity(client);
    const inactive = await createCity(client, 'Udaipur');
    await client.patch(`/api/masters/cities/${inactive.id}/status`, { status: 'INACTIVE' });
    const sales = await roleClient('owner@masters.test', 'Sales Executive', 'sales@masters.test');
    const salesList = await sales.get('/api/masters/cities?status=INACTIVE');
    expect(salesList.status).toBe(200);
    expect(salesList.body.data.data.map((row: { id: string }) => row.id)).toEqual([active.id]);
    expect(
      (
        await sales.post('/api/masters/cities', {
          countryCode: 'IN',
          name: 'Pushkar',
          status: 'ACTIVE',
        })
      ).status,
    ).toBe(403);

    const dataEntry = await roleClient(
      'owner@masters.test',
      'Data Entry',
      'data-entry@masters.test',
    );
    expect(
      (
        await dataEntry.post('/api/masters/cities', {
          countryCode: 'IN',
          name: 'Pushkar',
          status: 'ACTIVE',
        })
      ).status,
    ).toBe(201);
    expect((await dataEntry.delete(`/api/masters/cities/${active.id}`)).status).toBe(403);
  });

  it('approves, verifies, serves and deletes tenant-keyed destination images', async () => {
    const client = await owner();
    const city = await createCity(client);
    const destination = await createDestination(client, [city.id]);
    const body = Buffer.from('fake-png-content');
    const approval = await client.post(`/api/masters/destinations/${destination.id}/image/upload`, {
      fileName: '../../Palace View.png',
      mimeType: 'image/png',
      fileSize: body.length,
    });
    expect(approval.status).toBe(201);
    expect(approval.body.data.uploadUrl).toMatch(/^memory:\/\/upload\//);
    expect(JSON.stringify(approval.body.data)).not.toContain('companies/');
    const pending = await db.destination.findUniqueOrThrow({ where: { id: destination.id } });
    expect(pending.pendingImageObjectKey).toMatch(
      new RegExp(`^companies/${pending.companyId}/masters/destinations/${destination.id}/images/`),
    );
    expect(pending.pendingImageObjectKey).not.toContain('..');
    await (storageService as MemoryStorageService).putObject({
      key: pending.pendingImageObjectKey!,
      body,
      contentType: 'image/png',
    });
    const confirmed = await client.post(
      `/api/masters/destinations/${destination.id}/image/confirm`,
    );
    expect(confirmed.body.data).toMatchObject({ hasImage: true, imageMimeType: 'image/png' });
    expect(confirmed.body.data.images).toHaveLength(1);
    expect(confirmed.body.data).not.toHaveProperty('imageObjectKey');
    const download = await client.get(
      `/api/masters/destinations/${destination.id}/image/download-url`,
    );
    expect(download.body.data.url).toMatch(/^memory:\/\/download\//);
    expect((await client.delete(`/api/masters/destinations/${destination.id}/image`)).status).toBe(
      200,
    );
    // Confirmed objects are retained because an older quotation snapshot may
    // still reference them after the master removes the image.
    expect((storageService as MemoryStorageService).read(pending.pendingImageObjectKey!)).toEqual(
      body,
    );
  });

  it('presents and downloads a sparse legacy single-image row as a one-image gallery', async () => {
    const client = await owner();
    const city = await createCity(client);
    const destination = await createDestination(client, [city.id]);
    const stored = await db.destination.findUniqueOrThrow({ where: { id: destination.id } });
    const objectKey = `companies/${stored.companyId}/masters/destinations/${destination.id}/images/legacy.jpg`;
    const body = Buffer.from('legacy-image');
    await (storageService as MemoryStorageService).putObject({
      key: objectKey,
      body,
      contentType: 'image/jpeg',
    });
    await db.destination.update({
      where: { id: destination.id },
      data: {
        imageObjectKey: objectKey,
        imageFileName: 'legacy.jpg',
        imageMimeType: null,
        imageFileSize: null,
        imageConfirmedAt: new Date('2026-08-20T10:00:00.000Z'),
      },
    });

    const detail = await client.get(`/api/masters/destinations/${destination.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.images).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^legacy-[a-f0-9]{32}$/),
        fileName: 'legacy.jpg',
        mimeType: 'image/jpeg',
        fileSize: 0,
        isPrimary: true,
      }),
    ]);
    expect(JSON.stringify(detail.body.data)).not.toContain(objectKey);
    const imageId = detail.body.data.images[0].id as string;

    const defaultDownload = await client.get(
      `/api/masters/destinations/${destination.id}/image/download-url`,
    );
    expect(defaultDownload.status).toBe(200);
    expect(defaultDownload.body.data.url).toMatch(/^memory:\/\/download\//);
    const selectedDownload = await client.get(
      `/api/masters/destinations/${destination.id}/image/download-url?imageId=${imageId}`,
    );
    expect(selectedDownload.status).toBe(200);
    expect(selectedDownload.body.data.url).toMatch(/^memory:\/\/download\//);
  });

  it('appends, reorders and removes images without replacing storage or crossing tenants', async () => {
    const client = await owner();
    const city = await createCity(client);
    const destination = await createDestination(client, [city.id]);
    expect(
      (
        await client.post(`/api/masters/destinations/${destination.id}/image/upload`, {
          fileName: 'payload.svg',
          mimeType: 'image/svg+xml',
          fileSize: 10,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(`/api/masters/destinations/${destination.id}/image/upload`, {
          fileName: 'too-large.png',
          mimeType: 'image/png',
          fileSize: 6 * 1024 * 1024,
        })
      ).status,
    ).toBe(400);

    const firstBody = Buffer.from('first-image');
    await client.post(`/api/masters/destinations/${destination.id}/image/upload`, {
      fileName: 'first.png',
      mimeType: 'image/png',
      fileSize: firstBody.length,
    });
    let row = await db.destination.findUniqueOrThrow({ where: { id: destination.id } });
    const firstKey = row.pendingImageObjectKey!;
    await (storageService as MemoryStorageService).putObject({
      key: firstKey,
      body: firstBody,
      contentType: 'image/png',
    });
    const firstConfirmed = await client.post(
      `/api/masters/destinations/${destination.id}/image/confirm`,
    );
    const firstImageId = firstConfirmed.body.data.images[0].id as string;

    const secondBody = Buffer.from('second-image');
    await client.post(`/api/masters/destinations/${destination.id}/image/upload`, {
      fileName: 'second.webp',
      mimeType: 'image/webp',
      fileSize: secondBody.length,
    });
    row = await db.destination.findUniqueOrThrow({ where: { id: destination.id } });
    expect(row.imageObjectKey).toBe(firstKey);
    expect((storageService as MemoryStorageService).read(firstKey)).toEqual(firstBody);
    await (storageService as MemoryStorageService).putObject({
      key: row.pendingImageObjectKey!,
      body: secondBody,
      contentType: 'image/webp',
    });
    const secondKey = row.pendingImageObjectKey!;
    const secondConfirmed = await client.post(
      `/api/masters/destinations/${destination.id}/image/confirm`,
    );
    expect(secondConfirmed.status).toBe(200);
    expect(
      secondConfirmed.body.data.images.map((image: { fileName: string }) => image.fileName),
    ).toEqual(['first.png', 'second.webp']);
    const secondImageId = secondConfirmed.body.data.images[1].id as string;
    expect((storageService as MemoryStorageService).read(firstKey)).toEqual(firstBody);

    // The ordered gallery is quotation-facing; the retained single-image
    // columns mirror its first entry for legacy callers.
    const reordered = await client.patch(
      `/api/masters/destinations/${destination.id}/images/order`,
      { imageIds: [secondImageId, firstImageId] },
    );
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.images.map((image: { id: string }) => image.id)).toEqual([
      secondImageId,
      firstImageId,
    ]);
    row = await db.destination.findUniqueOrThrow({ where: { id: destination.id } });
    expect(row.imageObjectKey).toBe(secondKey);

    const reloaded = await client.get(`/api/masters/destinations/${destination.id}`);
    expect(reloaded.body.data.images.map((image: { id: string }) => image.id)).toEqual([
      secondImageId,
      firstImageId,
    ]);

    const other = await owner('other@masters.test', 'Other Masters');
    expect(
      (
        await other.get(
          `/api/masters/destinations/${destination.id}/image/download-url?imageId=${secondImageId}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await other.patch(`/api/masters/destinations/${destination.id}/images/order`, {
          imageIds: [secondImageId, firstImageId],
        })
      ).status,
    ).toBe(404);

    const removed = await client.delete(
      `/api/masters/destinations/${destination.id}/image?imageId=${secondImageId}`,
    );
    expect(removed.status).toBe(200);
    const afterRemoval = await client.get(`/api/masters/destinations/${destination.id}`);
    expect(afterRemoval.body.data.images.map((image: { id: string }) => image.id)).toEqual([
      firstImageId,
    ]);
    expect((storageService as MemoryStorageService).read(secondKey)).toEqual(secondBody);
    expect((storageService as MemoryStorageService).read(firstKey)).toEqual(firstBody);
  });

  it('stores, updates, clears and searches the internal destination private name', async () => {
    const client = await owner('private-name@masters.test', 'Private Name Travel');
    const city = await createCity(client);
    const created = await client.post('/api/masters/destinations', {
      countryCode: 'IN',
      name: 'Vietnam Holiday',
      privateName: '  VN Supplier Package 2026  ',
      destinationType: 'DOMESTIC',
      cityIds: [city.id],
      status: 'ACTIVE',
    });
    expect(created.status).toBe(201);
    // Trimmed on write; the public name is untouched.
    expect(created.body.data).toMatchObject({
      name: 'Vietnam Holiday',
      privateName: 'VN Supplier Package 2026',
    });
    const id = created.body.data.id as string;
    expect(
      (await db.destination.findUniqueOrThrow({ where: { id } })).privateName,
    ).toBe('VN Supplier Package 2026');

    // Edit + clear (whitespace-only clears back to null).
    expect(
      (await client.patch(`/api/masters/destinations/${id}`, { privateName: 'Edited Label' }))
        .body.data.privateName,
    ).toBe('Edited Label');
    expect(
      (await client.patch(`/api/masters/destinations/${id}`, { privateName: '   ' })).body.data
        .privateName,
    ).toBeNull();

    // Details + list expose it for the internal admin screens.
    await client.patch(`/api/masters/destinations/${id}`, { privateName: 'VN Supplier Package 2026' });
    expect((await client.get(`/api/masters/destinations/${id}`)).body.data.privateName).toBe(
      'VN Supplier Package 2026',
    );

    // Admin search finds it by private name as well as by public name.
    await createDestination(client, [city.id], 'Rajasthan Highlights');
    const byPrivate = await client.get(
      '/api/masters/destinations?search=supplier%20package&pageSize=100',
    );
    expect(byPrivate.status).toBe(200);
    expect(byPrivate.body.data.data.map((row: { name: string }) => row.name)).toEqual([
      'Vietnam Holiday',
    ]);

    // Over the 200-character limit is rejected.
    expect(
      (
        await client.patch(`/api/masters/destinations/${id}`, {
          privateName: 'x'.repeat(201),
        })
      ).status,
    ).toBe(400);
  });

  it('never exposes the destination private name outside the admin masters API', async () => {
    const client = await owner('private-leak@masters.test', 'Private Leak Travel');
    const cityResponse = await client.post('/api/masters/cities', {
      countryCode: 'VN',
      name: 'Hanoi',
      airportCode: null,
      status: 'ACTIVE',
    });
    expect(cityResponse.status).toBe(201);
    const city = cityResponse.body.data as { id: string };
    const created = await client.post('/api/masters/destinations', {
      countryCode: 'VN',
      name: 'Vietnam',
      privateName: 'SECRET-INTERNAL-LABEL',
      destinationType: 'INTERNATIONAL',
      cityIds: [city.id],
      status: 'ACTIVE',
    });
    expect(created.status).toBe(201);
    const createdSightseeing = await client.post('/api/masters/sightseeing', {
      destinationId: created.body.data.id,
      cityId: city.id,
      title: 'Hanoi City Tour',
      sequence: 1,
      status: 'ACTIVE',
    });
    expect(createdSightseeing.status).toBe(201);
    // The quotation-builder dropdown feed projects only id/name pairs.
    const feed = await client.get(
      '/api/masters/sightseeing/activities?destination=Vietnam&city=Hanoi',
    );
    expect(feed.status).toBe(200);
    // The activity flows through (proving the projection ran on real data).
    expect(feed.body.data.activities).toHaveLength(1);
    expect(JSON.stringify(feed.body)).not.toContain('SECRET-INTERNAL-LABEL');
    expect(JSON.stringify(feed.body)).not.toContain('privateName');
  });

  it('records city, destination, link and image changes in the audit log', async () => {
    const client = await owner();
    const city = await createCity(client);
    const second = await createCity(client, 'Jodhpur');
    const destination = await createDestination(client, [city.id]);
    await client.post(`/api/masters/destinations/${destination.id}/cities`, { cityId: second.id });
    await client.post(`/api/masters/destinations/${destination.id}/cities/reorder`, {
      cityIds: [second.id, city.id],
    });
    await client.delete(`/api/masters/destinations/${destination.id}/cities/${city.id}`);
    const actions = (await db.activityLog.findMany()).map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CITY_CREATED',
        'DESTINATION_CREATED',
        'DESTINATION_CITY_ADDED',
        'DESTINATION_CITY_REORDERED',
        'DESTINATION_CITY_REMOVED',
      ]),
    );
  });
});
