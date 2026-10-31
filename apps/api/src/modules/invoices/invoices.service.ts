import {
  addDays,
  addPeriod,
  invoiceActionBlocker,
  priceLines,
  gstMode,
  splitGst,
  type DiscountRule,
  type BillingPeriod,
  type InvoiceAction,
  type InvoiceListQuery,
} from '@brightloop/shared';
import { pool, queryOne, withTransaction, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { paginated } from '../../lib/pagination';
import { nextNumber } from '../../lib/sequence';
import { companyService } from '../company/company.service';
import { notifications } from '../notifications/notifications.service';
import { renderInvoicePdf } from './invoice-pdf';
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

    const created = await this.createInvoice(tx, {
      subscriptionId: sub.id,
      customerId: sub.customerId,
      periodStart,
      periodEnd,
      invoiceDate: periodStart,
      dueDays: sub.dueDays,
      lines: sub.lines,
      rules,
    });
    return created ? { id: created.id, periodEnd, nextStart } : null;
  },

  /**
   * The one place an invoice is written: number, prices, discounts, the GST
   * split for the customer's state, and the seller's details as of today.
   * Discount uses are taken inside the same transaction.
   */
  async createInvoice(
    tx: Db,
    input: {
      subscriptionId: number | null;
      customerId: number;
      periodStart: string;
      periodEnd: string;
      invoiceDate: string;
      dueDays: number;
      lines: Pick<
        SubscriptionLine,
        'productId' | 'description' | 'quantity' | 'unitPrice' | 'taxRateBp' | 'hsnSac'
      >[];
      rules: DiscountRule[];
    },
  ): Promise<{ id: number; total: number } | null> {
    const priced = priceLines(
      input.lines.map((l, i) => ({
        key: String(i),
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRateBp: l.taxRateBp,
      })),
      input.rules,
      input.periodStart,
    );

    const seller = await companyService.snapshot(tx);
    const buyer = await queryOne<{ gstin: string | null; stateCode: string | null }>(
      tx,
      'SELECT gstin, state_code FROM customers WHERE id = $1',
      [input.customerId],
    );
    const placeOfSupply = buyer?.stateCode ?? seller.stateCode;
    const mode = gstMode(seller.stateCode, placeOfSupply);
    const lineTax = priced.lines.map((l) => splitGst(l.tax, mode));
    const sum = (k: 'cgst' | 'sgst' | 'igst') => lineTax.reduce((a, t) => a + t[k], 0);

    const inserted = await repo.insert(tx, {
      number: await nextNumber(tx, 'INV', new Date(`${input.invoiceDate}T00:00:00Z`)),
      subscriptionId: input.subscriptionId,
      customerId: input.customerId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      invoiceDate: input.invoiceDate,
      dueDate: addDays(input.invoiceDate, input.dueDays),
      amountUntaxed: priced.untaxed,
      amountDiscount: priced.discount,
      amountTax: priced.tax,
      amountTotal: priced.total,
      gstMode: mode,
      placeOfSupply,
      customerGstin: buyer?.gstin ?? null,
      amountCgst: sum('cgst'),
      amountSgst: sum('sgst'),
      amountIgst: sum('igst'),
      seller,
    });
    if (!inserted) return null;

    await repo.insertLines(
      tx,
      inserted.id,
      priced.lines.map((l, i) => ({
        productId: l.productId,
        description: input.lines[i]!.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateBp: l.taxRateBp,
        taxAmount: l.tax,
        subtotal: l.subtotal,
        total: l.total,
        hsnSac: input.lines[i]!.hsnSac ?? null,
        ...lineTax[i]!,
      })),
    );
    for (const applied of priced.applied) {
      if (applied.discountId < 0) continue; // a customer credit, not a discount rule
      const ok = await discountsRepository.consumeUse(
        tx,
        applied.discountId,
        inserted.id,
        applied.amount,
      );
      if (!ok)
        throw new RuleError(`Discount "${applied.name}" ran out while billing; please re-run`);
    }
    return { id: inserted.id, total: priced.total };
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
    const result = await notifications.invoice(await this.get(id));
    if (result.status === 'failed') {
      throw new RuleError('The invoice was marked sent but the email could not be delivered');
    }
  },

  async pdf(id: number, scope?: Actor) {
    const inv = await this.get(id, scope);
    if (scope?.role === 'customer' && inv.status === 'draft') throw new NotFoundError('Invoice');
    return {
      filename: `${inv.number.replace(/\//g, '-')}.pdf`,
      content: await renderInvoicePdf(inv),
    };
  },

  async confirmMany(ids: number[]) {
    const rows = await repo.confirmDrafts(pool, ids);
    for (const r of rows) publish(r.id, r.customerId, 'confirmed');
    return rows.length;
  },
};
