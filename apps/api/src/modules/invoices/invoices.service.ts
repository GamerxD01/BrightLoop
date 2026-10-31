import {
  LABELS,
  addDays,
  addPeriod,
  formatMoney,
  invoiceActionBlocker,
  priceLines,
  type BillingPeriod,
  type InvoiceAction,
  type InvoiceListQuery,
} from '@brightloop/shared';
import { env } from '../../config/env';
import { pool, queryOne, withTransaction, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { logger } from '../../lib/logger';
import { sendMail } from '../../lib/mailer';
import { paginated } from '../../lib/pagination';
import { nextNumber } from '../../lib/sequence';
import { discountsRepository } from '../discounts/discounts.repository';
import type { SubscriptionLine } from '../subscriptions/subscriptions.repository';
import { invoicesRepository as repo, type InvoiceDetail } from './invoices.repository';

/** What the billing run hands over for one period of one subscription. */
export interface BillableSubscription {
  id: number;
  customerId: number;
  nextInvoiceDate: string;
  expiryDate: string | null;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  dueDays: number;
  lines: SubscriptionLine[];
}

function publish(id: number, customerId: number, status: string) {
  events.publish({ type: 'invoice.changed', data: { id, status }, customerId });
}

export const invoicesService = {
  async list(q: InvoiceListQuery, scope?: Actor) {
    const customerScope = scope?.role === 'customer' ? scope.customerId! : undefined;
    return paginated(await repo.list(pool, { ...q, customerScope }), q);
  },

  /** Customers only ever see their own invoices; anything else is "not found". */
  async get(id: number, scope?: Actor): Promise<InvoiceDetail> {
    const invoice = await repo.findDetail(pool, id);
    if (!invoice || (scope?.role === 'customer' && invoice.customerId !== scope.customerId)) {
      throw new NotFoundError('Invoice');
    }
    return invoice;
  },

  /**
   * Creates the invoice for the subscription's next period inside the caller's
   * transaction. Returns null when that period is already billed, which the
   * unique index guarantees even under concurrent runs.
   */
  async generateForNextPeriod(
    tx: Db,
    sub: BillableSubscription,
  ): Promise<{ id: number; periodEnd: string; nextStart: string } | null> {
    const periodStart = sub.nextInvoiceDate;
    const nextStart = addPeriod(periodStart, sub.billingPeriod, sub.billingInterval);
    let periodEnd = addDays(nextStart, -1);
    if (sub.expiryDate && periodEnd >= sub.expiryDate) periodEnd = addDays(sub.expiryDate, -1);

    const already = await queryOne(
      tx,
      `SELECT 1 FROM invoices WHERE subscription_id = $1 AND period_start = $2 AND status <> 'cancelled'`,
      [sub.id, periodStart],
    );
    if (already) return null;

    // Lock the attached discounts so usage limits hold across parallel runs.
    const attached = await discountsRepository.forSubscription(tx, sub.id);
    if (attached.length)
      await discountsRepository.lockByIds(
        tx,
        attached.map((d) => d.id),
      );
    const rules = attached.length
      ? await discountsRepository.findByIds(
          tx,
          attached.map((d) => d.id),
        )
      : [];

    const priced = priceLines(
      sub.lines.map((l) => ({
        key: String(l.id),
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRateBp: l.taxRateBp,
      })),
      rules,
      periodStart,
    );

    const inserted = await repo.insert(tx, {
      number: await nextNumber(tx, 'INV', new Date(`${periodStart}T00:00:00Z`)),
      subscriptionId: sub.id,
      customerId: sub.customerId,
      periodStart,
      periodEnd,
      invoiceDate: periodStart,
      dueDate: addDays(periodStart, sub.dueDays),
      amountUntaxed: priced.untaxed,
      amountDiscount: priced.discount,
      amountTax: priced.tax,
      amountTotal: priced.total,
    });
    if (!inserted) return null;

    await repo.insertLines(
      tx,
      inserted.id,
      priced.lines.map((l, i) => ({
        productId: l.productId,
        description: sub.lines[i]!.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateBp: l.taxRateBp,
        taxAmount: l.tax,
        subtotal: l.subtotal,
        total: l.total,
      })),
    );
    for (const applied of priced.applied) {
      const ok = await discountsRepository.consumeUse(
        tx,
        applied.discountId,
        inserted.id,
        applied.amount,
      );
      if (!ok)
        throw new RuleError(`Discount "${applied.name}" ran out while billing; please re-run`);
    }
    return { id: inserted.id, periodEnd, nextStart };
  },

  async act(id: number, action: InvoiceAction, actor: Actor) {
    const result = await withTransaction(async (tx) => {
      const invoice = await repo.lockHeader(tx, id);
      if (!invoice) throw new NotFoundError('Invoice');
      const blocker = invoiceActionBlocker(action, invoice.status, invoice.amountPaid);
      if (blocker) throw new RuleError(blocker);

      if (action === 'confirm') await repo.setStatus(tx, id, 'confirmed');
      if (action === 'cancel') {
        await repo.setStatus(tx, id, 'cancelled');
        await discountsRepository.releaseUses(tx, id);
      }
      if (action === 'send') await repo.markSent(tx, id);
      await audit(tx, {
        actorId: actor.userId,
        action: `invoice_${action}`,
        entity: 'invoice',
        entityId: id,
        requestId: actor.requestId,
      });
      return invoice;
    });

    if (action === 'send') await this.email(id);
    const fresh = await this.get(id);
    publish(id, result.customerId, fresh.status);
    return fresh;
  },

  async email(id: number) {
    const inv = await this.get(id);
    const lines = inv.lines
      .map((l) => `  ${l.description} × ${l.quantity}  ${formatMoney(l.total)}`)
      .join('\n');
    try {
      await sendMail({
        to: inv.customerEmail,
        subject: `Invoice ${inv.number} from Brightloop — ${formatMoney(inv.amountDue)} due ${inv.dueDate}`,
        text: `Hello ${inv.customerName},\n\nInvoice ${inv.number} (${LABELS.invoiceStatus[inv.status]}) for ${inv.periodStart} to ${inv.periodEnd}:\n\n${lines}\n\nTotal ${formatMoney(inv.amountTotal)} · Paid ${formatMoney(inv.amountPaid)} · Due ${formatMoney(inv.amountDue)} by ${inv.dueDate}\n\nView it any time: ${env.APP_URL}/portal/invoices/${inv.id}\n`,
      });
    } catch (err) {
      logger.error({ err, invoiceId: id }, 'Invoice email failed');
      throw new RuleError('The invoice was marked sent but the email could not be delivered');
    }
  },

  async confirmMany(ids: number[]) {
    const rows = await repo.confirmDrafts(pool, ids);
    for (const r of rows) publish(r.id, r.customerId, 'confirmed');
    return rows.length;
  },
};
