import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import {
  buildWeblinkPdfUrl,
  closeWeblinkPdfBrowser,
  createWeblinkPdfContext,
  IQOO_NEO_9_PRO_PROFILE,
  renderWeblinkPdfFromUrl,
} from '../src/modules/quotations/weblink-browser-pdf.service.js';
// Chromium's A4 rounding differs slightly from these PDFKit constants; the
// geometry assertions below allow rounding tolerance.
import { PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT } from '../src/modules/quotations/pdf.service.js';

/**
 * Weblink PDF browser pipeline. The renderer prints the ACTUAL public
 * quotation view, so these tests exercise the real Chromium pipeline against
 * static fixtures (no app servers needed): A4 geometry, footer numbering,
 * link annotations, and failure behavior. End-to-end generation against a
 * live quotation is covered by the deliverable run plus the popup tests.
 */

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';
const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type\s*\/Page(?![sR])/g) ?? []).length;

const pageMediaBoxes = (buffer: Buffer): Array<{ width: number; height: number }> => {
  const raw = buffer.toString('latin1');
  const re = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g;
  const boxes: Array<{ width: number; height: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    boxes.push({ width: Number(match[1]), height: Number(match[2]) });
  }
  return boxes;
};

function pdfTextPage(buffer: Buffer, page: number): string {
  return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8');
}

/** Skip browser tests where no compatible Chromium is installed (CI installs it). */
let browserBinaryPresent = false;
try {
  browserBinaryPresent = existsSync(chromium.executablePath());
} catch {
  browserBinaryPresent = false;
}

const fixtureUrl = (body: string) =>
  `data:text/html,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`)}`;

const pdfModeFixture = (inner: string) =>
  fixtureUrl(`<main data-pdf-mode="weblink" style="width:380px">${inner}</main>`);

describe('buildWeblinkPdfUrl', () => {
  it('points at the token route in PDF mode', () => {
    expect(buildWeblinkPdfUrl('http://localhost:5173/', 'abc123')).toBe(
      'http://localhost:5173/q/abc123?pdf=weblink',
    );
    expect(buildWeblinkPdfUrl('https://app.example.com', 'tok/en space')).toBe(
      'https://app.example.com/q/tok%2Fen%20space?pdf=weblink',
    );
  });
});

describe('weblink PDF device profile', () => {
  it('declares the emulated iQOO Neo 9 Pro configuration', () => {
    // CSS viewport (not native pixels): 420 × 933 at 3x ≈ the 1260 × 2800 panel.
    expect(IQOO_NEO_9_PRO_PROFILE.viewport).toEqual({ width: 420, height: 933 });
    expect(IQOO_NEO_9_PRO_PROFILE.deviceScaleFactor).toBe(3);
    expect(IQOO_NEO_9_PRO_PROFILE.isMobile).toBe(true);
    expect(IQOO_NEO_9_PRO_PROFILE.hasTouch).toBe(true);
    expect(IQOO_NEO_9_PRO_PROFILE.userAgent).toContain('Android');
  });
});

describe.skipIf(!browserBinaryPresent)('weblink PDF effective browser profile', () => {
  it('runs pages at 420 CSS px with 3x DPR, touch, and mobile (not desktop) styles', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const { context, page } = await createWeblinkPdfContext(browser);
      try {
        // Same viewport contract as the real app shell (apps/web/index.html):
        // without width=device-width, mobile Chromium falls back to a 980px
        // layout viewport even with isMobile enabled.
        await page.goto(
          'data:text/html,' +
            encodeURIComponent(
              '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body></body></html>',
            ),
        );
        // Evaluated as source (not a closure): the API tsconfig has no DOM
        // lib, and bundlers must never inject helpers into page code.
        const profile = (await page.evaluate(
          `({ innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              devicePixelRatio: window.devicePixelRatio,
              touchPoints: navigator.maxTouchPoints || 0,
              coarsePointer: window.matchMedia('(pointer: coarse)').matches,
              matchesSmBreakpoint: window.matchMedia('(min-width: 640px)').matches })`,
        )) as {
          innerWidth: number;
          innerHeight: number;
          devicePixelRatio: number;
          touchPoints: number;
          coarsePointer: boolean;
          matchesSmBreakpoint: boolean;
        };
        expect(profile.innerWidth).toBe(420);
        expect(profile.devicePixelRatio).toBe(3);
        expect(profile.innerHeight).toBeGreaterThan(profile.innerWidth);
        expect(profile.touchPoints).toBeGreaterThan(0);
        expect(profile.coarsePointer).toBe(true);
        expect(profile.matchesSmBreakpoint).toBe(false);
      } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
});

describe.skipIf(!browserBinaryPresent)('weblink browser PDF pipeline', () => {
  it('renders A4 pages with N-of-M footers and clickable links', async () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `<p>Policy line ${i + 1} of the inclusions.</p>`,
    ).join('');
    const pdf = await renderWeblinkPdfFromUrl({
      url: pdfModeFixture(
        `<h1>Singapore Escape</h1><p>Grand Total</p><a href="https://alpha.example">Website</a><a href="tel:+919000000001">Call Now</a>${long}`,
      ),
      timeoutMs: 30_000,
    });
    try {
      expect(isPdf(pdf)).toBe(true);
      const total = pageCount(pdf);
      expect(total).toBeGreaterThan(1);
      for (const box of pageMediaBoxes(pdf)) {
        // Chromium's A4 point rounding differs slightly from PDFKit's
        // constants; assert portrait A4 within rounding tolerance.
        expect(box.width).toBeCloseTo(PDF_PAGE_WIDTH, -1);
        expect(box.height).toBeCloseTo(PDF_PAGE_HEIGHT, -1);
        expect(box.height).toBeGreaterThan(box.width);
      }
      expect(pdfTextPage(pdf, 1)).toMatch(/1 of \d+/);
      expect(pdfTextPage(pdf, total)).toMatch(new RegExp(`${total} of ${total}`));
      const raw = pdf.toString('latin1');
      expect(raw).toMatch(/\/Subtype\s*\/Link/);
      expect(raw).toContain('/URI (https://alpha.example/)');
      expect(raw).toContain('/URI (tel:+919000000001)');
    } finally {
      await closeWeblinkPdfBrowser();
    }
  });

  it('rejects a page that never renders the PDF-mode view', async () => {
    await expect(
      renderWeblinkPdfFromUrl({
        url: fixtureUrl('<main><h1>No pdf mode here</h1></main>'),
        timeoutMs: 3_000,
      }),
    ).rejects.toThrow();
    await closeWeblinkPdfBrowser();
  });
});
