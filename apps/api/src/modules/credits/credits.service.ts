import { formatMoney, todayIso } from '@brightloop/shared';
import { pool, queryOne, type Db } from '../../db/pool';
import { events } from '../../lib/events';
import { creditsRepository as repo } from './credits.repository';

export const creditsService = {
  async summary(customerId: number) {
    const [balance, history] = await Promise.all([
      repo.balance(pool, customerId),
      repo.history(pool, customerId),
    ]);
    return { balance, history };
  },

  /** Adds credit inside the caller's transaction (a downgrade, a goodwill gesture). */
  async grant(
    tx: Db,
    e: {
      customerId: number;
      amount: number;
      reason: string;
      subscriptionId?: number;
      createdBy: number | null;
    },
  ) {
    if (e.amount <= 0) return null;
    await repo.lockCustomer(tx, e.customerId);
    return repo.add(tx, e);
  },

  /**
   * Spends available credit on a confirmed invoice, inside the caller's
   * transaction: a payment with method "credit" plus a matching negative
   * ledger row. The invoice's taxes are untouched; credit settles it like money.
   * Returns the amount applied.
   */
  async applyToInvoice(tx: Db, invoiceId: number, actorId: number | null): Promise<number> {
    const inv = await queryOne<{
      id: number;
      number: string;
      customerId: number;
      status: string;
      due: number;
    }>(
      tx,
      `SELECT id, number, customer_id, status, amount_total - amount_paid AS due FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId],
    );
    if (!inv || inv.status !== 'confirmed' || inv.due <= 0) return 0;

    await repo.lockCustomer(tx, inv.customerId);
    const balance = await repo.balance(tx, inv.customerId);
    const amount = Math.min(balance, inv.due);
    if (amount <= 0) return 0;

    const payment = await queryOne<{ id: number }>(
      tx,
      `INSERT INTO payments (invoice_id, amount, method, paid_on, note, recorded_by)
       VALUES ($1, $2, 'credit', $3, $4, $5) RETURNING id`,
      [inv.id, amount, todayIso(), `Account credit applied (${formatMoney(amount)})`, actorId],
    );
    await queryOne(
      tx,
      `UPDATE invoices SET amount_paid = amount_paid + $2,
              status = CASE WHEN amount_paid + $2 = amount_total THEN 'paid'::invoice_status ELSE status END,
              paid_at = CASE WHEN amount_paid + $2 = amount_total THEN now() ELSE paid_at END,
              updated_at = now()
       WHERE id = $1 RETURNING id`,
      [inv.id, amount],
    );
    await repo.add(tx, {
      customerId: inv.customerId,
      amount: -amount,
      reason: `Applied to ${inv.number}`,
      invoiceId: inv.id,
      paymentId: payment!.id,
      createdBy: actorId,
    });
    events.publish({
      type: 'payment.recorded',
      data: { invoiceId: inv.id, amount, method: 'credit' },
      customerId: inv.customerId,
    });
    return amount;
  },
};
