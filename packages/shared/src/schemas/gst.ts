import { z } from 'zod';
import { STATE_CODES, isValidGstin } from '../gst';

/** Optional fields that arrive as '' from a form become null. */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const gstinSchema = z.preprocess(
  (v) => (typeof v === 'string' ? blankToNull(v.trim().toUpperCase()) : v),
  z
    .string()
    .length(15, 'A GSTIN has 15 characters')
    .refine(isValidGstin, 'This GSTIN is not valid (check the last character)')
    .nullable()
    .default(null),
);

export const stateCodeSchema = z.preprocess(
  blankToNull,
  z.enum(STATE_CODES).nullable().default(null),
);

export const hsnSacSchema = z.preprocess(
  (v) => (typeof v === 'string' ? blankToNull(v.trim()) : v),
  z
    .string()
    .regex(/^[0-9]{4,8}$/, 'HSN/SAC is 4 to 8 digits')
    .nullable()
    .default(null),
);

/** A GSTIN starts with the state code; both must agree when both are given. */
export function gstinMatchesState<T extends { gstin: string | null; stateCode: string | null }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gstin'],
      message: 'GSTIN does not match the selected state',
    });
  }
}
