import type { ListQuery, PaymentInput, PaymentMethod } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface PaymentRow {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  recordedBy: string | null;
  createdAt: string;
  totalCount: number;
}

export const paymentsRepository = {
  list(db: Db, q: ListQuery & { method?: PaymentMethod; from?: string; to?: string }) {
    const f = new SqlFilter()
      .add('pm.method = ?', q.method)
      .add('pm.paid_on >= ?', q.from)
      .add('pm.paid_on <= ?', q.to);
    if (q.q) f.add(`(i.number ILIKE ? OR c.name ILIKE $${f.params.length + 1})`, `%${q.q}%`);
    const order = orderBy(
      q.sort,
      q.dir,
      { paidOn: 'pm.paid_on', amount: 'pm.amount' },
      'pm.paid_on',
    );
    const limit = f.page(q);
    return query<PaymentRow>(
      db,
      `SELECT pm.id, pm.invoice_id, i.number AS invoice_number, i.customer_id, c.name AS customer_name, pm.amount,
              pm.method, pm.paid_on, pm.note, u.full_name AS recorded_by, pm.created_at, count(*) OVER () AS total_count
       FROM payments pm
       JOIN invoices i ON i.id = pm.invoice_id
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN users u ON u.id = pm.recorded_by
       ${f.where} ${order}, pm.id DESC ${limit}`,
      f.params,
    );
  },

  insert: async (db: Db, p: PaymentInput, recordedBy: number) =>
    (await queryOne<{ id: number }>(
      db,
      `INSERT INTO payments (invoice_id, amount, method, paid_on, note, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.invoiceId, p.amount, p.method, p.paidOn, p.note, recordedBy],
    ))!,
};
