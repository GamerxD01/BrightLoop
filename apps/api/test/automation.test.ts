import { addDays, addMonths, todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, query, queryOne } from '../src/db/pool';
import { automationService } from '../src/modules/automation/automation.service';
import { remindersService, stageFor } from '../src/modules/automation/reminders.service';
import type { Actor } from '../src/lib/http';
import { bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
let actor: Actor;
let planId: number;
let termId: number;

async function customer(email: string) {
  const res = await admin.post('/api/customers').send({ name: email.split('@')[0], email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as number;
}

async function subscription(
  customerId: number,
  startDate: string,
  steps: string[],
  expiryDate: string | null = null,
) {
  const res = await admin.post('/api/subscriptions').send({
    customerId,
    planId,
    planQuantity: 1,
    startDate,
    expiryDate,
    paymentTermId: termId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  for (const action of steps) {
    const r = await admin.post(`/api/subscriptions/${res.body.data.id}/actions`).send({ action });
    expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(200);
  }
  return res.body.data.id as number;
}

const emails = (kind: string, entityId: number) =>
  query<{ subject: string }>(
    pool,
    'SELECT subject FROM email_log WHERE kind = $1 AND entity_id = $2 ORDER BY id',
    [kind, entityId],
  );

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const me = (await queryOne<{ id: number }>(
    pool,
    `SELECT id FROM users WHERE email = 'admin@t.test'`,
  ))!;
  actor = { userId: me.id, role: 'admin', customerId: null, requestId: 'test' };
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  termId = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!.id;
  const plan = await admin.post('/api/plans').send({
    name: 'Automation Test Monthly',
    price: 500_00,
    billingPeriod: 'monthly',
    billingInterval: 1,
    minQuantity: 1,
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
});

describe('daily jobs', () => {
  it('start confirmed subscriptions, bill and email them, once per day however often they are checked', async () => {
    const c = await customer('auto-bill@x.test');
    const sub = await subscription(c, addMonths(todayIso(), -2), ['send_quotation', 'confirm']);

    await automationService.tick();
    const after = await queryOne<{ status: string }>(
      pool,
      'SELECT status FROM subscriptions WHERE id = $1',
      [sub],
    );
    expect(after?.status).toBe('active');

    const invoices = await query<{ id: number; status: string }>(
      pool,
      'SELECT id, status FROM invoices WHERE subscription_id = $1',
      [sub],
    );
    expect(invoices).toHaveLength(3); // two missed months and this one
    expect(invoices.every((i) => i.status === 'confirmed')).toBe(true);
    expect(await emails('invoice', invoices[0]!.id)).toHaveLength(1);

    // A second server, or the next interval, finds today's jobs already claimed.
    const runsBefore = await queryOne<{ n: number }>(
      pool,
      `SELECT count(*) AS n FROM job_runs WHERE trigger = 'schedule'`,
    );
    await automationService.tick();
    const runsAfter = await queryOne<{ n: number }>(
      pool,
      `SELECT count(*) AS n FROM job_runs WHERE trigger = 'schedule'`,
    );
    expect(runsAfter!.n).toBe(runsBefore!.n);
    expect(
      await query(pool, 'SELECT id FROM invoices WHERE subscription_id = $1', [sub]),
    ).toHaveLength(3);
  });

  it('records each run with its outcome, and lets an admin run a job by hand', async () => {
    const run = await admin.post('/api/automation/renewals/run').send({});
    expect(run.status).toBe(200);
    expect(run.body.data.status).toBe('done');
    const status = await admin.get('/api/automation');
    expect(
      status.body.data.runs.some(
        (r: { job: string; trigger: string }) => r.job === 'renewals' && r.trigger === 'manual',
      ),
    ).toBe(true);
    const staff = await login('staff@t.test');
    expect((await staff.post('/api/automation/billing/run').send({})).status).toBe(403);
  });
});

describe('overdue reminders', () => {
  it('escalate polite → firm → final, each sent once, skipping stages already passed', async () => {
    expect([0, 2, 3, 6, 7, 13, 14, 40].map(stageFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);

    const c = await customer('auto-late@x.test');
    const sub = await subscription(c, addMonths(todayIso(), -1), [
      'send_quotation',
      'confirm',
      'activate',
    ]);
    await admin.post(`/api/billing/subscriptions/${sub}`).send({});
    const inv = (await queryOne<{ id: number; dueDate: string }>(
      pool,
      'SELECT id, due_date FROM invoices WHERE subscription_id = $1 ORDER BY id LIMIT 1',
      [sub],
    ))!;
    await query(
      pool,
      `UPDATE invoices SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
      [inv.id],
    );

    // First seen 8 days late: only the firm reminder goes, the polite one is skipped.
    const day8 = addDays(inv.dueDate, 8);
    await remindersService.sendDue(actor, day8);
    await remindersService.sendDue(actor, day8);
    let stages = await query<{ stage: number }>(
      pool,
      'SELECT stage FROM invoice_reminders WHERE invoice_id = $1 ORDER BY id',
      [inv.id],
    );
    expect(stages.map((s) => s.stage)).toEqual([2]);

    await remindersService.sendDue(actor, addDays(inv.dueDate, 15));
    stages = await query<{ stage: number }>(
      pool,
      'SELECT stage FROM invoice_reminders WHERE invoice_id = $1 ORDER BY id',
      [inv.id],
    );
    expect(stages.map((s) => s.stage)).toEqual([2, 3]);
    expect(await emails('reminder', inv.id)).toHaveLength(2);
  });

  it('allow one reminder by hand per day, and never on a paid invoice', async () => {
    const inv = (await queryOne<{ id: number }>(
      pool,
      `SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.email = 'auto-late@x.test' ORDER BY i.id LIMIT 1`,
    ))!;
    // The automatic reminders above went out today, so a manual one is refused…
    expect((await admin.post(`/api/invoices/${inv.id}/remind`).send({})).status).toBe(422);
    // …until a day has passed.
    await query(
      pool,
      `UPDATE invoice_reminders SET created_at = now() - interval '2 days' WHERE invoice_id = $1`,
      [inv.id],
    );
    expect((await admin.post(`/api/invoices/${inv.id}/remind`).send({})).status).toBe(201);
    const again = await admin.post(`/api/invoices/${inv.id}/remind`).send({});
    expect(again.status).toBe(422);
    expect(again.body.error.message).toMatch(/already went out today/);
    const history = await admin.get(`/api/invoices/${inv.id}/reminders`);
    expect(history.body.data.map((r: { stage: number }) => r.stage).sort()).toEqual([0, 2, 3]);

    const paid = await queryOne<{ id: number }>(
      pool,
      `SELECT id FROM invoices WHERE status = 'paid' LIMIT 1`,
    );
    if (paid)
      expect((await admin.post(`/api/invoices/${paid.id}/remind`).send({})).status).toBe(422);
  });
});

describe('renewal notices', () => {
  it('warn 30 and 7 days before expiry, once each, and not once a renewal exists', async () => {
    const c = await customer('auto-renew@x.test');
    const sub = await subscription(
      c,
      addMonths(todayIso(), -3),
      ['send_quotation', 'confirm', 'activate'],
      addDays(todayIso(), 20),
    );
    const renewed = await subscription(
      await customer('auto-renewed@x.test'),
      addMonths(todayIso(), -3),
      ['send_quotation', 'confirm', 'activate'],
      addDays(todayIso(), 6),
    );
    await admin.post(`/api/subscriptions/${renewed}/actions`).send({ action: 'renew' });

    await automationService.runNow('renewals', actor);
    await automationService.runNow('renewals', actor);
    const notices = await query<{ kind: string }>(
      pool,
      'SELECT kind FROM subscription_notices WHERE subscription_id = $1',
      [sub],
    );
    expect(notices.map((n) => n.kind)).toEqual(['renewal_30']);
    expect(await emails('renewal', sub)).toHaveLength(1);
    expect(await emails('renewal', renewed)).toHaveLength(0);

    const radar = await admin.get('/api/subscriptions?expiringWithin=30');
    expect(radar.body.data.map((s: { id: number }) => s.id)).toContain(sub);
    const dash = await admin.get('/api/reports/summary');
    const row = dash.body.data.renewalsDue.find((r: { id: number }) => r.id === renewed);
    expect(row.renewalId).toBeTruthy();
  });
});
