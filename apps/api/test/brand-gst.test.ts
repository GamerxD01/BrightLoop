import request from 'supertest';
import { addMonths, todayIso, withGstinCheckDigit } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, queryOne } from '../src/db/pool';
import { app, bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function billOneFor(stateCode: string, email: string) {
  const term = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!;
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  let plan = await queryOne<{ id: number }>(
    pool,
    `SELECT id FROM plans WHERE name = 'GST Test Monthly'`,
  );
  if (!plan) {
    const res = await admin.post('/api/plans').send({
      name: 'GST Test Monthly',
      price: 1000_00,
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
    plan = res.body.data;
  }
  const customer = await admin
    .post('/api/customers')
    .send({ name: `GST ${stateCode}`, email, stateCode });
  expect(customer.status).toBe(201);
  const sub = await admin.post('/api/subscriptions').send({
    customerId: customer.body.data.id,
    planId: plan!.id,
    planQuantity: 1,
    startDate: todayIso(),
    paymentTermId: term.id,
  });
  for (const action of ['send_quotation', 'confirm', 'activate'])
    await admin.post(`/api/subscriptions/${sub.body.data.id}/actions`).send({ action });
  const billed = await admin.post(`/api/billing/subscriptions/${sub.body.data.id}`);
  expect(billed.status).toBe(201);
  return (await admin.get(`/api/invoices/${billed.body.data.invoiceIds[0]}`)).body.data;
}

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
});

describe('company profile', () => {
  it('rejects a GSTIN whose check digit is wrong, or that disagrees with the state', async () => {
    const base = { brandName: 'Test Co', legalName: 'Test Co Pvt Ltd', stateCode: '09' };
    const bad = await admin.put('/api/company').send({ ...base, gstin: '09AAKCB4821M1ZX' });
    expect(bad.status).toBe(422);
    const mismatch = await admin
      .put('/api/company')
      .send({ ...base, gstin: withGstinCheckDigit('27AAKCB4821M1Z') });
    expect(mismatch.body.error.fieldErrors.gstin).toMatch(/does not match/);
    const ok = await admin
      .put('/api/company')
      .send({ ...base, gstin: withGstinCheckDigit('09AAKCB4821M1Z'), upiId: 'billing@testbank' });
    expect(ok.status).toBe(200);
  });

  it('only accepts real PNG or JPEG logos, and serves them publicly', async () => {
    const fake = await admin
      .put('/api/company/logo')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not an image'));
    expect(fake.status).toBe(422);
    const real = await admin.put('/api/company/logo').set('Content-Type', 'image/png').send(PNG);
    expect(real.status).toBe(200);
    const brand = await request(app).get('/api/brand');
    expect(brand.body.data.hasLogo).toBe(true);
    const logo = await request(app).get('/api/brand/logo');
    expect(logo.headers['content-type']).toBe('image/png');
  });

  it('staff cannot change the company profile', async () => {
    const staff = await login('staff@t.test');
    expect((await staff.put('/api/company').send({ brandName: 'X', legalName: 'X' })).status).toBe(
      403,
    );
  });
});

describe('GST on invoices', () => {
  it('charges CGST + SGST inside the seller state and IGST across states', async () => {
    const local = await billOneFor('09', 'gst-local@t.test');
    expect(local.gstMode).toBe('intra');
    expect(local.amountCgst + local.amountSgst).toBe(local.amountTax);
    expect(local.amountIgst).toBe(0);
    expect(local.lines[0].hsnSac).toBe('997331');
    expect(local.seller.gstin).toMatch(/^09/);

    const away = await billOneFor('27', 'gst-away@t.test');
    expect(away.gstMode).toBe('inter');
    expect(away.amountIgst).toBe(away.amountTax);
    expect(away.placeOfSupply).toBe('27');
  });

  it('serves a PDF and logs the invoice email with it attached', async () => {
    const inv = (await queryOne<{ id: number }>(
      pool,
      `SELECT id FROM invoices WHERE status = 'draft' ORDER BY id DESC LIMIT 1`,
    ))!;
    const pdf = await admin.get(`/api/invoices/${inv.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const confirmed = await admin
      .post(`/api/invoices/${inv.id}/actions`)
      .send({ action: 'confirm' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const sent = await admin.post(`/api/invoices/${inv.id}/actions`).send({ action: 'send' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const log = await admin.get('/api/outbox').query({ entity: 'invoice', entityId: inv.id });
    expect(log.body.data[0].kind).toBe('invoice');
    expect(log.body.data[0].attachments[0]).toMatch(/\.pdf$/);
  });

  it('never stores a password-reset link in the email log', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'staff@t.test' });
    const row = await queryOne<{ bodyText: string }>(
      pool,
      `SELECT body_text FROM email_log WHERE kind = 'reset' ORDER BY id DESC LIMIT 1`,
    );
    expect(row!.bodyText).not.toMatch(/token=/);
    expect(row!.bodyText).toMatch(/link removed/);
  });
});

void addMonths;
