import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';

/**
 * Platform alias hosts (PLATFORM_ALIAS_HOSTS): additional first-party hostnames
 * that serve the SAME app deployment as WEB_URL — e.g. demo.travelagencycrm.in
 * alongside app.travelagencycrm.in. They must be trusted by request-host and
 * origin/CORS validation, stay reserved so a customer custom domain can never
 * claim them, and must not open up wildcard or arbitrary-host trust.
 */

// Set before the env singleton (and therefore the app) is imported.
process.env.PLATFORM_ALIAS_HOSTS = 'demo.travelagencycrm.in,qa.travelagencycrm.in';

let app: Express;
let db: PrismaClient;
let isTrustedOriginHostname: (hostname: string) => Promise<boolean>;
let resolveCustomDomain: (hostname: string) => Promise<unknown>;

beforeAll(async () => {
  db = createTestPrismaClient();
  const { createApp } = await import('../src/app.js');
  ({ isTrustedOriginHostname, resolveCustomDomain } =
    await import('../src/modules/custom-domains/custom-domain.service.js'));
  app = createApp();
});

afterAll(async () => {
  delete process.env.PLATFORM_ALIAS_HOSTS;
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** Host validation runs before auth, so an allowed host returns 401 and a
 * rejected host returns 404. */
function probe(host: string) {
  return request(app).get('/api/settings/custom-domain').set('Host', host);
}

describe('platform alias hosts', () => {
  it('accepts configured alias hosts for request-host validation', async () => {
    expect((await probe('demo.travelagencycrm.in')).status).toBe(401);
    expect((await probe('qa.travelagencycrm.in')).status).toBe(401);
  });

  it('accepts an alias host case-insensitively', async () => {
    expect((await probe('DEMO.TRAVELAGENCYCRM.IN')).status).toBe(401);
  });

  it('still rejects an arbitrary host', async () => {
    expect((await probe('attacker-example.com')).status).toBe(404);
  });

  it('trusts alias origins for CORS/origin validation', async () => {
    expect(await isTrustedOriginHostname('demo.travelagencycrm.in')).toBe(true);
    expect(await isTrustedOriginHostname('qa.travelagencycrm.in')).toBe(true);
    expect(await isTrustedOriginHostname('attacker-example.com')).toBe(false);
  });

  it('keeps alias hosts reserved so a custom domain cannot claim them', async () => {
    const company = await db.company.create({
      data: {
        name: 'Company alias',
        slug: 'alias-tenant',
        email: 'contact@alias-tenant.local',
        status: 'ACTIVE',
      },
    });
    await db.customDomain.create({
      data: { companyId: company.id, hostname: 'demo.travelagencycrm.in', status: 'ACTIVE' },
    });
    expect(await resolveCustomDomain('demo.travelagencycrm.in')).toBeNull();
  });
});
