import { describe, expect, it } from 'vitest';
import { weblinkPdfFileName } from '../src/modules/quotations/quotations.service.js';

describe('Weblink PDF download filename', () => {
  it('uses the lowercased customer name with hyphens', () => {
    expect(weblinkPdfFileName('Vikas')).toBe('vikas-quotation.pdf');
    expect(weblinkPdfFileName('Vikas Sahni')).toBe('vikas-sahni-quotation.pdf');
  });

  it('drops the quotation id, version and weblink label', () => {
    const name = weblinkPdfFileName('Sagar Sahni');
    expect(name).toBe('sagar-sahni-quotation.pdf');
    expect(name).not.toContain('weblink');
    expect(name).not.toMatch(/QT-|v\d+/i);
  });

  it('handles special characters, repeated spaces and stray hyphens safely', () => {
    expect(weblinkPdfFileName('A/B:C\\D*E?F"G<H>I|J')).toBe('a-b-c-d-e-f-g-h-i-j-quotation.pdf');
    expect(weblinkPdfFileName('  Aarav   Mehta  ')).toBe('aarav-mehta-quotation.pdf');
    expect(weblinkPdfFileName('--Vikas--')).toBe('vikas-quotation.pdf');
  });

  it('falls back instead of producing an empty filename', () => {
    expect(weblinkPdfFileName('')).toBe('quotation.pdf');
    expect(weblinkPdfFileName(null)).toBe('quotation.pdf');
    expect(weblinkPdfFileName(undefined)).toBe('quotation.pdf');
    expect(weblinkPdfFileName('   ')).toBe('quotation.pdf');
    expect(weblinkPdfFileName('...')).toBe('quotation.pdf');
  });
});
