import { addMonths, todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, query, queryOne } from '../src/db/pool';
import { bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
const invoices: { id: number; number: string; due: number }[] = [];

const money = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const today = () => todayIso().split('-').reverse().join('/');

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  const term = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!;
  const plan = await admin.post('/api/plans').send({
    name: 'Bank Test Monthly',
    price: 777_00,
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

  // Three customers with one open invoice each, with different amounts.
  for (const [i, name] of ['Zephyr Looms', 'Quill Bakery', 'Marigold Tours'].entries()) {
    const c = await admin
      .post('/api/customers')
      .send({ name, email: `bank${i}@x.test`, company: name });
    const sub = await admin.post('/api/subscriptions').send({
      customerId: c.body.data.id,
      planId: plan.body.data.id,
      planQuantity: i + 1,
      startDate: addMonths(todayIso(), 0),
      paymentTermId: term.id,
    });
    for (const action of ['send_quotation', 'confirm', 'activate']) {
      await admin.post(`/api/subscriptions/${sub.body.data.id}/actions`).send({ action });
    }
    await admin.post(`/api/billing/subscriptions/${sub.body.data.id}`).send({});
    const inv = (await queryOne<{ id: number; number: string; due: number }>(
      pool,
      `SELECT id, number, amount_total - amount_paid AS due FROM invoices WHERE subscription_id = $1`,
      [sub.body.data.id],
    ))!;
    await admin.post(`/api/invoices/${inv.id}/actions`).send({ action: 'confirm' });
    invoices.push(inv);
  }
});

function statement() {
  const [a, b, c] = invoices;
  return [
    'Demo Bank,,,,',
    'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.',
    `${today()},"NEFT CR-ZEPHYR LOOMS-${a!.number}",N1,,"${money(a!.due)}"`,
    `${today()},"UPI/QUILL/PAYMENT ${b!.number.replace(/\//g, '-')}",U2,,"${money(Math.round(b!.due / 2))}"`,
    `${today()},"IMPS MARIGOLD TOURS",I3,,"${money(c!.due)}"`,
    `${today()},"ACH DEBIT RENT",A4,"35,000.00",`,
    `${today()},"NEFT CR-SOMEONE ELSE",N5,,"1,234.00"`,
  ].join('\n');
}

describe('bank statement import', () => {
  let importId: number;
  let lines: {
    id: number;
    status: string;
    invoiceId: number | null;
    reason: string;
    direction: string;
  }[];

  it('reads the file and matches each line, saying why', async () => {
    const res = await admin
      .post('/api/bank-imports')
      .send({ filename: 'october.csv', content: statement() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    importId = res.body.data.id;
    lines = res.body.data.lines;
    expect(lines.map((l) => l.status)).toEqual([
      'matched',
      'matched',
      'matched',
      'ignored',
      'unmatched',
    ]);
    expect(lines[0]!.invoiceId).toBe(invoices[0]!.id);
    expect(lines[0]!.reason).toMatch(/exactly what is owed/);
    expect(lines[1]!.reason).toMatch(/part payment/);
    expect(lines[2]!.reason).toMatch(/Customer name and amount/);
    expect(lines[3]!.reason).toBe('Money going out');
  });

  it('lets staff point a line at an invoice by number, and refuses one that does not exist', async () => {
    const bad = await admin
      .patch(`/api/bank-imports/${importId}/lines/${lines[4]!.id}`)
      .send({ invoiceNumber: 'INV/2099/99999' });
    expect(bad.status).toBe(422);
    const set = await admin
      .patch(`/api/bank-imports/${importId}/lines/${lines[4]!.id}`)
      .send({ ignore: true });
    expect(set.body.data.status).toBe('ignored');
  });

  it('records the approved lines as payments, each once', async () => {
    const ids = lines.slice(0, 3).map((l) => l.id);
    const res = await admin.post(`/api/bank-imports/${importId}/post`).send({ lineIds: ids });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.posted).toBe(3);

    const statuses = await query<{ status: string; amountPaid: number; amountTotal: number }>(
      pool,
      'SELECT status, amount_paid, amount_total FROM invoices WHERE id = ANY($1::bigint[]) ORDER BY id',
      [invoices.map((i) => i.id)],
    );
    expect(statuses.map((s) => s.status)).toEqual(['paid', 'confirmed', 'paid']);
    expect(statuses[1]!.amountPaid).toBe(Math.round(invoices[1]!.due / 2));

    // Posting the same lines again does nothing.
    const again = await admin.post(`/api/bank-imports/${importId}/post`).send({ lineIds: ids });
    expect(again.body.data.posted).toBe(0);
    const payments = await query(
      pool,
      `SELECT id FROM payments WHERE note LIKE 'Bank statement:%'`,
    );
    expect(payments).toHaveLength(3);
  });

  it('spots the same transactions when the statement is uploaded again', async () => {
    const res = await admin
      .post('/api/bank-imports')
      .send({ filename: 'october-again.csv', content: statement() });
    expect(res.body.data.lines.slice(0, 3).map((l: { status: string }) => l.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
  });

  it('explains a file it cannot read and serves a sample to try', async () => {
    const bad = await admin
      .post('/api/bank-imports')
      .send({ filename: 'x.csv', content: 'foo,bar\n1,2' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/column headings/);
    const sample = await admin.get('/api/bank-imports/sample');
    expect(sample.headers['content-type']).toMatch(/text\/csv/);
    expect(sample.text).toMatch(/Deposit Amt\./);
  });
});
