import { addMonths, todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, query, queryOne } from '../src/db/pool';
import request from 'supertest';
import { app, bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
let subscriptionId: number;
let customerId: number;

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  const term = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!;

  const plan = await admin.post('/api/plans').send({
    name: 'Billing Test Monthly',
    price: 100_00,
    billingPeriod: 'monthly',
    billingInterval: 1,
    minQuantity: 2,
    startDate: '2025-01-01',
    endDate: null,
    taxId: tax.id,
    autoClose: false,
    closable: true,
    pausable: true,
    renewable: true,
  });
  expect(plan.status).toBe(201);
  const discount = await admin.post('/api/discounts').send({
    name: 'Two uses only',
    type: 'fixed',
    value: 10_00,
    scope: 'subscription',
    productIds: [],
    minAmount: 0,
    minQuantity: 0,
    startDate: '2025-01-01',
    endDate: null,
    usageLimit: 2,
    isActive: true,
  });
  expect(discount.status).toBe(201);
  const customer = await admin
    .post('/api/customers')
    .send({ name: 'Billing Co', email: 'billing@co.test' });
  customerId = customer.body.data.id;

  const tooFew = await admin.post('/api/subscriptions').send({
    customerId,
    planId: plan.body.data.id,
    planQuantity: 1,
    startDate: addMonths(todayIso(), -3),
    paymentTermId: term.id,
  });
  expect(tooFew.status).toBe(422);
  expect(tooFew.body.error.fieldErrors.planQuantity).toMatch(/at least 2/);

  const sub = await admin.post('/api/subscriptions').send({
    customerId,
    planId: plan.body.data.id,
    planQuantity: 2,
    startDate: addMonths(todayIso(), -3),
    paymentTermId: term.id,
    discountIds: [discount.body.data.id],
  });
  expect(sub.status).toBe(201);
  subscriptionId = sub.body.data.id;
  expect(sub.body.data.amountTotal).toBe(236_00);
});

describe('subscription workflow', () => {
  it('refuses to skip steps', async () => {
    const res = await admin
      .post(`/api/subscriptions/${subscriptionId}/actions`)
      .send({ action: 'activate' });
    expect(res.status).toBe(422);
  });

  it('moves draft → quotation → confirmed → active with a timeline', async () => {
    for (const action of ['send_quotation', 'confirm', 'activate']) {
      const res = await admin.post(`/api/subscriptions/${subscriptionId}/actions`).send({ action });
      expect(res.status, action).toBe(200);
    }
    const detail = await admin.get(`/api/subscriptions/${subscriptionId}`);
    expect(detail.body.data.status).toBe('active');
    expect(detail.body.data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'draft',
      'quotation',
      'confirmed',
      'active',
    ]);
  });
});

describe('billing run', () => {
  it('bills every missed period once, applies the discount until its limit', async () => {
    const run = await admin.post('/api/billing/run').send({ autoConfirm: true });
    expect(run.status).toBe(200);
    const invoices = await query<{ amountDiscount: number; periodStart: string }>(
      pool,
      'SELECT amount_discount, period_start FROM invoices WHERE subscription_id = $1 ORDER BY period_start',
      [subscriptionId],
    );
    expect(invoices).toHaveLength(4); // 3 months ago, 2, 1 and this month
    expect(invoices.map((i) => i.amountDiscount)).toEqual([10_00, 10_00, 0, 0]);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const before = await queryOne<{ n: number }>(pool, 'SELECT count(*) AS n FROM invoices');
    const run = await admin.post('/api/billing/run').send({});
    expect(run.body.data.invoicesCreated).toBe(0);
    expect((await queryOne<{ n: number }>(pool, 'SELECT count(*) AS n FROM invoices'))!.n).toBe(
      before!.n,
    );
  });

  it('the database itself refuses a duplicate period', async () => {
    const inv = (await queryOne<{ periodStart: string }>(
      pool,
      'SELECT period_start FROM invoices WHERE subscription_id = $1 LIMIT 1',
      [subscriptionId],
    ))!;
    await expect(
      pool.query(
        `INSERT INTO invoices (number, subscription_id, customer_id, period_start, period_end, invoice_date, due_date,
                               amount_untaxed, amount_tax, amount_total)
         VALUES ('X', $1, $2, $3, $3, $3, $3, 0, 0, 0)`,
        [subscriptionId, customerId, inv.periodStart],
      ),
    ).rejects.toThrow(/invoices_one_per_period/);
  });
});

describe('payments', () => {
  it('records part and full payment, refuses overpayment', async () => {
    const inv = (await queryOne<{ id: number; amountTotal: number }>(
      pool,
      'SELECT id, amount_total FROM invoices WHERE subscription_id = $1 ORDER BY id LIMIT 1',
      [subscriptionId],
    ))!;
    const half = Math.floor(inv.amountTotal / 2);
    const first = await admin
      .post('/api/payments')
      .send({ invoiceId: inv.id, amount: half, method: 'upi', paidOn: todayIso() });
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe('confirmed');
    const over = await admin
      .post('/api/payments')
      .send({ invoiceId: inv.id, amount: inv.amountTotal, method: 'upi', paidOn: todayIso() });
    expect(over.status).toBe(422);
    const rest = await admin
      .post('/api/payments')
      .send({
        invoiceId: inv.id,
        amount: inv.amountTotal - half,
        method: 'cash',
        paidOn: todayIso(),
      });
    expect(rest.body.data.status).toBe('paid');
  });

  it('shows outstanding and overdue on the dashboard', async () => {
    const res = await admin.get('/api/reports/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.headline.activeSubscriptions).toBeGreaterThanOrEqual(1);
    expect(res.body.data.headline.overdueCount).toBeGreaterThanOrEqual(1);
  });
});

describe('portal isolation', () => {
  it('a customer sees only their own invoices', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Iso', email: 'iso@x.test', password: 'Iso!secret12' });
    expect(signup.status).toBe(201);
    const other = await login('iso@x.test', 'Iso!secret12');
    const list = await other.get('/api/portal/invoices');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const theirs = (await queryOne<{ id: number }>(
      pool,
      'SELECT id FROM invoices WHERE subscription_id = $1 LIMIT 1',
      [subscriptionId],
    ))!;
    expect((await other.get(`/api/portal/invoices/${theirs.id}`)).status).toBe(404);
    expect((await other.get(`/api/portal/subscriptions/${subscriptionId}`)).status).toBe(404);
  });
});
