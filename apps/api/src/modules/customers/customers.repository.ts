import type { CustomerInput, ListQuery } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  address: string | null;
  createdAt: string;
}

export interface CustomerListRow extends Customer {
  activeSubscriptions: number;
  outstanding: number;
  hasPortalAccess: boolean;
  totalCount: number;
}

export const customersRepository = {
  list(db: Db, q: ListQuery) {
    const f = new SqlFilter();
    if (q.q)
      f.add(
        `(c.name ILIKE ? OR c.email ILIKE $${f.params.length + 1} OR c.company ILIKE $${f.params.length + 1})`,
        `%${q.q}%`,
      );
    const order = orderBy(
      q.sort,
      q.dir,
      { name: 'c.name', createdAt: 'c.created_at', outstanding: 'outstanding' },
      'c.created_at',
    );
    const limit = f.page(q);
    return query<CustomerListRow>(
      db,
      `SELECT c.*,
              (SELECT count(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS active_subscriptions,
              COALESCE((SELECT sum(i.amount_total - i.amount_paid) FROM invoices i
                        WHERE i.customer_id = c.id AND i.status = 'confirmed'), 0) AS outstanding,
              EXISTS (SELECT 1 FROM users u WHERE u.customer_id = c.id) AS has_portal_access,
              count(*) OVER () AS total_count
       FROM customers c ${f.where} ${order} ${limit}`,
      f.params,
    );
  },

  findById(db: Db, id: number) {
    return queryOne<Customer>(db, 'SELECT * FROM customers WHERE id = $1', [id]);
  },

  findByEmail(db: Db, email: string) {
    return queryOne<Customer>(db, 'SELECT * FROM customers WHERE email = $1', [email]);
  },

  async insert(db: Db, c: CustomerInput) {
    return (await queryOne<Customer>(
      db,
      `INSERT INTO customers (name, email, phone, company, address) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [c.name, c.email, c.phone, c.company, c.address],
    ))!;
  },

  update(db: Db, id: number, c: CustomerInput) {
    return queryOne<Customer>(
      db,
      `UPDATE customers SET name=$2, email=$3, phone=$4, company=$5, address=$6, updated_at=now()
       WHERE id = $1 RETURNING *`,
      [id, c.name, c.email, c.phone, c.company, c.address],
    );
  },
};
