import { z } from 'zod';
import { trimmed } from './common';

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

/** Problem statement: more than eight characters, one upper, one lower, one special. */
export const PASSWORD_RULES = [
  { test: (v: string) => v.length > 8, message: 'More than 8 characters' },
  { test: (v: string) => /[A-Z]/.test(v), message: 'An uppercase letter' },
  { test: (v: string) => /[a-z]/.test(v), message: 'A lowercase letter' },
  { test: (v: string) => /[^A-Za-z0-9]/.test(v), message: 'A special character' },
] as const;

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .max(128, 'Password is too long')
  .superRefine((value, ctx) => {
    const missing = PASSWORD_RULES.filter((r) => !r.test(value)).map((r) =>
      r.message.toLowerCase(),
    );
    if (missing.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password needs: ${missing.join(', ')}`,
      });
    }
  });

export const signupSchema = z.object({
  name: trimmed('Name', 120),
  company: z.string().trim().max(160).optional(),
  email: emailSchema,
  password: passwordSchema,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(32, 'Reset link is invalid').max(128, 'Reset link is invalid'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const createStaffSchema = z.object({
  fullName: trimmed('Name', 120),
  email: emailSchema,
  password: passwordSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateUserSchema = z.object({ isActive: z.boolean() });
