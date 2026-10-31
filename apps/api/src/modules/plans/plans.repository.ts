import type { BillingPeriod, ListQuery, PlanInput } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface Plan {
  id: number;
  name: string;
  price: number;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  startDate: string;
  endDate: string | null;
  taxId: number | null;
  taxName: string | null;
  taxRateBp: number | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isActive: boolean;
  activeSubscriptions: number;
}

const SELECT = `
  SELECT p.*, t.name AS tax_name, t.rate_bp AS tax_rate_bp,
         (SELECT count(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_subscriptions
  FROM plans p LEFT JOIN taxes t ON t.id = p.tax_id`;

const values = (p: PlanInput) => [
  p.name,
  p.price,
  p.billingPeriod,
  p.billingInterval,
  p.minQuantity,
  p.startDate,
  p.endDate,
  p.taxId,
  p.autoClose,
  p.closable,
  p.pausable,
  p.renewable,
  p.isActive,
];

export const plansRepository = {
  list(db: Db, q: ListQuery) {
    const f = new SqlFilter();
    if (q.q) f.add('p.name ILIKE ?', `%${q.q}%`);
    const order = orderBy(q.sort, q.dir, { name: 'p.name', price: 'p.price' }, 'p.name');
    const limit = f.page(q);
    return query<Plan & { totalCount: number }>(
      db,
      `${SELECT.replace('SELECT p.*', 'SELECT p.*, count(*) OVER () AS total_count')} ${f.where} ${order} ${limit}`,
      f.params,
    );
  },

  findById: (db: Db, id: number) => queryOne<Plan>(db, `${SELECT} WHERE p.id = $1`, [id]),

  insert: async (db: Db, p: PlanInput) =>
    (await queryOne<{ id: number }>(
      db,
      `INSERT INTO plans (name, price, billing_period, billing_interval, min_quantity, start_date, end_date,
                          tax_id, auto_close, closable, pausable, renewable, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      values(p),
    ))!,

  update: (db: Db, id: number, p: PlanInput) =>
    queryOne<{ id: number }>(
      db,
      `UPDATE plans SET name=$2, price=$3, billing_period=$4, billing_interval=$5, min_quantity=$6, start_date=$7,
              end_date=$8, tax_id=$9, auto_close=$10, closable=$11, pausable=$12, renewable=$13, is_active=$14,
              updated_at=now()
       WHERE id=$1 RETURNING id`,
      [id, ...values(p)],
    ),
};
