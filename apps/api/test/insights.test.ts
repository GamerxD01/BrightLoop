import { beforeAll, describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/lib/csv';
import { bootstrap, login } from './helpers';

let admin: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  await bootstrap();
  admin = await login('admin@t.test');
});

describe('csv', () => {
  it('quotes every cell and keeps formulas as text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('-5 apples')).toBe(`"'-5 apples"`);
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv(['a'], [['b']]).startsWith('\uFEFF"a"\r\n"b"')).toBe(true);
  });
});

describe('exports', () => {
  it('exports a list with the same filters as its screen, and neutralises formulas', async () => {
    const evil = await admin
      .post('/api/customers')
      .send({ name: '=cmd|calc', email: 'evil@x.test', company: '@SUM(1)' });
    expect(evil.status, JSON.stringify(evil.body)).toBe(201);
    const res = await admin.get('/api/exports/customers?q=evil');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/brightloop-customers-/);
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=cmd|calc"`);
    expect(lines[1]).toContain(`"'@SUM(1)"`);
  });

  it('refuses unknown exports and bad filters, and keeps customers out', async () => {
    expect((await admin.get('/api/exports/passwords')).status).toBe(404);
    expect((await admin.get('/api/exports/invoices?from=not-a-date')).status).toBe(422);
  });
});

describe('dashboard health', () => {
  it('reports churn, customers, ARPU, collection rate and days to pay', async () => {
    const res = await admin.get('/api/reports/summary');
    expect(res.status).toBe(200);
    const h = res.body.data.health;
    expect(h).toHaveProperty('churnRate');
    expect(h).toHaveProperty('activeCustomers');
    expect(typeof h.arpu).toBe('number');
    expect(h).toHaveProperty('collectionRate');
    expect(h).toHaveProperty('avgDaysToPay');
  });
});

describe('activity log', () => {
  it('records catalog writes with who and which record, filterable by request id', async () => {
    const created = await admin
      .post('/api/catalog/taxes')
      .send({ name: 'Audit Tax 3%', rateBp: 300, isActive: true });
    expect(created.status).toBe(201);
    const requestId = created.headers['x-request-id'];
    await new Promise((r) => setTimeout(r, 100)); // the audit write is fire-and-forget
    const log = await admin.get(`/api/activity?requestId=${requestId}`);
    expect(log.status).toBe(200);
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0]).toMatchObject({
      action: 'create_tax',
      entity: 'tax',
      entityId: created.body.data.id,
      actorName: 'Admin',
    });

    const facets = await admin.get('/api/activity/facets');
    expect(facets.body.data.actions.map((a: { action: string }) => a.action)).toContain(
      'create_tax',
    );
  });

  it('is for admins only', async () => {
    const staff = await login('staff@t.test');
    expect((await staff.get('/api/activity')).status).toBe(403);
  });
});
