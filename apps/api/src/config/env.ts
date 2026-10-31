import { existsSync } from 'node:fs';
import { z } from 'zod';

// Read apps/api/.env when present (Node's built-in loader; no dotenv needed).
if (existsSync('.env')) process.loadEnvFile('.env');

const DEV_SECRET = 'dev-only-secret-change-me-before-deploying-0123456789';

/** Configuration is validated once at boot; the process refuses to start on bad config. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url().default('postgres://postgres:postgres@localhost:5432/brightloop'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default(DEV_SECRET),
  APP_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SMTP_HOST: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  AUTOMATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTOMATION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  MAIL_FROM: z.string().default('Brightloop Billing <billing@brightloop.test>'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET === DEV_SECRET) {
  console.error('Set a real JWT_SECRET before running in production.');
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
