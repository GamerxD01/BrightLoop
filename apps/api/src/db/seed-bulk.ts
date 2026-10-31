/**
 * Load test data: thousands of customers and subscriptions with a year of
 * invoices and payments, generated in SQL so it takes seconds. Run after the
 * demo seed; it reuses its plans, products and taxes.
 *
 *   npm run db:seed:bulk                     5,000 customers, 20,000 subscriptions
 *   npm run db:seed:bulk -- --subs 50000     a bigger book
 */
import { pool } from './pool';
import { logger } from '../lib/logger';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i > -1 ? Number(process.argv[i + 1]) : fallback;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function bulk() {
  const customers = arg('customers', 5_000);
  const subs = arg('subs', 20_000);
  const started = performance.now();
  const client = await pool.connect();

  try {
    const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM plans');
    if (!rows[0]?.n)
      throw new Error('Run npm run db:seed first; bulk data reuses its plans and products.');

    await client.query('BEGIN');
    let step = performance.now();
    const lap = (label: string) => {
      logger.info({ ms: Math.round(performance.now() - step) }, label);
      step = performance.now();
    };

    await client.query(
      `INSERT INTO customers (name, email, company, address, created_at)
       SELECT 'Load Customer ' || g, 'load' || g || '@bulk.example.in', 'Load Co ' || (g % 900),
              'City ' || (g % 40) || ', India', now() - (g % 700) * interval '1 day'
       FROM generate_series(1, $1) g
       ON CONFLICT (email) DO NOTHING`,
      [customers],
    );

    // Subscriptions spread over the last 18 months, mostly active, on the existing plans.
    lap('customers');
    await client.query(
      `WITH c AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn, count(*) OVER () AS n
                 FROM customers WHERE email LIKE 'load%@bulk.example.in'),
            p AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn, count(*) OVER () AS n
                 FROM plans WHERE billing_period IN ('monthly', 'yearly')),
            t AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn, count(*) OVER () AS n FROM payment_terms),
            cn AS (SELECT max(n) AS n FROM c), pn AS (SELECT max(n) AS n FROM p), tn AS (SELECT max(n) AS n FROM t),
            src AS (
              SELECT g, c.id AS customer_id, p.id AS plan_id, t.id AS term_id,
                     (CURRENT_DATE - (g % 540))::date AS start_date,
                     CASE WHEN g % 20 = 0 THEN 'closed' WHEN g % 33 = 0 THEN 'paused' WHEN g % 41 = 0 THEN 'quotation'
                          WHEN g % 53 = 0 THEN 'draft' ELSE 'active' END::subscription_status AS status
              FROM generate_series(1, $1) g CROSS JOIN cn CROSS JOIN pn CROSS JOIN tn
              JOIN c ON c.rn = g % cn.n
              JOIN p ON p.rn = g % pn.n
              JOIN t ON t.rn = g % tn.n)
       INSERT INTO subscriptions (number, customer_id, plan_id, payment_term_id, status, start_date, next_invoice_date,
                                  amount_untaxed, amount_tax, amount_total, created_at)
       SELECT 'SUB/BULK/' || lpad(g::text, 6, '0'), customer_id, plan_id, term_id, status, start_date,
              CASE WHEN status = 'active' THEN (date_trunc('month', CURRENT_DATE) + interval '1 month')::date END,
              0, 0, 0, start_date::timestamptz
       FROM src`,
      [subs],
    );

    // One plan line each, priced from the plan, then the cached totals.
    lap('subscriptions');
    await client.query(
      `INSERT INTO subscription_lines (subscription_id, kind, description, quantity, unit_price, tax_id, tax_rate_bp)
       SELECT s.id, 'plan', p.name, p.min_quantity + (s.id % 7), p.price, p.tax_id, COALESCE(t.rate_bp, 0)
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN taxes t ON t.id = p.tax_id
       WHERE s.number LIKE 'SUB/BULK/%'`,
    );
    lap('lines');
    await client.query(
      `UPDATE subscriptions s SET amount_untaxed = l.untaxed, amount_tax = l.tax, amount_total = l.untaxed + l.tax
       FROM (SELECT subscription_id, sum(quantity * unit_price) AS untaxed,
                    sum(round(quantity * unit_price * tax_rate_bp / 10000.0)) AS tax
             FROM subscription_lines GROUP BY subscription_id) l
       WHERE l.subscription_id = s.id AND s.number LIKE 'SUB/BULK/%'`,
    );

    // Monthly invoices for active and closed subscriptions; older ones paid, recent ones open.
    lap('totals');
    await client.query(
      `INSERT INTO invoices (number, subscription_id, customer_id, status, period_start, period_end, invoice_date, due_date,
                             amount_untaxed, amount_tax, amount_total, amount_paid, confirmed_at, paid_at)
       SELECT 'INV/BULK/' || s.id || '/' || to_char(m, 'YYMM'), s.id, s.customer_id,
              CASE WHEN m < date_trunc('month', CURRENT_DATE) - interval '2 months' OR s.id % 4 <> 0 THEN 'paid' ELSE 'confirmed' END::invoice_status,
              m::date, (m + interval '1 month' - interval '1 day')::date, m::date, (m + interval '15 days')::date,
              s.amount_untaxed, s.amount_tax, s.amount_total,
              CASE WHEN m < date_trunc('month', CURRENT_DATE) - interval '2 months' OR s.id % 4 <> 0 THEN s.amount_total ELSE 0 END,
              m, CASE WHEN m < date_trunc('month', CURRENT_DATE) - interval '2 months' OR s.id % 4 <> 0 THEN m + interval '10 days' END
       FROM subscriptions s
       CROSS JOIN LATERAL generate_series(date_trunc('month', s.start_date), date_trunc('month', CURRENT_DATE), interval '1 month') m
       JOIN plans p ON p.id = s.plan_id AND p.billing_period = 'monthly'
       WHERE s.number LIKE 'SUB/BULK/%' AND s.status IN ('active', 'closed')`,
    );
    lap('invoices');
    await client.query(
      `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, tax_rate_bp, tax_amount, subtotal, total)
       SELECT i.id, l.description, l.quantity, l.unit_price, l.tax_rate_bp, i.amount_tax, i.amount_untaxed, i.amount_total
       FROM invoices i JOIN subscription_lines l ON l.subscription_id = i.subscription_id
       WHERE i.number LIKE 'INV/BULK/%'`,
    );
    lap('invoice lines');
    await client.query(
      `INSERT INTO payments (invoice_id, amount, method, paid_on, note)
       SELECT id, amount_total, (ARRAY['upi','bank_transfer','card','cash','cheque']::payment_method[])[1 + id % 5],
              (invoice_date + 10)::date, NULL
       FROM invoices WHERE number LIKE 'INV/BULK/%' AND status = 'paid'`,
    );

    lap('payments');
    await client.query('COMMIT');
    await client.query('ANALYZE');
    const counts = await client.query(
      `SELECT (SELECT count(*) FROM customers) AS customers, (SELECT count(*) FROM subscriptions) AS subscriptions,
              (SELECT count(*) FROM invoices) AS invoices, (SELECT count(*) FROM payments) AS payments`,
    );
    logger.info(
      { ...counts.rows[0], seconds: Math.round((performance.now() - started) / 100) / 10 },
      'Bulk data loaded',
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

bulk()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, 'Bulk seed failed');
    process.exit(1);
  });
