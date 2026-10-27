import { PrismaClient } from '@prisma/client';

async function main() {
  const p = new PrismaClient();
  const rows = await p.$queryRawUnsafe(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('quotation_version_services','quotation_template_services') AND column_name = 'duration'",
  );
  console.log(JSON.stringify(rows));
  await p.$disconnect();
}

void main();
