import { z } from 'zod';
import { PAYMENT_METHODS } from './bookings.js';
import type { PAYMENT_RECORD_STATUSES } from './bookings.js';

/**
 * Standalone Payments contracts — customer collections with NO Booking
 * dependency. A PaymentCase owns one trip's agreed amount; CustomerPayment
 * rows are the only cash ledger; PaymentReceipt rows are generated voucher
 * documents. Balances are always derived (tripAmount minus collected), never
 * stored.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalEmail = z.string().trim().max(255).email().nullable().optional().or(z.literal(''));
const positiveMoney = z.coerce.number().finite().positive().max(99_999_999.99);
const optionalUuid = z.string().uuid().nullable().optional();
const currency = z.string().trim().toUpperCase().length(3).default('INR');

export const paymentCaseInputSchema = z.object({
  customerId: optionalUuid,
  queryId: optionalUuid,
  customerName: z.string().trim().min(2).max(160),
  customerPhone: optionalText(32),
  customerEmail: optionalEmail,
  title: z.string().trim().min(2).max(200),
  tripAmount: positiveMoney,
  currency,
});

/**
 * Find-or-create a payment case for a lead. The server derives the trip
 * title, agreed amount and currency from the lead's applicable linked
 * quotation (latest non-deleted quotation, latest version). Optional fields
 * let the caller supply values the server could not derive (e.g. a lead
 * without a usable quotation amount); they win over derived values.
 */
export const leadPaymentCaseInputSchema = z.object({
  queryId: z.string().uuid(),
  title: z.string().trim().min(2).max(200).nullable().optional(),
  tripAmount: positiveMoney.nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3).nullable().optional(),
});

export const paymentInputSchema = z.object({
  caseId: z.string().uuid(),
  amount: positiveMoney,
  currency: z.string().trim().toUpperCase().length(3),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentStatus: z.enum(['RECEIVED', 'PENDING_CLEARANCE', 'CLEARED']).default('RECEIVED'),
  receivedAt: z.coerce.date(),
  referenceNumber: optionalText(255),
  bankName: optionalText(200),
  notes: optionalText(2000),
});

export const paymentUpdateSchema = paymentInputSchema
  .omit({ caseId: true, amount: true, currency: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const paymentReversalSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
});

export type PaymentCaseInput = z.infer<typeof paymentCaseInputSchema>;
export type LeadPaymentCaseInput = z.infer<typeof leadPaymentCaseInputSchema>;
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type PaymentUpdateInput = z.infer<typeof paymentUpdateSchema>;
export type PaymentReversalInput = z.infer<typeof paymentReversalSchema>;
export type StandalonePaymentMethod = (typeof PAYMENT_METHODS)[number];
export type StandalonePaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];
