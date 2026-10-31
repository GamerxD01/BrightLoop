import {
  formatMoney,
  priceLines,
  prorate,
  todayIso,
  type ProrationLine,
  type ProrationResult,
  type SubscriptionChangeInput,
} from '@brightloop/shared';
import { pool, query, queryOne, withTransaction, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError, ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { logger } from '../../lib/logger';
import { catalogRepository } from '../catalog/catalog.repository';
import { creditsService } from '../credits/credits.service';
import { invoicesRepository } from '../invoices/invoices.repository';
import { invoicesService } from '../invoices/invoices.service';
import { notifications } from '../notifications/notifications.service';
import {
  subscriptionsRepository,
  type NewLine,
  type SubscriptionDetail,
} from '../subscriptions/subscriptions.repository';
import { subscriptionsService } from '../subscriptions/subscriptions.service';

const lineKey = (l: { kind: string; productId: number | null; variantId: number | null }) =>
  l.kind === 'plan' ? 'plan' : `p:${l.productId}:${l.variantId ?? 0}`;

export interface ChangePlan {
  subscription: SubscriptionDetail;
  lines: NewLine[];
  /** The billed period the change falls in, if the subscription has one running. */
  period: { start: string; end: string } | null;
  proration: ProrationResult;
  perPeriod: { before: number; after: number };
}

/**
 * Seats and add-ons on an active subscription, changed today.
 * Additions are charged for the days left in the current billed period on an
 * adjustment invoice; removals become account credit spent on the next invoice.
 * The new lines bill in full from the next period.
 */
export const changesService = {
  async plan(
    subscriptionId: number,
    input: SubscriptionChangeInput,
    actor: Actor,
    db: Db = pool,
  ): Promise<ChangePlan> {
    const sub = await subscriptionsService.get(subscriptionId, db);
    if (actor.role === 'customer' && sub.customerId !== actor.customerId)
      throw new NotFoundError('Subscription');
    if (sub.status !== 'active')
      throw new RuleError('Only an active subscription can be changed this way');
    if (input.planQuantity < sub.minQuantity) {
      throw new ValidationError({ planQuantity: `This plan needs at least ${sub.minQuantity}` });
    }

    const current = new Map(sub.lines.map((l) => [lineKey(l), l]));
    const planLine = sub.lines.find((l) => l.kind === 'plan');
    if (!planLine) throw new RuleError('This subscription has no plan line');

    // Existing lines keep the price the customer agreed; new add-ons come at today's catalog price.
    const products = new Map(
      (
        await catalogRepository.findProductsByIds(db, [
          ...new Set(input.lines.map((l) => l.productId)),
        ])
      ).map((p) => [p.id, p]),
    );
    const fieldErrors: Record<string, string> = {};
    const seen = new Set<string>();
    const lines: NewLine[] = [{ ...planLine, quantity: input.planQuantity }];

    input.lines.forEach((l, i) => {
      const key = lineKey({ kind: 'product', productId: l.productId, variantId: l.variantId });
      if (seen.has(key)) {
        fieldErrors[`lines.${i}.productId`] = 'Listed twice';
        return;
      }
      seen.add(key);
      const kept = current.get(key);
      if (kept) {
        lines.push({ ...kept, quantity: l.quantity });
        return;
      }
      const product = products.get(l.productId);
      if (!product || !product.isActive) {
        fieldErrors[`lines.${i}.productId`] = 'This add-on is not available';
        return;
      }
      const variant = l.variantId ? product.variants.find((v) => v.id === l.variantId) : null;
      if (l.variantId && !variant) {
        fieldErrors[`lines.${i}.variantId`] = 'Variant does not belong to this product';
        return;
      }
      lines.push({
        kind: 'product',
        productId: product.id,
        variantId: variant?.id ?? null,
        description: variant
          ? `${product.name} (${variant.attributeName}: ${variant.valueName})`
          : product.name,
        quantity: l.quantity,
        unitPrice: product.salesPrice + (variant?.extraPrice ?? 0),
        taxId: product.taxId,
        taxRateBp: product.taxRateBp ?? 0,
        hsnSac: product.hsnSac,
      });
    });
    if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);

    const today = todayIso();
    const period = await queryOne<{ start: string; end: string }>(
      db,
      `SELECT period_start AS start, period_end AS "end" FROM invoices
       WHERE subscription_id = $1 AND kind = 'recurring' AND status <> 'cancelled'
         AND period_start <= $2 AND period_end >= $2
       ORDER BY period_start DESC LIMIT 1`,
      [sub.id, today],
    );

    const toProration = (ls: NewLine[]): ProrationLine[] =>
      ls.map((l) => ({
        key: lineKey(l),
        description: l.kind === 'plan' ? `${sub.planName} seats` : l.description,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRateBp: l.taxRateBp,
        hsnSac: l.hsnSac,
      }));

    const proration = period
      ? prorate({
          periodStart: period.start,
          periodEnd: period.end,
          changeDate: today,
          before: toProration(sub.lines),
          after: toProration(lines),
        })
      : { daysLeft: 0, daysInPeriod: 0, charges: [], credits: [], chargeTotal: 0, creditTotal: 0 };

    const total = (ls: NewLine[]) =>
      priceLines(
        ls.map((l, i) => ({
          key: String(i),
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRateBp: l.taxRateBp,
        })),
      ).total;

    return {
      subscription: sub,
      lines,
      period,
      proration,
      perPeriod: { before: sub.amountTotal, after: total(lines) },
    };
  },

  async preview(subscriptionId: number, input: SubscriptionChangeInput, actor: Actor) {
    const p = await this.plan(subscriptionId, input, actor);
    return {
      period: p.period,
      daysLeft: p.proration.daysLeft,
      daysInPeriod: p.proration.daysInPeriod,
      charges: p.proration.charges,
      credits: p.proration.credits,
      chargeTotal: p.proration.chargeTotal,
      creditTotal: p.proration.creditTotal,
      perPeriod: p.perPeriod,
      changed:
        p.proration.charges.length + p.proration.credits.length > 0 ||
        p.perPeriod.before !== p.perPeriod.after,
    };
  },

  async apply(subscriptionId: number, input: SubscriptionChangeInput, actor: Actor) {
    const result = await withTransaction(async (tx) => {
      // Lock first, then plan against the locked state so two changes cannot interleave.
      const locked = await subscriptionsRepository.lockHeader(tx, subscriptionId);
      if (!locked) throw new NotFoundError('Subscription');
      const p = await this.plan(subscriptionId, input, actor, tx);
      const sub = p.subscription;
      const before = sub.lines.map(({ id: _id, ...l }) => l);
      if (
        JSON.stringify(before.map((l) => [lineKey(l), l.quantity])) ===
        JSON.stringify(p.lines.map((l) => [lineKey(l), l.quantity]))
      ) {
        throw new RuleError('Nothing changed');
      }

      await subscriptionsRepository.replaceLines(tx, sub.id, p.lines);
      const totals = priceLines(
        p.lines.map((l, i) => ({
          key: String(i),
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRateBp: l.taxRateBp,
        })),
      );
      await subscriptionsRepository.setTotals(tx, sub.id, totals);

      let chargeInvoiceId: number | null = null;
      if (p.period && p.proration.charges.length) {
        const created = await invoicesService.createInvoice(tx, {
          subscriptionId: sub.id,
          customerId: sub.customerId,
          periodStart: todayIso(),
          periodEnd: p.period.end,
          invoiceDate: todayIso(),
          dueDays: sub.dueDays,
          lines: p.proration.charges.map((c) => ({
            productId: c.productId,
            description: c.description,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            taxRateBp: c.taxRateBp,
            hsnSac: c.hsnSac,
          })),
          rules: [],
          kind: 'adjustment',
        });
        chargeInvoiceId = created!.id;
        await invoicesRepository.setStatus(tx, chargeInvoiceId, 'confirmed');
      }
      if (p.proration.creditTotal > 0) {
        await creditsService.grant(tx, {
          customerId: sub.customerId,
          amount: p.proration.creditTotal,
          reason: `Unused days after changing ${sub.number}`,
          subscriptionId: sub.id,
          createdBy: actor.userId,
        });
      }
      // Credit from this or an earlier change pays the new charge first.
      if (chargeInvoiceId) await creditsService.applyToInvoice(tx, chargeInvoiceId, actor.userId);

      await query(
        tx,
        `INSERT INTO subscription_changes (subscription_id, effective_date, before_lines, after_lines, days_left,
                                           days_in_period, charge_invoice_id, credit_amount, actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          sub.id,
          todayIso(),
          JSON.stringify(before),
          JSON.stringify(p.lines),
          p.proration.daysLeft,
          p.proration.daysInPeriod,
          chargeInvoiceId,
          p.proration.creditTotal,
          actor.userId,
        ],
      );
      const summary = [
        ...p.proration.charges.map((c) => c.description),
        ...p.proration.credits.map((c) => c.description),
      ].join('; ');
      const money = [
        p.proration.chargeTotal ? `charged ${formatMoney(p.proration.chargeTotal)}` : '',
        p.proration.creditTotal ? `credited ${formatMoney(p.proration.creditTotal)}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      await subscriptionsRepository.insertEvent(tx, {
        subscriptionId: sub.id,
        fromStatus: 'active',
        toStatus: 'active',
        note: `Changed${actor.role === 'customer' ? ' by the customer' : ''}: ${summary || 'next period only'}${money ? `; ${money}` : ''}`,
        actorId: actor.userId,
      });
      await audit(tx, {
        actorId: actor.userId,
        action: 'change_subscription',
        entity: 'subscription',
        entityId: sub.id,
        data: { chargeInvoiceId, credit: p.proration.creditTotal },
        requestId: actor.requestId,
      });

      return {
        customerId: sub.customerId,
        chargeInvoiceId,
        chargeTotal: p.proration.chargeTotal,
        creditTotal: p.proration.creditTotal,
      };
    });

    events.publish({
      type: 'subscription.changed',
      data: { id: subscriptionId, status: 'active' },
      customerId: result.customerId,
    });
    if (result.chargeInvoiceId) {
      events.publish({
        type: 'invoice.changed',
        data: { id: result.chargeInvoiceId },
        customerId: result.customerId,
      });
      // The adjustment invoice is emailed like any other; mail trouble never undoes the change.
      void invoicesService
        .get(result.chargeInvoiceId)
        .then((inv) => notifications.invoice(inv))
        .catch((err) =>
          logger.error(
            { err, invoiceId: result.chargeInvoiceId },
            'Adjustment invoice email failed',
          ),
        );
    }
    return { ...result, subscription: await subscriptionsService.get(subscriptionId) };
  },

  history: (subscriptionId: number) =>
    query<{
      id: number;
      effectiveDate: string;
      chargeInvoiceId: number | null;
      chargeNumber: string | null;
      creditAmount: number;
      actorName: string | null;
      createdAt: string;
    }>(
      pool,
      `SELECT c.id, c.effective_date, c.charge_invoice_id, i.number AS charge_number, c.credit_amount,
              u.full_name AS actor_name, c.created_at
       FROM subscription_changes c LEFT JOIN invoices i ON i.id = c.charge_invoice_id LEFT JOIN users u ON u.id = c.actor_id
       WHERE c.subscription_id = $1 ORDER BY c.created_at DESC`,
      [subscriptionId],
    ),
};
