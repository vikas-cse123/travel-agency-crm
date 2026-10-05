import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
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

type Client = ReturnType<typeof createAuthClient>;

async function owner(email = 'owner@mdel.test', companyName = 'Master Delete Travel') {
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

async function createCity(client: Client, name = 'Jaipur') {
  const res = await client.post('/api/masters/cities', {
    countryCode: 'IN',
    name,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createDestination(client: Client, cityIds: string[], name = 'Rajasthan Highlights') {
  const res = await client.post('/api/masters/destinations', {
    countryCode: 'IN',
    name,
    destinationType: 'DOMESTIC',
    cityIds,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function geo(client: Client) {
  const city = await createCity(client);
  const destination = await createDestination(client, [city.id]);
  return { city, destination };
}

async function createHotel(client: Client, destinationId: string, cityId: string, name = 'Shah Palace Hotel') {
  const res = await client.post('/api/masters/hotels', {
    destinationId,
    cityId,
    name,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createAirline(client: Client, name = 'Air India') {
  const res = await client.post('/api/masters/airlines', { name, status: 'ACTIVE' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createCruise(client: Client, name = 'Dream Genting') {
  const res = await client.post('/api/masters/cruises', {
    name,
    status: 'ACTIVE',
    roomTypes: [{ name: 'Interior', price: 18000 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; roomTypes: Array<{ id: string }> };
}

async function createVehicle(client: Client, name = 'Innova') {
  const res = await client.post('/api/masters/vehicles', {
    name,
    vehicleType: 'Standard MPV',
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createSightseeing(
  client: Client,
  destinationId: string,
  cityId: string,
  title = 'Gobustan Tour',
) {
  const res = await client.post('/api/masters/sightseeing', {
    destinationId,
    cityId,
    title,
    sequence: 1,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createAddOn(client: Client, name = 'Visa Assist') {
  const res = await client.post('/api/masters/add-on-services', {
    name,
    price: 3800,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createVisaType(client: Client, destinationId: string, name = 'Tourist Visa') {
  const res = await client.post('/api/masters/visa-types', {
    destinationId,
    name,
    sections: [{ title: 'Docs', content: '<p>Passport</p>' }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createTestimonial(client: Client) {
  const res = await client.post('/api/masters/testimonials', {
    clientName: 'Asha Rao',
    destinationName: 'Bali',
    description: 'Wonderful trip.',
    isVisible: true,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function createFaq(client: Client) {
  const res = await client.post('/api/masters/faqs', {
    question: 'Is transfer included?',
    answer: 'Yes.',
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

/** Upload + confirm one gallery image; returns the stored object key. */
const pendingKeyReaders: Record<string, (id: string) => Promise<string>> = {
  destinations: async (id) =>
    (await db.destination.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  hotels: async (id) =>
    (await db.hotel.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  cruises: async (id) =>
    (await db.cruise.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  vehicles: async (id) =>
    (await db.vehicle.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  sightseeing: async (id) =>
    (await db.sightseeing.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  'add-on-services': async (id) =>
    (await db.addOnService.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
  testimonials: async (id) =>
    (await db.testimonial.findUniqueOrThrow({ where: { id } })).pendingImageObjectKey!,
};

async function attachImage(
  client: Client,
  base: string,
  id: string,
  fileName = 'photo.png',
): Promise<string> {
  const body = Buffer.from('master-image-bytes');
  const approval = await client.post(`${base}/${id}/image/upload`, {
    fileName,
    mimeType: 'image/png',
    fileSize: body.length,
  });
  expect(approval.status, JSON.stringify(approval.body)).toBe(201);
  const segment = base.split('/').pop()!;
  const key = await pendingKeyReaders[segment]!(id);
  expect(key).toBeTruthy();
  await (storageService as MemoryStorageService).putObject({
    key,
    body,
    contentType: 'image/png',
  });
  const confirmed = await client.post(`${base}/${id}/image/confirm`);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return key;
}

async function attachLogo(client: Client, id: string): Promise<string> {
  const body = Buffer.from('logo-bytes');
  const approval = await client.post(`/api/masters/airlines/${id}/logo/upload`, {
    fileName: 'logo.png',
    mimeType: 'image/png',
    fileSize: body.length,
  });
  expect(approval.status, JSON.stringify(approval.body)).toBe(201);
  const row = await db.airline.findUniqueOrThrow({ where: { id } });
  const key = row.pendingLogoObjectKey!;
  expect(key).toBeTruthy();
  await (storageService as MemoryStorageService).putObject({
    key,
    body,
    contentType: 'image/png',
  });
  const confirmed = await client.post(`/api/masters/airlines/${id}/logo/confirm`);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return (await db.airline.findUniqueOrThrow({ where: { id } })).logoObjectKey!;
}

/** Lead + minimal quotation; returns ids for direct link-row creation. */
async function quotationShell(client: Client) {
  const lead = (
    await client.post('/api/queries', {
      customerName: 'Quot Customer',
      phone: '+91 90000 11111',
      leadSource: 'REFERRAL',
      leadType: 'HOT',
      leadStage: 'QUALIFIED',
      priority: 'HIGH',
      rooms: 1,
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      extraBeds: 0,
      currency: 'INR',
      services: ['HOTEL'],
      itinerary: [{ country: 'India', destination: 'Goa', nights: 2, sequence: 1 }],
    })
  ).body.data;
  const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
  const company = await db.company.findFirstOrThrow({
    where: { id: (await db.query.findUniqueOrThrow({ where: { id: lead.id } })).companyId },
  });
  return { lead, quotation, versionId: quotation.versions[0].id as string, company };
}

describe('master hard delete', () => {
  it('CITY: deletes clean rows, blocks referenced rows with 409', async () => {
    const client = await owner();
    const { city, destination } = await geo(client);
    const lonely = await createCity(client, 'Lonely Town');

    const blocked = await client.delete(`/api/masters/cities/${city.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/being used/i);
    expect(await db.city.findUnique({ where: { id: city.id } })).not.toBeNull();

    // Hotel and sightseeing references also block.
    const hotel = await createHotel(client, destination.id, city.id);
    await createSightseeing(client, destination.id, city.id);
    expect((await client.delete(`/api/masters/cities/${city.id}`)).status).toBe(409);
    expect((await db.hotel.findUniqueOrThrow({ where: { id: hotel.id } })).status).toBe('ACTIVE');

    const removed = await client.delete(`/api/masters/cities/${lonely.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, id: lonely.id });
    expect(removed.body.data).not.toHaveProperty('archived');
    expect(await db.city.findUnique({ where: { id: lonely.id } })).toBeNull();
    expect((await client.delete(`/api/masters/cities/${lonely.id}`)).status).toBe(404);
    const logs = await db.activityLog.findMany({
      where: { entityType: 'City', entityId: lonely.id },
    });
    expect(logs.map((l) => l.action)).toContain('CITY_DELETED');
    expect(logs.some((l) => l.action === 'CITY_ARCHIVED')).toBe(false);
  });

  it('DESTINATION: deletes clean rows with cascades, blocks referenced rows', async () => {
    const client = await owner();
    const { city, destination } = await geo(client);
    const companyId = (await db.destination.findUniqueOrThrow({ where: { id: destination.id } }))
      .companyId;
    const creatorId = (await db.user.findFirstOrThrow({ where: { companyId } })).id;
    const linkVehicle = await db.vehicle.create({
      data: {
        companyId,
        name: 'Link Van',
        normalizedName: 'link van',
        vehicleType: 'Van',
        createdById: creatorId,
      },
    });
    await db.vehicleDestination.create({
      data: { companyId, vehicleId: linkVehicle.id, destinationId: destination.id, sequence: 0 },
    });

    const hotel = await createHotel(client, destination.id, city.id);
    expect((await client.delete(`/api/masters/destinations/${destination.id}`)).status).toBe(409);
    await client.delete(`/api/masters/hotels/${hotel.id}`);
    // Sightseeing + visa blockers.
    const sight = await createSightseeing(client, destination.id, city.id);
    expect((await client.delete(`/api/masters/destinations/${destination.id}`)).status).toBe(409);
    await client.delete(`/api/masters/sightseeing/${sight.id}`);
    const visa = await createVisaType(client, destination.id);
    expect((await client.delete(`/api/masters/destinations/${destination.id}`)).status).toBe(409);
    await client.delete(`/api/masters/visa-types/${visa.id}`);

    const removed = await client.delete(`/api/masters/destinations/${destination.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, id: destination.id });
    expect(await db.destination.findUnique({ where: { id: destination.id } })).toBeNull();
    expect(await db.destinationCity.count({ where: { destinationId: destination.id } })).toBe(0);
    expect(await db.vehicleDestination.count({ where: { destinationId: destination.id } })).toBe(0);
    // The city itself survives.
    expect(await db.city.findUnique({ where: { id: city.id } })).not.toBeNull();
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Destination', entityId: destination.id },
    });
    expect(logs.map((l) => l.action)).toContain('DESTINATION_DELETED');
  });

  it('DESTINATION: removes master-owned storage objects', async () => {
    const client = await owner();
    const { destination } = await geo(client);
    const key = await attachImage(client, '/api/masters/destinations', destination.id);
    expect(await storageService.headObject(key)).not.toBeNull();
    expect((await client.delete(`/api/masters/destinations/${destination.id}`)).status).toBe(200);
    expect(await storageService.headObject(key)).toBeNull();
  });

  it('HOTEL: cascades children and nulls quotation/booking links with snapshots intact', async () => {
    const client = await owner();
    const { city, destination } = await geo(client);
    const hotel = await createHotel(client, destination.id, city.id);
    await client.post(`/api/masters/hotels/${hotel.id}/room-types`, { name: 'Deluxe' });
    await client.post(`/api/masters/hotels/${hotel.id}/meal-plans`, { name: 'Breakfast' });
    const room = await db.hotelRoomType.findFirstOrThrow({
      where: { hotelId: hotel.id, name: 'Deluxe' },
    });
    const meal = await db.hotelMealPlan.findFirstOrThrow({
      where: { hotelId: hotel.id, name: 'Breakfast' },
    });
    const { quotation, versionId, company } = await quotationShell(client);
    const user = await db.user.findFirstOrThrow({ where: { companyId: company.id } });
    const option = await db.quotationVersionHotelOption.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        hotelId: hotel.id,
        hotelRoomTypeId: room.id,
        hotelMealPlanId: meal.id,
        city: 'Baku',
        hotelName: 'Shah Palace Hotel',
        nights: 2,
        sequence: 2,
        sellingPrice: 6800,
      },
    });
    const booking = await db.booking.create({
      data: {
        companyId: company.id,
        bookingNumber: 'BKG-H-001',
        customerName: 'Quot Customer',
        customerPhone: '+91 90000 11111',
        destinationSummary: 'Goa',
        bookedById: user.id,
      },
    });
    const service = await db.bookingService.create({
      data: {
        companyId: company.id,
        bookingId: booking.id,
        serviceType: 'HOTEL',
        name: 'Shah Palace Hotel',
        sequence: 1,
        hotelId: hotel.id,
        hotelRoomTypeId: room.id,
        hotelMealPlanId: meal.id,
      },
    });

    expect((await client.delete(`/api/masters/hotels/${hotel.id}`)).status).toBe(200);
    expect(await db.hotel.findUnique({ where: { id: hotel.id } })).toBeNull();
    expect(await db.hotelRoomType.count({ where: { hotelId: hotel.id } })).toBe(0);
    expect(await db.hotelMealPlan.count({ where: { hotelId: hotel.id } })).toBe(0);
    // Quotation row survives with nulled links and intact snapshots.
    expect(
      await db.quotationVersionHotelOption.findUnique({ where: { id: option.id } }),
    ).toMatchObject({ hotelId: null, hotelRoomTypeId: null, hotelMealPlanId: null });
    expect(
      (await db.quotationVersionHotelOption.findUniqueOrThrow({ where: { id: option.id } }))
        .hotelName,
    ).toBe('Shah Palace Hotel');
    expect(await db.quotation.findUnique({ where: { id: quotation.id } })).not.toBeNull();
    // Booking history survives with nulled links.
    expect(await db.booking.findUnique({ where: { id: booking.id } })).not.toBeNull();
    expect(await db.bookingService.findUniqueOrThrow({ where: { id: service.id } })).toMatchObject({
      hotelId: null,
      name: 'Shah Palace Hotel',
    });
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Hotel', entityId: hotel.id },
    });
    expect(logs.map((l) => l.action)).toContain('HOTEL_DELETED');
  });

  it('HOTEL: removes master-owned gallery storage', async () => {
    const client = await owner();
    const { city, destination } = await geo(client);
    const hotel = await createHotel(client, destination.id, city.id);
    const key = await attachImage(client, '/api/masters/hotels', hotel.id);
    expect(await storageService.headObject(key)).not.toBeNull();
    expect((await client.delete(`/api/masters/hotels/${hotel.id}`)).status).toBe(200);
    expect(await storageService.headObject(key)).toBeNull();
  });

  it('AIRLINE: deletes rows, cleans logo storage, nulls quotation links', async () => {
    const client = await owner();
    const airline = await createAirline(client);
    const key = await attachLogo(client, airline.id);
    expect(await storageService.headObject(key)).not.toBeNull();
    const { versionId, company } = await quotationShell(client);
    const link = await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'FLIGHT',
        name: 'Delhi-Baku',
        sequence: 2,
        airlineId: airline.id,
      },
    });
    expect((await client.delete(`/api/masters/airlines/${airline.id}`)).status).toBe(200);
    expect(await db.airline.findUnique({ where: { id: airline.id } })).toBeNull();
    expect(await storageService.headObject(key)).toBeNull();
    expect(await db.quotationVersionService.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject(
      { airlineId: null, name: 'Delhi-Baku' },
    );
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Airline', entityId: airline.id },
    });
    expect(logs.map((l) => l.action)).toContain('AIRLINE_DELETED');
  });

  it('CRUISE: cascades room types, cleans images, nulls quotation links', async () => {
    const client = await owner();
    const cruise = await createCruise(client);
    const key = await attachImage(client, '/api/masters/cruises', cruise.id);
    const { versionId, company } = await quotationShell(client);
    const link = await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'CRUISE',
        name: 'Cruise',
        sequence: 2,
        cruiseId: cruise.id,
        cruiseRoomTypeId: cruise.roomTypes[0]!.id,
      },
    });
    expect((await client.delete(`/api/masters/cruises/${cruise.id}`)).status).toBe(200);
    expect(await db.cruise.findUnique({ where: { id: cruise.id } })).toBeNull();
    expect(await db.cruiseRoomType.count({ where: { cruiseId: cruise.id } })).toBe(0);
    expect(await storageService.headObject(key)).toBeNull();
    expect(await db.quotationVersionService.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject(
      { cruiseId: null, cruiseRoomTypeId: null, name: 'Cruise' },
    );
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Cruise', entityId: cruise.id },
    });
    expect(logs.map((l) => l.action)).toContain('CRUISE_DELETED');
  });

  it('VEHICLE: cascades destination links, cleans images, nulls quotation links', async () => {
    const client = await owner();
    const { destination } = await geo(client);
    const vehicle = await createVehicle(client);
    await client.patch(`/api/masters/vehicles/${vehicle.id}`, {
      destinationIds: [destination.id],
    });
    const key = await attachImage(client, '/api/masters/vehicles', vehicle.id);
    const { versionId, company } = await quotationShell(client);
    const link = await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'VEHICLE_TRANSFER',
        name: 'Transfer',
        sequence: 2,
        vehicleId: vehicle.id,
      },
    });
    expect((await client.delete(`/api/masters/vehicles/${vehicle.id}`)).status).toBe(200);
    expect(await db.vehicle.findUnique({ where: { id: vehicle.id } })).toBeNull();
    expect(await db.vehicleDestination.count({ where: { vehicleId: vehicle.id } })).toBe(0);
    expect(await storageService.headObject(key)).toBeNull();
    expect(await db.quotationVersionService.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject(
      { vehicleId: null, name: 'Transfer' },
    );
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Vehicle', entityId: vehicle.id },
    });
    expect(logs.map((l) => l.action)).toContain('VEHICLE_DELETED');
  });

  it('SIGHTSEEING: cleans images and nulls quotation links', async () => {
    const client = await owner();
    const { city, destination } = await geo(client);
    const sight = await createSightseeing(client, destination.id, city.id);
    const key = await attachImage(client, '/api/masters/sightseeing', sight.id);
    const { versionId, company } = await quotationShell(client);
    const link = await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'SIGHTSEEING',
        name: 'Gobustan',
        sequence: 2,
        sightseeingId: sight.id,
      },
    });
    expect((await client.delete(`/api/masters/sightseeing/${sight.id}`)).status).toBe(200);
    expect(await db.sightseeing.findUnique({ where: { id: sight.id } })).toBeNull();
    expect(await storageService.headObject(key)).toBeNull();
    expect(await db.quotationVersionService.findUniqueOrThrow({ where: { id: link.id } })).toMatchObject(
      { sightseeingId: null, name: 'Gobustan' },
    );
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Sightseeing', entityId: sight.id },
    });
    expect(logs.map((l) => l.action)).toContain('SIGHTSEEING_DELETED');
  });

  it('ADD_ON_SERVICE: deletes mappings/pricing/images, keeps quotation snapshots', async () => {
    const client = await owner();
    const { destination } = await geo(client);
    const service = await createAddOn(client);
    await client.patch(`/api/masters/add-on-services/${service.id}`, {
      destinations: [{ destinationId: destination.id, isDefault: true }],
    });
    const key = await attachImage(client, '/api/masters/add-on-services', service.id);
    const { versionId, company } = await quotationShell(client);
    const snapshot = [{ id: 'x', label: 'Adult', price: 3800, currency: 'INR' }];
    const link = await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'OTHER_ADD_ON',
        name: 'Visa Assist',
        sequence: 2,
        addOnServiceId: service.id,
        pricingBasisLabel: 'Per Person',
        pricingSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    expect((await client.delete(`/api/masters/add-on-services/${service.id}`)).status).toBe(200);
    expect(await db.addOnService.findUnique({ where: { id: service.id } })).toBeNull();
    expect(await db.addOnServiceDestination.count({ where: { addOnServiceId: service.id } })).toBe(0);
    expect(await storageService.headObject(key)).toBeNull();
    const kept = await db.quotationVersionService.findUniqueOrThrow({ where: { id: link.id } });
    expect(kept.addOnServiceId).toBeNull();
    expect(kept.pricingBasisLabel).toBe('Per Person');
    expect(kept.pricingSnapshot).toMatchObject(snapshot);
    expect(kept.name).toBe('Visa Assist');
    const logs = await db.activityLog.findMany({
      where: { entityType: 'AddOnService', entityId: service.id },
    });
    expect(logs.map((l) => l.action)).toContain('ADD_ON_SERVICE_DELETED');
  });

  it('VISA_TYPE: cascades sections', async () => {
    const client = await owner();
    const { destination } = await geo(client);
    const visa = await createVisaType(client, destination.id);
    expect(await db.visaTypeSection.count({ where: { visaTypeId: visa.id } })).toBe(1);
    expect((await client.delete(`/api/masters/visa-types/${visa.id}`)).status).toBe(200);
    expect(await db.visaType.findUnique({ where: { id: visa.id } })).toBeNull();
    expect(await db.visaTypeSection.count({ where: { visaTypeId: visa.id } })).toBe(0);
    const logs = await db.activityLog.findMany({
      where: { entityType: 'VisaType', entityId: visa.id },
    });
    expect(logs.map((l) => l.action)).toContain('VISA_TYPE_DELETED');
  });

  it('TESTIMONIAL: cleans images', async () => {
    const client = await owner();
    const t = await createTestimonial(client);
    const key = await attachImage(client, '/api/masters/testimonials', t.id);
    expect((await client.delete(`/api/masters/testimonials/${t.id}`)).status).toBe(200);
    expect(await db.testimonial.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await storageService.headObject(key)).toBeNull();
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Testimonial', entityId: t.id },
    });
    expect(logs.map((l) => l.action)).toContain('TESTIMONIAL_DELETED');
  });

  it('FAQ: hard-deletes', async () => {
    const client = await owner();
    const faq = await createFaq(client);
    const removed = await client.delete(`/api/masters/faqs/${faq.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ deleted: true, id: faq.id });
    expect(await db.faq.findUnique({ where: { id: faq.id } })).toBeNull();
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Faq', entityId: faq.id },
    });
    expect(logs.map((l) => l.action)).toContain('FAQ_DELETED');
  });

  it('retains master storage referenced by quotation snapshots', async () => {
    const client = await owner();
    const cruise = await createCruise(client);
    const key = await attachImage(client, '/api/masters/cruises', cruise.id);
    const { versionId, company } = await quotationShell(client);
    await db.quotationVersionService.create({
      data: {
        companyId: company.id,
        quotationVersionId: versionId,
        serviceType: 'CRUISE',
        name: 'Cruise',
        sequence: 2,
        cruiseId: cruise.id,
        images: [{ id: 'snap-1', objectKey: key, fileName: 'photo.png' }],
      },
    });
    expect((await client.delete(`/api/masters/cruises/${cruise.id}`)).status).toBe(200);
    expect(await db.cruise.findUnique({ where: { id: cruise.id } })).toBeNull();
    // Referenced object survives so the saved quotation keeps rendering.
    expect(await storageService.headObject(key)).not.toBeNull();
    const logs = await db.activityLog.findMany({
      where: { entityType: 'Cruise', entityId: cruise.id },
    });
    expect(
      logs.find((l) => l.action === 'CRUISE_DELETED')?.metadata,
    ).toMatchObject({ retainedStorageFiles: 1 });
  });

  it('denies delete to roles without MASTER_*_DELETE across all entities', async () => {
    const admin = await owner('owner@rbac.test', 'Rbac Travel');
    const { city, destination } = await geo(admin);
    const created = {
      city: await createCity(admin, 'Rbac Town'),
      destination,
      hotel: await createHotel(admin, destination.id, city.id, 'Rbac Hotel'),
      airline: await createAirline(admin, 'Rbac Air'),
      cruise: await createCruise(admin, 'Rbac Cruise'),
      vehicle: await createVehicle(admin, 'Rbac Van'),
      sightseeing: await createSightseeing(admin, destination.id, city.id, 'Rbac Tour'),
      addon: await createAddOn(admin, 'Rbac Addon'),
      visa: await createVisaType(admin, destination.id, 'Rbac Visa'),
      testimonial: await createTestimonial(admin),
      faq: await createFaq(admin),
    };
    const sales = await roleClient('owner@rbac.test', 'Sales Executive', 'sales@rbac.test');
    const targets: Array<[string, string]> = [
      ['cities', created.city.id],
      ['destinations', created.destination.id],
      ['hotels', created.hotel.id],
      ['airlines', created.airline.id],
      ['cruises', created.cruise.id],
      ['vehicles', created.vehicle.id],
      ['sightseeing', created.sightseeing.id],
      ['add-on-services', created.addon.id],
      ['visa-types', created.visa.id],
      ['testimonials', created.testimonial.id],
      ['faqs', created.faq.id],
    ];
    for (const [plural, id] of targets) {
      expect((await sales.delete(`/api/masters/${plural}/${id}`)).status).toBe(403);
    }
    // No partial deletion: every row still exists.
    expect(await db.city.findUnique({ where: { id: created.city.id } })).not.toBeNull();
    expect(await db.destination.findUnique({ where: { id: created.destination.id } })).not.toBeNull();
    expect(await db.hotel.findUnique({ where: { id: created.hotel.id } })).not.toBeNull();
    expect(await db.airline.findUnique({ where: { id: created.airline.id } })).not.toBeNull();
    expect(await db.cruise.findUnique({ where: { id: created.cruise.id } })).not.toBeNull();
    expect(await db.vehicle.findUnique({ where: { id: created.vehicle.id } })).not.toBeNull();
    expect(await db.sightseeing.findUnique({ where: { id: created.sightseeing.id } })).not.toBeNull();
    expect(await db.addOnService.findUnique({ where: { id: created.addon.id } })).not.toBeNull();
    expect(await db.visaType.findUnique({ where: { id: created.visa.id } })).not.toBeNull();
    expect(await db.testimonial.findUnique({ where: { id: created.testimonial.id } })).not.toBeNull();
    expect(await db.faq.findUnique({ where: { id: created.faq.id } })).not.toBeNull();
  });
});
