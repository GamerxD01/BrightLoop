import { addPeriod, todayIso, type BillingPeriod } from '@brightloop/shared';
import { pool, query, queryOne, withTransaction } from '../../db/pool';
import { audit } from '../../lib/audit';
import { RuleError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { logger } from '../../lib/logger';
import { invoicesService } from '../invoices/invoices.service';
import { subscriptionsRepository } from '../subscriptions/subscriptions.repository';

const BATCH_SIZE = 200;
/** Most periods caught up for one subscription per pass, so one bad record cannot stall a run. */
const MAX_PERIODS_PER_PASS = 36;

interface DueRow {
  id: number;
  customerId: number;
  nextInvoiceDate: string;
  expiryDate: string | null;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  dueDays: number;
}

export interface BillingRunResult {
  asOf: string;
  subscriptionsBilled: number;
  invoicesCreated: number;
  invoicesConfirmed: number;
  autoClosed: number;
  durationMs: number;
}

const DUE_SQL = `
  SELECT s.id, s.customer_id, s.next_invoice_date, s.expiry_date, p.billing_period, p.billing_interval, pt.due_days
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  JOIN payment_terms pt ON pt.id = s.payment_term_id
  WHERE s.status = 'active' AND s.next_invoice_date <= $1
    AND (s.expiry_date IS NULL OR s.next_invoice_date < s.expiry_date)`;

let running: { startedAt: string; asOf: string; processed: number } | null = null;
let lastRun: (BillingRunResult & { finishedAt: string; by: number }) | null = null;

/** Bills every period of `sub` that is due on `asOf`, inside the caller's transaction. */
async function billSubscription(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  sub: DueRow,
  asOf: string,
) {
  const lines = await subscriptionsRepository.findLines(tx, sub.id);
  const created: number[] = [];
  let next = sub.nextInvoiceDate;

  for (let i = 0; i < MAX_PERIODS_PER_PASS; i++) {
    if (next > asOf || (sub.expiryDate && next >= sub.expiryDate)) break;
    const result = await invoicesService.generateForNextPeriod(tx, {
      ...sub,
      nextInvoiceDate: next,
      lines,
    });
    if (result) created.push(result.id);
    // Already-billed periods are stepped over, never billed again and never skipped.
    next = result?.nextStart ?? addPeriod(next, sub.billingPeriod, sub.billingInterval);
  }
  await query(
    tx,
    'UPDATE subscriptions SET next_invoice_date = $2, updated_at = now() WHERE id = $1',
    [sub.id, next],
  );
  return created;
}

export const billingService = {
  status() {
    return { running, lastRun };
  },

  async dueSummary(asOf = todayIso()) {
    return queryOne<{ subscriptions: number; amount: number }>(
      pool,
      `SELECT count(*) AS subscriptions, COALESCE(sum(s.amount_total), 0) AS amount
       FROM subscriptions s WHERE s.status = 'active' AND s.next_invoice_date <= $1
         AND (s.expiry_date IS NULL OR s.next_invoice_date < s.expiry_date)`,
      [asOf],
    );
  },

  /**
   * Billing day. Processes due subscriptions in batches; each batch is one
   * transaction that row-locks its subscriptions with SKIP LOCKED, so a second
   * run (or a second server) works on different rows instead of double billing.
   * Re-running is always safe.
   */
  async run(
    options: { asOf?: string; autoConfirm: boolean },
    actor: Actor,
  ): Promise<BillingRunResult & { invoiceIds: number[] }> {
    if (running) throw new RuleError('A billing run is already in progress');
    const asOf = options.asOf ?? todayIso();
    if (asOf > todayIso()) throw new RuleError('Cannot bill a future date');

    const started = performance.now();
    running = { startedAt: new Date().toISOString(), asOf, processed: 0 };
    const total = Number((await this.dueSummary(asOf))?.subscriptions ?? 0);
    const invoiceIds: number[] = [];
    let billed = 0;

    try {
      for (;;) {
        const batch = await withTransaction(async (tx) => {
          const subs = await query<DueRow>(
            tx,
            `${DUE_SQL} ORDER BY s.next_invoice_date, s.id LIMIT $2 FOR UPDATE OF s SKIP LOCKED`,
            [asOf, BATCH_SIZE],
          );
          const created: number[] = [];
          for (const sub of subs) created.push(...(await billSubscription(tx, sub, asOf)));
          return { count: subs.length, created };
        });
        if (batch.count === 0) break;
        billed += batch.count;
        invoiceIds.push(...batch.created);
        running.processed = billed;
        events.publish({
          type: 'billing.progress',
          data: { processed: billed, total, invoices: invoiceIds.length },
        });
      }

      const autoClosed = await this.autoClose(asOf);
      const invoicesConfirmed =
        options.autoConfirm && invoiceIds.length
          ? await invoicesService.confirmMany(invoiceIds)
          : 0;

      const result: BillingRunResult = {
        asOf,
        subscriptionsBilled: billed,
        invoicesCreated: invoiceIds.length,
        invoicesConfirmed,
        autoClosed,
        durationMs: Math.round(performance.now() - started),
      };
      await audit(pool, {
        actorId: actor.userId,
        action: 'billing_run',
        entity: 'billing',
        data: { ...result },
        requestId: actor.requestId,
      });
      lastRun = { ...result, finishedAt: new Date().toISOString(), by: actor.userId };
      logger.info(result, 'Billing run finished');
      events.publish({
        type: 'billing.progress',
        data: { processed: billed, total, invoices: invoiceIds.length, done: true },
      });
      events.publish({ type: 'invoice.changed', data: { bulk: true } });
      return { ...result, invoiceIds };
    } finally {
      running = null;
    }
  },

  /** "Some plans should close on their own when they end." */
  async autoClose(asOf: string): Promise<number> {
    const closed = await withTransaction(async (tx) => {
      const rows = await query<{ id: number; customerId: number; fromStatus: string }>(
        tx,
        `WITH due AS (
           SELECT s.id, s.status FROM subscriptions s JOIN plans p ON p.id = s.plan_id
           WHERE p.auto_close AND s.status IN ('active', 'paused') AND s.expiry_date <= $1
           FOR UPDATE OF s SKIP LOCKED)
         UPDATE subscriptions s SET status = 'closed', next_invoice_date = NULL, updated_at = now()
         FROM due WHERE s.id = due.id
         RETURNING s.id, s.customer_id, due.status AS from_status`,
        [asOf],
      );
      if (rows.length) {
        await query(
          tx,
          `INSERT INTO subscription_events (subscription_id, from_status, to_status, note)
           SELECT unnest($1::bigint[]), unnest($2::subscription_status[]), 'closed', 'Closed automatically at expiry'`,
          [rows.map((r) => r.id), rows.map((r) => r.fromStatus)],
        );
      }
      return rows;
    });
    for (const r of closed)
      events.publish({
        type: 'subscription.changed',
        data: { id: r.id, status: 'closed' },
        customerId: r.customerId,
      });
    return closed.length;
  },

  /** "Create invoice" on one subscription: bills whatever is due for it today. */
  async billOne(subscriptionId: number, actor: Actor) {
    const today = todayIso();
    const created = await withTransaction(async (tx) => {
      const sub = await queryOne<DueRow>(tx, `${DUE_SQL} AND s.id = $2 FOR UPDATE OF s`, [
        today,
        subscriptionId,
      ]);
      if (!sub) throw new RuleError('Nothing is due on this subscription yet');
      const ids = await billSubscription(tx, sub, today);
      await audit(tx, {
        actorId: actor.userId,
        action: 'bill_subscription',
        entity: 'subscription',
        entityId: subscriptionId,
        data: { invoices: ids },
        requestId: actor.requestId,
      });
      return { ids, customerId: sub.customerId };
    });
    events.publish({
      type: 'invoice.changed',
      data: { subscriptionId },
      customerId: created.customerId,
    });
    return { invoiceIds: created.ids };
  },
};
