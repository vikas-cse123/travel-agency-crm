/* One-off deliverable generator (deleted after the run, not part of the app). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from './src/config/prisma.js';
import {
  buildWeblinkPdfUrl,
  closeWeblinkPdfBrowser,
  renderWeblinkPdfFromUrl,
} from './src/modules/quotations/weblink-browser-pdf.service.js';

const q = await prisma.quotation.findFirst({
  where: { quotationNumber: 'QT-001005', deletedAt: null },
  select: { quotationNumber: true, customerName: true, status: true, publicToken: true },
});
if (!q?.publicToken) throw new Error('QT-001005 has no public token.');
const pdf = await renderWeblinkPdfFromUrl({
  url: buildWeblinkPdfUrl('http://localhost:5173', q.publicToken),
  timeoutMs: 90_000,
});
mkdirSync('../../output/pdf', { recursive: true });
writeFileSync('../../output/pdf/iqoo-neo-9-pro-weblink.pdf', pdf);
const raw = pdf.toString('latin1');
const pages = (raw.match(/\/Type\s*\/Page(?![sR])/g) ?? []).length;
console.log(JSON.stringify({ bytes: pdf.length, pages }));
await closeWeblinkPdfBrowser();
await prisma.$disconnect();
process.exit(0);
