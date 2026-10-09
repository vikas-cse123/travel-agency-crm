import { z } from 'zod';

/**
 * Hotel Voucher contracts — standalone service-confirmation documents,
 * independent of Booking. All guest/hotel/stay content is snapshotted at
 * write time; optional customerId/queryId/hotelId are selection conveniences
 * only and never required.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalEmail = z.string().trim().max(255).email().nullable().optional().or(z.literal(''));
const optionalMoney = z.coerce.number().nonnegative().max(99_999_999.99).nullable().optional();
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
const optionalUuid = z.string().uuid().nullable().optional();

const hotelVoucherBaseSchema = z.object({
  customerId: optionalUuid,
  queryId: optionalUuid,
  hotelId: optionalUuid,
  /**
   * Quotation provenance for vouchers created from a quotation. Validated on
   * the server (same company, option belongs to the quotation's applicable
   * version, lead/customer/hotel refs consistent) but never persisted — the
   * voucher keeps only the existing customerId/queryId/hotelId refs plus its
   * snapshot fields.
   */
  quotationId: optionalUuid,
  quotationHotelOptionId: optionalUuid,
  guestName: z.string().trim().min(2).max(160),
  guestPhone: optionalText(32),
  guestEmail: optionalEmail,
  adults: z.coerce.number().int().min(0).max(50).default(1),
  children: z.coerce.number().int().min(0).max(50).default(0),
  hotelName: z.string().trim().min(2).max(200),
  hotelAddress: optionalText(1000),
  hotelCity: optionalText(100),
  hotelPhone: optionalText(40),
  hotelEmail: optionalEmail,
  hotelStarRating: optionalText(20),
  checkIn: dateOnly,
  checkOut: dateOnly,
  roomTypeName: optionalText(160),
  rooms: z.coerce.number().int().min(1).max(100).default(1),
  mealPlanName: optionalText(160),
  confirmationNumber: optionalText(80),
  /**
   * Optional external booking reference typed by staff. Free text only —
   * never a Booking relation and never a substitute for confirmationNumber.
   */
  bookingId: optionalText(80),
  /**
   * Optional staff-customized display labels for the two reference fields.
   * Null/blank falls back to the built-in defaults ("Confirmation Number",
   * "Booking ID"). Labels never alter the stored reference values.
   */
  confirmationNumberLabel: optionalText(80),
  bookingIdLabel: optionalText(80),
  specialRequests: optionalText(2000),
  remarks: optionalText(2000),
  termsSnapshot: optionalText(10_000),
});

const checkOutAfterCheckIn = <T extends { checkIn?: unknown; checkOut?: unknown }>(value: T) => {
  if (typeof value.checkIn !== 'string' || typeof value.checkOut !== 'string') return true;
  return value.checkOut > value.checkIn;
};

/**
 * Optional pricing rows. Every value is manually entered (there is no
 * row-level calculation engine); `gst` is a percentage (e.g. 18).
 */
export const hotelVoucherPricingRowSchema = z.object({
  roomType: z.string().trim().min(1).max(160),
  unit: z.coerce.number().int().min(0).max(1000).default(1),
  quantity: z.coerce.number().int().min(0).max(1000).default(1),
  gst: z.coerce.number().min(0).max(100).nullable().optional(),
  amount: optionalMoney,
  taxablePay: optionalMoney,
  gstService: optionalMoney,
});

/**
 * Optional guest rows. Voucher-scoped `M`/`F` and `ADULT`/`CHILD` literals
 * (distinct from the MALE/FEMALE user-profile enum).
 */
export const hotelVoucherGuestRowSchema = z.object({
  guestName: z.string().trim().min(2).max(160),
  age: z.coerce.number().int().min(0).max(120).nullable().optional(),
  sex: z.enum(['M', 'F']),
  paxType: z.enum(['ADULT', 'CHILD']),
});

/**
 * Optional package-includes items. Plain snapshot strings rendered paired
 * (two per row) in the voucher PDF. Blank entries are rejected so no empty
 * rows can be saved.
 */
export const hotelVoucherPackageIncludeItemSchema = z.string().trim().min(1).max(200);

const pricedVoucherSchema = hotelVoucherBaseSchema.extend({
  pricing: z.array(hotelVoucherPricingRowSchema).max(100).optional(),
  guests: z.array(hotelVoucherGuestRowSchema).max(100).optional(),
  packageIncludes: z.array(hotelVoucherPackageIncludeItemSchema).max(100).optional(),
});

export const hotelVoucherInputSchema = pricedVoucherSchema.refine(checkOutAfterCheckIn, {
  path: ['checkOut'],
  message: 'Check-out must be after check-in.',
});

export const hotelVoucherUpdateSchema = pricedVoucherSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.')
  .refine(checkOutAfterCheckIn, {
    path: ['checkOut'],
    message: 'Check-out must be after check-in.',
  });

export const hotelVoucherEmailInputSchema = z.object({
  recipientEmail: z.string().trim().email().max(255),
  subject: optionalText(255),
  message: optionalText(4000),
});

export type HotelVoucherInput = z.infer<typeof hotelVoucherInputSchema>;
export type HotelVoucherUpdateInput = z.infer<typeof hotelVoucherUpdateSchema>;
export type HotelVoucherEmailInput = z.infer<typeof hotelVoucherEmailInputSchema>;
export type HotelVoucherPricingRowInput = z.infer<typeof hotelVoucherPricingRowSchema>;
export type HotelVoucherGuestRowInput = z.infer<typeof hotelVoucherGuestRowSchema>;
export type HotelVoucherPackageIncludeItemInput = z.infer<
  typeof hotelVoucherPackageIncludeItemSchema
>;
