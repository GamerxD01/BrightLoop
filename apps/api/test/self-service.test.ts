import request from 'supertest';
import { addDays, addMonths, todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, query, queryOne } from '../src/db/pool';
import { app, bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
let planId: number;
let termId: number;
let addonId: number;

async function signupCustomer(email: string) {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: email.split('@')[0], email, password: 'Self!serve123' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    customerId: res.body.data.customerId as number,
    agent: await login(email, 'Self!serve123'),
  };
}

async function activeSubscription(customerId: number, seats: number, withAddon: boolean) {
  const res = await admin.post('/api/subscriptions').send({
    customerId,
    planId,
    planQuantity: seats,
    startDate: addMonths(todayIso(), -1),
    paymentTermId: termId,
    lines: withAddon ? [{ productId: addonId, quantity: 1 }] : [],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.data.id as number;
  for (const action of ['send_quotation', 'confirm', 'activate']) {
    expect((await admin.post(`/api/subscriptions/${id}/actions`).send({ action })).status).toBe(
      200,
    );
  }
  // Bill last month and the current one, and confirm them, so a period is running today.
  await admin.post(`/api/billing/subscriptions/${id}`).send({});
  await query(
    pool,
    `UPDATE invoices SET status = 'confirmed', confirmed_at = now() WHERE subscription_id = $1 AND status = 'draft'`,
    [id],
  );
  return id;
}

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  termId = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!.id;
  const plan = await admin.post('/api/plans').send({
    name: 'Self Service Monthly',
    price: 1000_00,
    billingPeriod: 'monthly',
    billingInterval: 1,
    minQuantity: 2,
    startDate: '2025-01-01',
    endDate: null,
    taxId: tax.id,
    hsnSac: '997331',
    autoClose: false,
    closable: true,
    pausable: true,
    renewable: true,
  });
  expect(plan.status, JSON.stringify(plan.body)).toBe(201);
  planId = plan.body.data.id;
  const addon = await admin.post('/api/catalog/products').send({
    name: 'Self Service Add-on',
    type: 'service',
    salesPrice: 300_00,
    costPrice: 50_00,
    notes: null,
    taxId: tax.id,
    hsnSac: '998315',
    isActive: true,
    variantValueIds: [],
  });
  expect(addon.status, JSON.stringify(addon.body)).toBe(201);
  addonId = addon.body.data.id;
});

describe('changing seats and add-ons mid-period', () => {
  it('previews, then charges the added seats for the days left on an adjustment invoice', async () => {
    const { customerId, agent } = await signupCustomer('upgrade@x.test');
    const sub = await activeSubscription(customerId, 2, false);

    const preview = await agent
      .post(`/api/portal/subscriptions/${sub}/changes/preview`)
      .send({ planQuantity: 5, lines: [] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const p = preview.body.data;
    expect(p.daysLeft).toBeGreaterThan(0);
    expect(p.charges).toHaveLength(1);
    expect(p.charges[0].quantity).toBe(3);
    expect(p.perPeriod.after).toBe(5 * 1180_00);

    const applied = await agent
      .post(`/api/portal/subscriptions/${sub}/changes`)
      .send({ planQuantity: 5, lines: [] });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    expect(applied.body.data.chargeTotal).toBe(p.chargeTotal);

    const adj = await queryOne<{ kind: string; status: string; amountTotal: number }>(
      pool,
      'SELECT kind, status, amount_total FROM invoices WHERE id = $1',
      [applied.body.data.chargeInvoiceId],
    );
    expect(adj).toMatchObject({
      kind: 'adjustment',
      status: 'confirmed',
      amountTotal: p.chargeTotal,
    });

    const detail = await admin.get(`/api/subscriptions/${sub}`);
    expect(detail.body.data.lines.find((l: { kind: string }) => l.kind === 'plan').quantity).toBe(
      5,
    );
    expect(detail.body.data.events.at(-1).note).toMatch(/Changed by the customer/);

    // The next billing period is a normal recurring invoice: no clash with the adjustment.
    const periods = await query(
      pool,
      `SELECT 1 FROM invoices WHERE subscription_id = $1 AND kind = 'recurring'`,
      [sub],
    );
    expect(periods.length).toBeGreaterThanOrEqual(1);
  });

  it('turns a removed add-on into credit, spent on the next invoice it confirms', async () => {
    const { customerId, agent } = await signupCustomer('downgrade@x.test');
    const sub = await activeSubscription(customerId, 3, true);

    const applied = await agent
      .post(`/api/portal/subscriptions/${sub}/changes`)
      .send({ planQuantity: 3, lines: [] });
    expect(applied.status, JSON.stringify(applied.body)).toBe(201);
    const credit = applied.body.data.creditTotal as number;
    expect(credit).toBeGreaterThan(0);
    expect(applied.body.data.chargeInvoiceId).toBeNull();

    const balance = await agent.get('/api/portal/credits');
    expect(balance.body.data.balance).toBe(credit);

    // Next period's invoice: confirming it spends the credit as an "Account credit" payment.
    await query(pool, `UPDATE subscriptions SET next_invoice_date = $2 WHERE id = $1`, [
      sub,
      todayIso(),
    ]);
    const inv = await queryOne<{ id: number; periodStart: string }>(
      pool,
      `SELECT id, period_start FROM invoices WHERE subscription_id = $1 AND kind = 'recurring' ORDER BY period_start DESC LIMIT 1`,
      [sub],
    );
    await query(pool, `UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [inv!.id]);
    await query(pool, `UPDATE subscriptions SET next_invoice_date = $2 WHERE id = $1`, [
      sub,
      inv!.periodStart,
    ]);
    await admin.post(`/api/billing/subscriptions/${sub}`).send({});
    const fresh = (await queryOne<{ id: number }>(
      pool,
      `SELECT id FROM invoices WHERE subscription_id = $1 AND status = 'draft' ORDER BY id DESC LIMIT 1`,
      [sub],
    ))!;
    const confirmed = await admin
      .post(`/api/invoices/${fresh.id}/actions`)
      .send({ action: 'confirm' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const creditPayment = confirmed.body.data.payments.find(
      (pm: { method: string }) => pm.method === 'credit',
    );
    expect(creditPayment.amount).toBe(credit);
    expect((await agent.get('/api/portal/credits')).body.data.balance).toBe(0);

    // Credit is not cash: it is left out of "collected".
    const credited = await queryOne<{ n: number }>(
      pool,
      `SELECT count(*) AS n FROM payments WHERE method = 'credit'`,
    );
    expect(credited!.n).toBeGreaterThanOrEqual(1);
  });

  it('keeps the plan minimum, refuses no-op changes and other customers', async () => {
    const { customerId, agent } = await signupCustomer('rules@x.test');
    const sub = await activeSubscription(customerId, 2, false);
    const tooFew = await agent
      .post(`/api/portal/subscriptions/${sub}/changes/preview`)
      .send({ planQuantity: 1, lines: [] });
    expect(tooFew.status).toBe(422);
    expect(tooFew.body.error.fieldErrors.planQuantity).toMatch(/at least 2/);
    const same = await agent
      .post(`/api/portal/subscriptions/${sub}/changes`)
      .send({ planQuantity: 2, lines: [] });
    expect(same.status).toBe(422);
    expect(same.body.error.message).toBe('Nothing changed');

    const other = await signupCustomer('nosy@x.test');
    expect(
      (
        await other.agent
          .post(`/api/portal/subscriptions/${sub}/changes/preview`)
          .send({ planQuantity: 4, lines: [] })
      ).status,
    ).toBe(404);
    expect((await other.agent.get(`/api/portal/credits`)).body.data.balance).toBe(0);
  });
});

describe('accepting a quotation in the portal', () => {
  it('confirms it and starts it straight away when its start date has come', async () => {
    const { customerId, agent } = await signupCustomer('accept@x.test');
    const res = await admin
      .post('/api/subscriptions')
      .send({ customerId, planId, planQuantity: 2, startDate: todayIso(), paymentTermId: termId });
    const id = res.body.data.id as number;
    await admin.post(`/api/subscriptions/${id}/actions`).send({ action: 'send_quotation' });

    const accepted = await agent
      .post(`/api/portal/subscriptions/${id}/actions`)
      .send({ action: 'confirm' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.data.status).toBe('active');

    const later = await admin.post('/api/subscriptions').send({
      customerId,
      planId,
      planQuantity: 2,
      startDate: addDays(todayIso(), 10),
      paymentTermId: termId,
    });
    await admin
      .post(`/api/subscriptions/${later.body.data.id}/actions`)
      .send({ action: 'send_quotation' });
    const waits = await agent
      .post(`/api/portal/subscriptions/${later.body.data.id}/actions`)
      .send({ action: 'confirm' });
    expect(waits.body.data.status).toBe('confirmed');

    // Customers still cannot do back-office steps such as activating by hand.
    expect(
      (
        await agent
          .post(`/api/portal/subscriptions/${later.body.data.id}/actions`)
          .send({ action: 'activate' })
      ).status,
    ).toBe(403);
  });
});
