import { todayIso } from '@brightloop/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool, queryOne } from '../src/db/pool';
import { bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;
let planId: number;
let termId: number;
let customerId: number;

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
  const tax = (await queryOne<{ id: number }>(pool, 'SELECT id FROM taxes LIMIT 1'))!;
  termId = (await queryOne<{ id: number }>(pool, 'SELECT id FROM payment_terms LIMIT 1'))!.id;
  const plan = await admin.post('/api/plans').send({
    name: 'Polish Monthly',
    price: 100_00,
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
  planId = plan.body.data.id;
  customerId = (
    await admin.post('/api/customers').send({ name: 'Polish Co', email: 'polish@x.test' })
  ).body.data.id;
});

describe('editing reference data', () => {
  it('renames a tax, changes its rate and archives it', async () => {
    const tax = await admin
      .post('/api/catalog/taxes')
      .send({ name: 'Edit Me 5%', rateBp: 500, isActive: true });
    const edited = await admin
      .put(`/api/catalog/taxes/${tax.body.data.id}`)
      .send({ name: 'Edited 12%', rateBp: 1200, isActive: false });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data).toMatchObject({ name: 'Edited 12%', rateBp: 1200, isActive: false });
  });

  it('renames attribute values and changes their extra price, keeping their ids', async () => {
    const created = await admin
      .post('/api/catalog/attributes')
      .send({ name: 'Tier', values: [{ name: 'Gold', extraPrice: 100_00 }] });
    const attr = created.body.data.find((a: { name: string }) => a.name === 'Tier');
    const gold = attr.values[0];
    const edited = await admin.put(`/api/catalog/attributes/${attr.id}`).send({
      name: 'Support tier',
      values: [
        { id: gold.id, name: 'Gold plus', extraPrice: 150_00 },
        { name: 'Silver', extraPrice: 0 },
      ],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const after = edited.body.data.find((a: { id: number }) => a.id === attr.id);
    expect(after.name).toBe('Support tier');
    expect(after.values.find((v: { id: number }) => v.id === gold.id)).toMatchObject({
      name: 'Gold plus',
      extraPrice: 150_00,
    });
    expect(after.values).toHaveLength(2);
  });
});

describe('deleting', () => {
  it('deletes a template; quotations made from it keep their lines', async () => {
    const tpl = await admin
      .post('/api/templates')
      .send({ name: 'Delete Me', planId, validityDays: 7, paymentTermId: termId, lines: [] });
    const quote = await admin
      .post('/api/subscriptions/from-template')
      .send({ templateId: tpl.body.data.id, customerId, startDate: todayIso() });
    expect(quote.status).toBe(201);
    const del = await admin.delete(`/api/templates/${tpl.body.data.id}`);
    expect(del.status).toBe(204);
    expect((await admin.get(`/api/templates/${tpl.body.data.id}`)).status).toBe(404);
    const kept = await admin.get(`/api/subscriptions/${quote.body.data.id}`);
    expect(kept.body.data.lines.length).toBeGreaterThan(0);
    expect(kept.body.data.templateId).toBeNull();
  });

  it('deletes a draft that was never sent, and refuses anything further along', async () => {
    const make = () =>
      admin
        .post('/api/subscriptions')
        .send({
          customerId,
          planId,
          planQuantity: 1,
          startDate: todayIso(),
          paymentTermId: termId,
        });
    const fresh = await make();
    expect((await admin.delete(`/api/subscriptions/${fresh.body.data.id}`)).status).toBe(204);
    expect((await admin.get(`/api/subscriptions/${fresh.body.data.id}`)).status).toBe(404);

    // Sent and pulled back to draft: the customer has seen it, so it can only be closed.
    const sent = await make();
    await admin
      .post(`/api/subscriptions/${sent.body.data.id}/actions`)
      .send({ action: 'send_quotation' });
    await admin
      .post(`/api/subscriptions/${sent.body.data.id}/actions`)
      .send({ action: 'back_to_draft' });
    const refused = await admin.delete(`/api/subscriptions/${sent.body.data.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.message).toMatch(/close it instead/);

    const staff = await login('staff@t.test');
    const other = await make();
    expect((await staff.delete(`/api/subscriptions/${other.body.data.id}`)).status).toBe(204);
  });
});
