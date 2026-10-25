import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/pages/quotations/weblink-pdf.css'), 'utf8');

describe('Weblink PDF print stylesheet', () => {
  it('paints the full A4 sheet and app shell with the quotation canvas color', () => {
    expect(css).toMatch(/@page\s*\{[^}]*background:\s*#f1f5f9/i);
    expect(css).toMatch(
      /html:has\(\[data-pdf-mode=['"]weblink['"]\]\),[\s\S]*?body:has\(\[data-pdf-mode=['"]weblink['"]\]\)\s*\{[^}]*background:\s*#f1f5f9/i,
    );
  });

  it('scales every PDF-mode text style by exactly 25% (PDF-mode only)', () => {
    // Base scales with unstyled text: 16px inherited -> 20px on the PDF root.
    expect(css).toMatch(/\[data-pdf-mode='weblink'\]\s*\{[^}]*font-size:\s*20px/i);
    // rem-based Tailwind utilities -> exact x1.25 px (12->15, 14->17.5, ...).
    const sizes: Array<[string, string]> = [
      ['text-xs', '15px'],
      ['text-sm', '17.5px'],
      ['text-base', '20px'],
      ['text-lg', '22.5px'],
      ['text-xl', '25px'],
      ['text-2xl', '30px'],
      ['text-4xl', '45px'],
      ['text-6xl', '75px'],
    ];
    for (const [cls, px] of sizes) {
      expect(css).toMatch(
        new RegExp(`\\[data-pdf-mode='weblink'\\]\\s+\\.${cls}\\s*\\{[^}]*font-size:\\s*${px.replace('.', '\\.')}`, 'i'),
      );
    }
    // Arbitrary px sizes used by the public view (10->12.5, 11->13.75, ...).
    const arbitrary: Array<[string, string]> = [
      ['10', '12.5px'],
      ['11', '13.75px'],
      ['14', '17.5px'],
      ['15', '18.75px'],
      ['16', '20px'],
      ['17', '21.25px'],
      ['19', '23.75px'],
      ['24', '30px'],
      ['30', '37.5px'],
      ['32', '40px'],
      ['34', '42.5px'],
      ['40', '50px'],
      ['48', '60px'],
    ];
    for (const [n, px] of arbitrary) {
      expect(css).toMatch(
        new RegExp(`\\.text-\\\\\\[${n}px\\\\\\][^}]*font-size:\\s*${px.replace('.', '\\.')}`, 'i'),
      );
    }
    // Responsive variants live inside their breakpoints (mirroring Tailwind)
    // so an inactive breakpoint can never win by source order.
    expect(css).toMatch(
      /@media\s*\(min-width:\s*640px\)[\s\S]*?\.sm\\:text-sm[^}]*font-size:\s*17\.5px/i,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.md\\:text-\\\[24px\\\][^}]*font-size:\s*30px/i,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.lg\\:text-\\\[48px\\\][^}]*font-size:\s*60px/i,
    );
    expect(css).toMatch(/\.sm\\:text-\\\[40px\\\][^}]*font-size:\s*50px/i);
    expect(css).toMatch(/\.md\\:text-\\\[34px\\\][^}]*font-size:\s*42\.5px/i);
    expect(css).toMatch(/\.lg\\:text-\\\[48px\\\][^}]*font-size:\s*60px/i);
    // rem-based line heights scale x1.25 in px to preserve rhythm.
    expect(css).toMatch(/\.leading-4[^}]*line-height:\s*20px/i);
    expect(css).toMatch(/\.leading-7[^}]*line-height:\s*35px/i);
    // Docs-pasted rich-text pt sizes scale x1.25 (11pt->13.75pt, 16pt->20pt).
    expect(css).toMatch(/font-size:11pt[^}]*font-size:\s*13\.75pt/i);
    expect(css).toMatch(/font-size:16pt[^}]*font-size:\s*20pt/i);
    // Scoped strictly to PDF mode: no bare/global font-size rule may leak.
    for (const match of css.matchAll(/(^|\})[^{]*font-size:[^}]*\}/gi)) {
      const rule = match[0];
      if (/\.text-|\.leading-|h1|h2|h3|font-size:(11|16|10\.5)pt/.test(rule)) {
        expect(rule).toMatch(/data-pdf-mode/);
      }
    }
  });

  it('keeps day-card tails with their content when larger type forces a split', () => {
    expect(css).toMatch(
      /\[data-pdf-mode='weblink'\]\s+\.weblink-day-card\s+\.weblink-activity-panel\s*\{[^}]*break-after:\s*avoid/i,
    );
    expect(css).toMatch(
      /\[data-pdf-mode='weblink'\]\s+\.weblink-day-meals\s*\{[^}]*break-before:\s*avoid[^}]*break-inside:\s*avoid/i,
    );
    expect(css).toMatch(
      /\[data-pdf-mode='weblink'\]\s+\.weblink-day-card\s+\.itinerary-rich-text\s*\{[^}]*break-after:\s*avoid/i,
    );
  });

  it('removes the interactive timeline without affecting the weblink', () => {
    expect(css).toMatch(
      /\[data-pdf-mode=['"]weblink['"]\]\s+\.weblink-timeline-line,[\s\S]*?\.weblink-timeline-marker\s*\{[^}]*display:\s*none/i,
    );
    expect(css).toMatch(
      /\[data-pdf-mode=['"]weblink['"]\]\s+\.weblink-timeline-item\s*\{[^}]*padding-left:\s*0/i,
    );
  });
});
