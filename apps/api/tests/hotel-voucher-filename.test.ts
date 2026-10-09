import { describe, expect, it } from 'vitest';
import { hotelVoucherDownloadFileName } from '../src/modules/hotel-vouchers/hotel-vouchers.service.js';

describe('Hotel voucher download filename', () => {
  it('formats lead and hotel names with a pdf extension', () => {
    expect(hotelVoucherDownloadFileName('Vikas Sahni', 'Hotel Boss Singapore')).toBe(
      'Vikas Sahni - Hotel Boss Singapore.pdf',
    );
  });

  it('strips characters that are invalid in filenames', () => {
    expect(hotelVoucherDownloadFileName('A/B:C\\D*E?F"G<H>I|J', 'Hotel: "Grand" / Resort')).toBe(
      'ABCDEFGHIJ - Hotel Grand Resort.pdf',
    );
  });

  it('trims and collapses whitespace', () => {
    expect(hotelVoucherDownloadFileName('  Aarav   Mehta  ', '  Shah Palace Hotel  ')).toBe(
      'Aarav Mehta - Shah Palace Hotel.pdf',
    );
  });

  it('falls back instead of producing an empty filename', () => {
    expect(hotelVoucherDownloadFileName(null, null)).toBe('Hotel Voucher - Hotel Voucher.pdf');
    expect(hotelVoucherDownloadFileName('   ', '...')).toBe('Hotel Voucher - Hotel Voucher.pdf');
    expect(hotelVoucherDownloadFileName(null, 'Shah Palace Hotel')).toBe(
      'Hotel Voucher - Shah Palace Hotel.pdf',
    );
  });

  it('caps each part so filesystems stay happy', () => {
    const long = 'x'.repeat(200);
    const name = hotelVoucherDownloadFileName(long, long);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(120 + 3 + 120 + 4);
  });
});
