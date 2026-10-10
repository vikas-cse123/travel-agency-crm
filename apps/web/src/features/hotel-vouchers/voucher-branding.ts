/** Built-in hotel-voucher PDF theme (used when no custom color is saved). */
export const VOUCHER_DEFAULT_PRIMARY = '#3d2352';

export const isValidVoucherHex = (value: string): boolean =>
  /^#[0-9a-fA-F]{6}$/.test(value.trim());

/** Readable text for a primary-color surface (mirrors the PDF renderer). */
export function voucherPreviewText(hex: string): string {
  const channel = (part: string): number => {
    const srgb = Number.parseInt(part, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const clean = hex.trim();
  const luminance =
    0.2126 * channel(clean.slice(1, 3)) +
    0.7152 * channel(clean.slice(3, 5)) +
    0.0722 * channel(clean.slice(5, 7));
  return luminance > 0.4 ? '#1f2a5c' : '#ffffff';
}
