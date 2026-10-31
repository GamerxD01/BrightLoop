import { z } from 'zod';
import { BILLING_PERIODS } from '../constants';
import { hsnSacSchema } from './gst';
import { idSchema, isoDateSchema, moneySchema, optionalText, trimmed } from './common';

export const planSchema = z
  .object({
    name: trimmed('Name', 120),
    price: moneySchema,
    billingPeriod: z.enum(BILLING_PERIODS),
    billingInterval: z.number().int().min(1, 'At least 1').max(36, 'At most 36'),
    minQuantity: z.number().int().min(1, 'At least 1').max(100_000),
    startDate: isoDateSchema,
    endDate: isoDateSchema.nullable().default(null),
    taxId: idSchema.nullable().default(null),
    hsnSac: hsnSacSchema,
    autoClose: z.boolean(),
    closable: z.boolean(),
    pausable: z.boolean(),
    renewable: z.boolean(),
    isActive: z.boolean().default(true),
  })
  .refine((p) => !p.endDate || p.endDate >= p.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  });
export type PlanInput = z.infer<typeof planSchema>;

const templateLineSchema = z.object({
  productId: idSchema,
  variantId: idSchema.nullable().default(null),
  quantity: z.number().int().min(1, 'At least 1').max(100_000),
});

export const templateSchema = z.object({
  name: trimmed('Name', 120),
  planId: idSchema,
  validityDays: z.number().int().min(1, 'At least 1 day').max(365, 'At most 365 days'),
  paymentTermId: idSchema,
  notes: optionalText(),
  lines: z.array(templateLineSchema).max(50).default([]),
});
export type TemplateInput = z.infer<typeof templateSchema>;
