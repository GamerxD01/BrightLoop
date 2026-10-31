import { z } from 'zod';

export const idSchema = z.coerce.number().int().positive();

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date');

/** Integer paise, up to ₹1,00,00,00,000 per amount. */
export const moneySchema = z
  .number({ invalid_type_error: 'Enter an amount' })
  .int('Amount has too many decimals')
  .min(0, 'Amount cannot be negative')
  .max(100_000_000_00, 'Amount is too large');

/** Basis points: 0 – 10,000 (0% – 100%). */
export const basisPointsSchema = z
  .number({ invalid_type_error: 'Enter a percentage' })
  .int()
  .min(0, 'Cannot be negative')
  .max(10_000, 'Cannot exceed 100%');

export const trimmed = (label: string, max = 160) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`);

export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, 'Too long')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/** The single error shape every API failure returns. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    requestId?: string;
  };
}

/** Flattens Zod issues to { "lines.0.quantity": "message" }. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
