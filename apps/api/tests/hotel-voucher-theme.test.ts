import { describe, expect, it } from 'vitest';
import {
  isValidHexColor,
  resolveVoucherPrimary,
  resolveVoucherTheme,
  voucherPrimaryForeground,
} from '../src/modules/hotel-vouchers/hotel-voucher-pdf.service.js';

describe('Hotel voucher PDF theme', () => {
  it('accepts any valid #RRGGBB color and normalizes case', () => {
    for (const color of ['#48215E', '#2563EB', '#15803D', '#DC2626', '#FDE68A']) {
      expect(isValidHexColor(color)).toBe(true);
      expect(resolveVoucherPrimary(color)).toBe(color.toLowerCase());
    }
  });

  it('falls back to the built-in purple for invalid or missing values', () => {
    for (const bad of ['red', '#fff', '#12345', '123456', '', '  ', null, undefined, 42]) {
      expect(isValidHexColor(bad)).toBe(false);
      expect(resolveVoucherPrimary(bad)).toBe('#3d2352');
    }
  });

  it('keeps white text on dark themes', () => {
    for (const color of ['#48215E', '#2563EB', '#15803D', '#DC2626', '#3d2352']) {
      expect(resolveVoucherTheme(color)).toEqual({ primary: color.toLowerCase(), onPrimary: '#ffffff' });
    }
  });

  it('switches to dark text on light themes so headings stay readable', () => {
    expect(voucherPrimaryForeground('#FDE68A')).toBe('#1f2a5c');
    expect(resolveVoucherTheme('#FDE68A')).toEqual({ primary: '#fde68a', onPrimary: '#1f2a5c' });
    expect(voucherPrimaryForeground('#ffffff')).toBe('#1f2a5c');
  });
});
