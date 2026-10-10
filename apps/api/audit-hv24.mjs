import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const envFile = readFileSync(new URL('../../.env', import.meta.url));
const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(envFile.toString());
const url = match?.[1];
if (!url || !url.includes('localhost')) {
  throw new Error('Refusing: DATABASE_URL is not the local dev database.');
}
const db = new PrismaClient({ datasources: { db: { url } } });

const found = await db.hotelVoucher.findMany({
  where: { voucherNumber: 'HV-000024' },
  select: {
    id: true,
    voucherNumber: true,
    guestName: true,
    adults: true,
    children: true,
    hotelId: true,
    hotelName: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
    guests: { orderBy: { sequence: 'asc' } },
  },
});
for (const v of found) {
  console.log(
    JSON.stringify(
      {
        id: v.id,
        voucherNumber: v.voucherNumber,
        guestName: v.guestName,
        adults: v.adults,
        children: v.children,
        hotelId: v.hotelId,
        deletedAt: v.deletedAt,
        guests: v.guests.map((g) => ({
          seq: g.sequence,
          name: g.guestName,
          age: g.age,
          sex: g.sex,
          pax: g.paxType,
        })),
      },
      null,
      1,
    ),
  );
}
if (found.length === 0) console.log('HV-000024 NOT FOUND');
await db.$disconnect();
