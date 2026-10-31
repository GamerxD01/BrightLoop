import { z } from 'zod';
import { optionalText, trimmed } from './common';
import { gstinMatchesState, gstinSchema, stateCodeSchema } from './gst';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const companySchema = z
  .object({
    brandName: trimmed('Brand name', 60),
    legalName: trimmed('Legal name', 160),
    addressLine: optionalText(240),
    city: optionalText(80),
    stateCode: stateCodeSchema,
    pincode: z.preprocess(
      blank,
      z
        .string()
        .regex(/^[1-9][0-9]{5}$/, 'A PIN code has 6 digits')
        .nullable()
        .default(null),
    ),
    gstin: gstinSchema,
    email: z.preprocess(
      blank,
      z.string().trim().email('Enter a valid email address').nullable().default(null),
    ),
    phone: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number')
        .nullable()
        .default(null),
    ),
    website: z.preprocess(
      blank,
      z.string().trim().url('Start with https://').nullable().default(null),
    ),
    bankName: optionalText(120),
    bankAccount: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .regex(/^[0-9]{6,18}$/, 'Account number is 6 to 18 digits')
        .nullable()
        .default(null),
    ),
    bankIfsc: z.preprocess(
      (v) => (typeof v === 'string' ? blank(v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks like HDFC0001234')
        .nullable()
        .default(null),
    ),
    upiId: z.preprocess(
      blank,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$/, 'UPI ID looks like name@bank')
        .nullable()
        .default(null),
    ),
    invoiceFooter: optionalText(500),
  })
  .superRefine(gstinMatchesState);
export type CompanyInput = z.infer<typeof companySchema>;

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;
