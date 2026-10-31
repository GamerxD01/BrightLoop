import { z } from 'zod';
import { PRODUCT_TYPES } from '../constants';
import { hsnSacSchema } from './gst';
import { basisPointsSchema, idSchema, moneySchema, optionalText, trimmed } from './common';

export const taxSchema = z.object({
  name: trimmed('Name', 80),
  rateBp: basisPointsSchema,
  isActive: z.boolean().default(true),
});
export type TaxInput = z.infer<typeof taxSchema>;

export const attributeSchema = z
  .object({
    name: trimmed('Attribute name', 80),
    values: z
      .array(
        z.object({
          id: idSchema.optional(),
          name: trimmed('Value name', 80),
          extraPrice: moneySchema,
        }),
      )
      .min(1, 'Add at least one value')
      .max(50),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.values.forEach((v, i) => {
      const key = v.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['values', i, 'name'],
          message: 'Duplicate value',
        });
      }
      seen.add(key);
    });
  });
export type AttributeInput = z.infer<typeof attributeSchema>;

export const productSchema = z.object({
  name: trimmed('Name', 160),
  type: z.enum(PRODUCT_TYPES),
  salesPrice: moneySchema,
  costPrice: moneySchema,
  notes: optionalText(),
  taxId: idSchema.nullable().default(null),
  hsnSac: hsnSacSchema,
  isActive: z.boolean().default(true),
  /** Attribute values this product is sold in; each becomes a variant. */
  variantValueIds: z.array(idSchema).max(50).default([]),
});
export type ProductInput = z.infer<typeof productSchema>;

export const paymentTermSchema = z.object({
  name: trimmed('Name', 80),
  dueDays: z.number().int().min(0, 'Cannot be negative').max(365, 'At most 365 days'),
});
export type PaymentTermInput = z.infer<typeof paymentTermSchema>;
