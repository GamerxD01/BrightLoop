import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, queryOne } from '../src/db/pool';
import { sha256 } from '../src/lib/security';
import { app, bootstrap, login } from './helpers';

beforeAll(bootstrap);
afterAll(() => undefined);

describe('signup and login', () => {
  it('enforces the password policy with field errors', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'A', email: 'a@x.test', password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.password).toMatch(/more than 8 characters/);
  });

  it('creates a portal customer and refuses a second account on the same email', async () => {
    const ok = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Asha', email: 'Asha@X.test', password: 'Asha!secret1' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.role).toBe('customer');
    expect(ok.headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    const dup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Asha', email: 'asha@x.test', password: 'Asha!secret1' });
    expect(dup.status).toBe(409);
  });

  it('gives the same answer for unknown email and wrong password', async () => {
    const a = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@x.test', password: 'Whatever!123' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@x.test', password: 'Wrong!pass123' });
    expect(a.status).toBe(401);
    expect(b.body.error.message).toBe(a.body.error.message);
  });
});

describe('password reset', () => {
  it('uses a single-use token and ends old sessions', async () => {
    const agent = await login('asha@x.test', 'Asha!secret1');
    expect(
      (await request(app).post('/api/auth/forgot-password').send({ email: 'asha@x.test' })).status,
    ).toBe(202);

    // Replace the stored hash with a known token, as if we had read the email.
    const token = 'k'.repeat(43);
    await pool.query(
      `UPDATE password_reset_tokens SET token_hash = $1
       WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = 'asha@x.test')`,
      [sha256(token)],
    );

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'Brand!new123' });
    expect(reset.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/auth/reset-password')
          .send({ token, password: 'Again!new123' })
      ).status,
    ).toBe(400);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    await login('asha@x.test', 'Brand!new123');
  });
});

describe('roles', () => {
  it('only the admin can add staff', async () => {
    const staff = await login('staff@t.test');
    const body = { fullName: 'New', email: 'new@t.test', password: 'New!staff123' };
    expect((await staff.post('/api/users').send(body)).status).toBe(403);
    const admin = await login('admin@t.test');
    expect((await admin.post('/api/users').send(body)).status).toBe(201);
    const row = await queryOne<{ role: string }>(
      pool,
      `SELECT role FROM users WHERE email = 'new@t.test'`,
    );
    expect(row?.role).toBe('staff');
  });

  it('keeps customers out of the back office and staff out of admin rules', async () => {
    const customer = await login('asha@x.test', 'Brand!new123');
    expect((await customer.get('/api/subscriptions')).status).toBe(403);
    const staff = await login('staff@t.test');
    expect((await staff.post('/api/discounts').send({})).status).toBe(403);
    expect((await request(app).get('/api/subscriptions')).status).toBe(401);
  });
});
