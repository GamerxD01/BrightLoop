import { query, queryOne, type Db } from '../../db/pool';

export interface CreditEntry {
  id: number;
  amount: number;
  reason: string;
  subscriptionId: number | null;
  subscriptionNumber: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const creditsRepository = {
  /** Serialises every credit movement for one customer. */
  lockCustomer: (db: Db, customerId: number) =>
    query(db, 'SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]),

  balance: async (db: Db, customerId: number) =>
    (await queryOne<{ balance: number }>(
      db,
      'SELECT COALESCE(sum(amount), 0) AS balance FROM customer_credits WHERE customer_id = $1',
      [customerId],
    ))!.balance,

  add: (
    db: Db,
    e: {
      customerId: number;
      amount: number;
      reason: string;
      subscriptionId?: number | null;
      invoiceId?: number | null;
      paymentId?: number | null;
      createdBy: number | null;
    },
  ) =>
    queryOne<{ id: number }>(
      db,
      `INSERT INTO customer_credits (customer_id, amount, reason, subscription_id, invoice_id, payment_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        e.customerId,
        e.amount,
        e.reason,
        e.subscriptionId ?? null,
        e.invoiceId ?? null,
        e.paymentId ?? null,
        e.createdBy,
      ],
    ),

  history: (db: Db, customerId: number) =>
    query<CreditEntry>(
      db,
      `SELECT cc.id, cc.amount, cc.reason, cc.subscription_id, s.number AS subscription_number, cc.invoice_id,
              i.number AS invoice_number, u.full_name AS created_by, cc.created_at
       FROM customer_credits cc
       LEFT JOIN subscriptions s ON s.id = cc.subscription_id
       LEFT JOIN invoices i ON i.id = cc.invoice_id
       LEFT JOIN users u ON u.id = cc.created_by
       WHERE cc.customer_id = $1 ORDER BY cc.created_at DESC, cc.id DESC LIMIT 50`,
      [customerId],
    ),
};
