import request from 'supertest';
import { createApp } from '../src/app';
import { migrate } from '../src/db/migrate';
import { pool, query, queryOne } from '../src/db/pool';
import { hashPassword } from '../src/lib/security';

export const app = createApp();
export const PASSWORD = 'Sup3r!secret';

let ready: Promise<void> | null = null;

/** Migrates once and creates an admin + staff account. */
export function bootstrap() {
  ready ??= (async () => {
    await migrate();
    if (
      !(await queryOne(
        pool,
        `SELECT 1 FROM users WHERE email <> 'automation@brightloop.internal' LIMIT 1`,
      ))
    ) {
      const hash = await hashPassword(PASSWORD);
      await query(
        pool,
        `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@t.test', $1, 'Admin', 'admin'),
                                ('staff@t.test', $1, 'Staff', 'staff')`,
        [hash],
      );
      await query(pool, `INSERT INTO taxes (name, rate_bp) VALUES ('GST 18%', 1800)`);
      await query(pool, `INSERT INTO payment_terms (name, due_days) VALUES ('15 days', 15)`);
    }
  })();
  return ready;
}

/** A supertest agent that keeps the session cookie. */
export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
