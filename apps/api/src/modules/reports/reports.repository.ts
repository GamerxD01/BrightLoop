import { query, queryOne, type Db } from '../../db/pool';

/**
 * Every figure is one aggregate query over indexed columns, so the dashboard
 * stays fast with tens of thousands of subscriptions.
 * $1 = from, $2 = to, $3 = plan id or NULL.
 */
const MONTHLY = `CASE p.billing_period WHEN 'daily' THEN 30.0 WHEN 'weekly' THEN 52.0 / 12 WHEN 'monthly' THEN 1.0 ELSE 1.0 / 12 END
                 / p.billing_interval`;

export const reportsRepository = {
  headline: (db: Db, from: string, to: string, planId: number | null) =>
    queryOne<{
      activeSubscriptions: number;
      mrr: number;
      newSubscriptions: number;
      invoiced: number;
      collected: number;
      outstanding: number;
      overdueCount: number;
      overdueAmount: number;
    }>(
      db,
      `SELECT
         (SELECT count(*) FROM subscriptions s WHERE s.status = 'active' AND ($3::bigint IS NULL OR s.plan_id = $3)) AS active_subscriptions,
         (SELECT COALESCE(round(sum(s.amount_untaxed * ${MONTHLY})), 0) FROM subscriptions s JOIN plans p ON p.id = s.plan_id
           WHERE s.status = 'active' AND ($3::bigint IS NULL OR s.plan_id = $3)) AS mrr,
         (SELECT count(*) FROM subscriptions s WHERE s.created_at::date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR s.plan_id = $3)) AS new_subscriptions,
         (SELECT COALESCE(sum(i.amount_total), 0) FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
           WHERE i.status IN ('confirmed', 'paid') AND i.invoice_date BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR s.plan_id = $3)) AS invoiced,
         (SELECT COALESCE(sum(pm.amount), 0) FROM payments pm JOIN invoices i ON i.id = pm.invoice_id
           LEFT JOIN subscriptions s ON s.id = i.subscription_id
           WHERE pm.paid_on BETWEEN $1 AND $2 AND ($3::bigint IS NULL OR s.plan_id = $3)) AS collected,
         (SELECT COALESCE(sum(i.amount_total - i.amount_paid), 0) FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
           WHERE i.status = 'confirmed' AND ($3::bigint IS NULL OR s.plan_id = $3)) AS outstanding,
         (SELECT count(*) FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
           WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND ($3::bigint IS NULL OR s.plan_id = $3)) AS overdue_count,
         (SELECT COALESCE(sum(i.amount_total - i.amount_paid), 0) FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
           WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND ($3::bigint IS NULL OR s.plan_id = $3)) AS overdue_amount`,
      [from, to, planId],
    ),

  /** One grouped scan per table over the date range (index on invoice_date / paid_on), joined to the month series. */
  monthly: (db: Db, from: string, to: string, planId: number | null) =>
    query<{ month: string; invoiced: number; collected: number }>(
      db,
      `WITH months AS (
         SELECT generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month')::date AS month),
       inv AS (
         SELECT date_trunc('month', i.invoice_date)::date AS month, sum(i.amount_total) AS total
         FROM invoices i LEFT JOIN subscriptions s ON s.id = i.subscription_id
         WHERE i.status IN ('confirmed', 'paid') AND i.invoice_date >= date_trunc('month', $1::date) AND i.invoice_date <= $2
           AND ($3::bigint IS NULL OR s.plan_id = $3)
         GROUP BY 1),
       pay AS (
         SELECT date_trunc('month', pm.paid_on)::date AS month, sum(pm.amount) AS total
         FROM payments pm JOIN invoices i ON i.id = pm.invoice_id LEFT JOIN subscriptions s ON s.id = i.subscription_id
         WHERE pm.paid_on >= date_trunc('month', $1::date) AND pm.paid_on <= $2 AND ($3::bigint IS NULL OR s.plan_id = $3)
         GROUP BY 1)
       SELECT to_char(m.month, 'YYYY-MM') AS month, COALESCE(inv.total, 0) AS invoiced, COALESCE(pay.total, 0) AS collected
       FROM months m LEFT JOIN inv ON inv.month = m.month LEFT JOIN pay ON pay.month = m.month
       ORDER BY m.month`,
      [from, to, planId],
    ),

  byStatus: (db: Db, planId: number | null) =>
    query<{ status: string; count: number }>(
      db,
      `SELECT status, count(*) AS count FROM subscriptions WHERE ($1::bigint IS NULL OR plan_id = $1) GROUP BY status`,
      [planId],
    ),

  byPlan: (db: Db) =>
    query<{ planId: number; planName: string; active: number; mrr: number }>(
      db,
      `SELECT p.id AS plan_id, p.name AS plan_name, count(s.id) AS active,
              COALESCE(round(sum(s.amount_untaxed * ${MONTHLY})), 0) AS mrr
       FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
       GROUP BY p.id ORDER BY mrr DESC, p.name LIMIT 8`,
    ),

  topOverdue: (db: Db, planId: number | null) =>
    query<{
      id: number;
      number: string;
      customerName: string;
      dueDate: string;
      amountDue: number;
      daysOverdue: number;
    }>(
      db,
      `SELECT i.id, i.number, c.name AS customer_name, i.due_date, i.amount_total - i.amount_paid AS amount_due,
              CURRENT_DATE - i.due_date AS days_overdue
       FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN subscriptions s ON s.id = i.subscription_id
       WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND ($1::bigint IS NULL OR s.plan_id = $1)
       ORDER BY i.due_date, i.id LIMIT 8`,
      [planId],
    ),
};
