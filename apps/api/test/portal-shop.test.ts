import request from 'supertest';
import { addDays, todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, queryOne } from '../src/db/pool';
import { app, bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
let customer: Awaited<ReturnType<typeof login>>;
let planId: number;
let retiredId: number;

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  const base = {
    price: 200_00,
    billingPeriod: 'monthly',
    billingInterval: 1,
    minQuantity: 2,
    endDate: null,
    taxId: tax.id,
    hsnSac: '997331',
    autoClose: false,
    closable: true,
    pausable: true,
    renewable: true,
  };
  planId = (await admin.post('/api/plans').send({ ...base, name: 'Shop Monthly', startDate: '2025-01-01' }))
    .body.data.id;
  retiredId = (
    await admin
      .post('/api/plans')
      .send({ ...base, name: 'Shop Future', startDate: addDays(todayIso(), 30) })
  ).body.data.id;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ name: 'Shopper', email: 'shopper@x.test', password: 'Self!serve123' });
  expect(signup.status).toBe(201);
  customer = await login('shopper@x.test', 'Self!serve123');
});

describe('portal plans', () => {
  it('lists only plans on sale today', async () => {
    const res = await customer.get('/api/portal/plans');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: number }) => p.id);
    expect(ids).toContain(planId);
    expect(ids).not.toContain(retiredId);
  });

  it('prices an order and enforces the minimum seats', async () => {
    const ok = await customer
      .post('/api/portal/subscribe/preview')
      .send({ planId, planQuantity: 3, startDate: todayIso() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.untaxed).toBe(600_00);
    const few = await customer
      .post('/api/portal/subscribe/preview')
      .send({ planId, planQuantity: 1, startDate: todayIso() });
    expect(few.status).toBe(422);
  });

  it('subscribes the signed-in customer, starts today, and staff see it', async () => {
    const res = await customer
      .post('/api/portal/subscribe')
      .send({ planId, planQuantity: 3, startDate: todayIso(), customerId: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe('active');
    const staffView = await admin.get(`/api/subscriptions/${res.body.data.id}`);
    expect(staffView.body.data.customerName).toBe('Shopper');
    expect(staffView.body.data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual(
      expect.arrayContaining(['draft', 'quotation', 'confirmed', 'active']),
    );
  });

  it('refuses a plan not on sale, a past start date and staff callers', async () => {
    const future = await customer
      .post('/api/portal/subscribe')
      .send({ planId: retiredId, planQuantity: 2, startDate: todayIso() });
    expect(future.status).toBe(422);
    const past = await customer
      .post('/api/portal/subscribe')
      .send({ planId, planQuantity: 2, startDate: addDays(todayIso(), -3) });
    expect(past.status).toBe(422);
    expect((await admin.get('/api/portal/plans')).status).toBe(403);
  });
});
