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

  it('removes the interactive timeline without affecting the weblink', () => {
    expect(css).toMatch(
      /\[data-pdf-mode=['"]weblink['"]\]\s+\.weblink-timeline-line,[\s\S]*?\.weblink-timeline-marker\s*\{[^}]*display:\s*none/i,
    );
    expect(css).toMatch(
      /\[data-pdf-mode=['"]weblink['"]\]\s+\.weblink-timeline-item\s*\{[^}]*padding-left:\s*0/i,
    );
  });
});
