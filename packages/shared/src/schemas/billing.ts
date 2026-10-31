import { z } from 'zod';
import {
  DISCOUNT_SCOPES,
  DISCOUNT_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  SUBSCRIPTION_STATUSES,
} from '../constants';
import { INVOICE_ACTIONS, SUBSCRIPTION_ACTIONS } from '../workflow';
import { gstinMatchesState, gstinSchema, stateCodeSchema } from './gst';
import {
  idSchema,
  isoDateSchema,
  listQuerySchema,
  moneySchema,
  optionalText,
  trimmed,
} from './common';

export const discountSchema = z
  .object({
    name: trimmed('Name', 120),
    type: z.enum(DISCOUNT_TYPES),
    value: z.number().int().positive('Must be more than zero'),
    scope: z.enum(DISCOUNT_SCOPES),
    productIds: z.array(idSchema).max(200).default([]),
    minAmount: moneySchema.default(0),
    minQuantity: z.number().int().min(0).max(100_000).default(0),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().default(null),
    usageLimit: z.number().int().min(1, 'At least 1').max(1_000_000).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'percentage' && d.value > 10_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Cannot exceed 100%' });
    }
    if (d.type === 'fixed' && d.value > 100_000_000_00) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Amount is too large',
      });
    }
    if (d.scope === 'products' && d.productIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productIds'],
        message: 'Pick at least one product',
      });
    }
    if (d.endDate && d.endDate < d.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be on or after the start date',
      });
    }
  });
export type DiscountInput = z.infer<typeof discountSchema>;

export const customerSchema = z
  .object({
    name: trimmed('Name', 120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
    phone: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal(''))
      .transform((v) => v || null),
    company: optionalText(160),
    address: optionalText(500),
    gstin: gstinSchema,
    stateCode: stateCodeSchema,
  })
  .superRefine(gstinMatchesState);
export type CustomerInput = z.infer<typeof customerSchema>;

export const subscriptionLineSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullable().default(null),
  quantity: z.number().int().min(1, 'At least 1').max(100_000),
  /** Optional negotiated price; defaults to product price + variant extra. */
  unitPrice: moneySchema.nullable().default(null),
});

export const subscriptionSchema = z
  .object({
    customerId: idSchema,
    planId: idSchema,
    templateId: idSchema.nullable().default(null),
    planQuantity: z.number().int().min(1, 'At least 1').max(100_000),
    startDate: isoDateSchema,
    expiryDate: isoDateSchema.nullable().default(null),
    paymentTermId: idSchema,
    notes: optionalText(),
    lines: z.array(subscriptionLineSchema).max(100).default([]),
    discountIds: z.array(idSchema).max(20).default([]),
  })
  .refine((s) => !s.expiryDate || s.expiryDate > s.startDate, {
    path: ['expiryDate'],
    message: 'Expiry must be after the start date',
  });
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

export const fromTemplateSchema = z.object({
  templateId: idSchema,
  customerId: idSchema,
  startDate: isoDateSchema,
});

export const subscriptionActionSchema = z.object({
  action: z.enum(SUBSCRIPTION_ACTIONS),
  note: optionalText(500),
});

export const subscriptionListQuerySchema = listQuerySchema.extend({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planId: idSchema.optional(),
  customerId: idSchema.optional(),
  /** Active subscriptions ending within this many days (the renewal radar). */
  expiringWithin: z.coerce.number().int().min(1).max(365).optional(),
});
export type SubscriptionListQuery = z.infer<typeof subscriptionListQuerySchema>;

export const invoiceActionSchema = z.object({ action: z.enum(INVOICE_ACTIONS) });

export const invoiceListQuerySchema = listQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  customerId: idSchema.optional(),
  subscriptionId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const paymentSchema = z.object({
  invoiceId: idSchema,
  amount: moneySchema.refine((v) => v > 0, 'Amount must be more than zero'),
  method: z.enum(PAYMENT_METHODS),
  paidOn: isoDateSchema,
  note: optionalText(500),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const paymentListQuerySchema = listQuerySchema.extend({
  method: z.enum(PAYMENT_METHODS).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const billingRunSchema = z.object({
  asOf: isoDateSchema.optional(),
  autoConfirm: z.boolean().default(false),
});

export const reportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  planId: idSchema.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
