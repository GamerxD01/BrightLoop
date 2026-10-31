import {
  LABELS,
  SUBSCRIPTION_TRANSITIONS,
  addDays,
  addPeriod,
  isSubscriptionEditable,
  priceLines,
  subscriptionActionBlocker,
  todayIso,
  type PricingResult,
  type SubscriptionAction,
  type SubscriptionInput,
  type SubscriptionListQuery,
} from '@brightloop/shared';
import { pool, withTransaction, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError, ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { paginated } from '../../lib/pagination';
import { nextNumber } from '../../lib/sequence';
import { catalogRepository } from '../catalog/catalog.repository';
import { customersService } from '../customers/customers.service';
import { discountsRepository } from '../discounts/discounts.repository';
import { plansService } from '../plans/plans.service';
import type { Plan } from '../plans/plans.repository';
import { templatesService } from '../templates/templates.service';
import {
  subscriptionsRepository as repo,
  type NewLine,
  type SubscriptionDetail,
} from './subscriptions.repository';

const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

/**
 * Turns the request into stored lines: a plan line first (seats × plan price),
 * then add-on product lines priced from the catalog (sales price + variant extra)
 * unless the salesperson negotiated a unit price.
 */
async function buildLines(db: Db, input: SubscriptionInput, plan: Plan): Promise<NewLine[]> {
  if (input.planQuantity < plan.minQuantity) {
    throw new ValidationError({ planQuantity: `This plan needs at least ${plan.minQuantity}` });
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = new Map(
    (await catalogRepository.findProductsByIds(db, productIds)).map((p) => [p.id, p]),
  );

  const fieldErrors: Record<string, string> = {};
  const lines: NewLine[] = [
    {
      kind: 'plan',
      productId: null,
      variantId: null,
      description: `${plan.name}, billed ${LABELS.billingPeriod[plan.billingPeriod].toLowerCase()}`,
      quantity: input.planQuantity,
      unitPrice: plan.price,
      taxId: plan.taxId,
      taxRateBp: plan.taxRateBp ?? 0,
      hsnSac: plan.hsnSac,
    },
  ];

  input.lines.forEach((line, i) => {
    const product = products.get(line.productId);
    if (!product || !product.isActive) {
      fieldErrors[`lines.${i}.productId`] = 'Product is not available';
      return;
    }
    const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : null;
    if (line.variantId && !variant) {
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
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? product.salesPrice + (variant?.extraPrice ?? 0),
      taxId: product.taxId,
      taxRateBp: product.taxRateBp ?? 0,
      hsnSac: product.hsnSac,
    });
  });

  if (Object.keys(fieldErrors).length) throw new ValidationError(fieldErrors);
  return lines;
}

function toPricingLines(lines: NewLine[]) {
  return lines.map((l, i) => ({
    key: String(i),
    productId: l.productId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxRateBp: l.taxRateBp,
  }));
}

async function validateReferences(db: Db, input: SubscriptionInput) {
  await customersService.get(input.customerId);
  const terms = await catalogRepository.listPaymentTerms(db);
  if (!terms.some((t) => t.id === input.paymentTermId))
    throw new ValidationError({ paymentTermId: 'Payment term not found' });
  const discountIds = [...new Set(input.discountIds)];
  if (discountIds.length) {
    const found = await discountsRepository.findByIds(db, discountIds);
    if (found.length !== discountIds.length)
      throw new ValidationError({ discountIds: 'A selected discount no longer exists' });
  }
  return discountIds;
}

function publishChange(id: number, customerId: number, status: string) {
  events.publish({ type: 'subscription.changed', data: { id, status }, customerId });
}

export const subscriptionsService = {
  async list(q: SubscriptionListQuery) {
    return paginated(await repo.list(pool, q), q);
  },

  async get(id: number, db: Db = pool): Promise<SubscriptionDetail> {
    const sub = await repo.findDetail(db, id);
    if (!sub) throw new NotFoundError('Subscription');
    return sub;
  },

  /** Authoritative price check for the live preview; nothing is saved. */
  async preview(
    input: SubscriptionInput,
  ): Promise<
    PricingResult & { lines: (PricingResult['lines'][number] & { description: string })[] }
  > {
    const plan = await plansService.get(input.planId);
    const lines = await buildLines(pool, input, plan);
    const rules = input.discountIds.length
      ? await discountsRepository.findByIds(pool, input.discountIds)
      : [];
    const result = priceLines(
      toPricingLines(lines),
      rules,
      input.startDate > todayIso() ? input.startDate : todayIso(),
    );
    return {
      ...result,
      lines: result.lines.map((l, i) => ({ ...l, description: lines[i]!.description })),
    };
  },

  async create(
    input: SubscriptionInput,
    actor: Actor,
    extra: { templateId?: number; quoteValidUntil?: string } = {},
  ) {
    const plan = await plansService.get(input.planId);
    plansService.assertSellable(plan);
    const discountIds = await validateReferences(pool, input);
    const lines = await buildLines(pool, input, plan);
    const totals = priceLines(toPricingLines(lines));

    const id = await withTransaction(async (tx) => {
      const id = await repo.insert(tx, {
        number: await nextNumber(tx, 'SUB'),
        customerId: input.customerId,
        planId: plan.id,
        templateId: extra.templateId ?? input.templateId,
        paymentTermId: input.paymentTermId,
        renewedFromId: null,
        status: 'draft',
        startDate: input.startDate,
        expiryDate: input.expiryDate,
        quoteValidUntil: extra.quoteValidUntil ?? null,
        notes: input.notes,
        createdBy: actor.userId,
      });
      await repo.replaceLines(tx, id, lines);
      await repo.replaceDiscounts(tx, id, discountIds);
      await repo.setTotals(tx, id, totals);
      await repo.insertEvent(tx, {
        subscriptionId: id,
        fromStatus: null,
        toStatus: 'draft',
        note: 'Created',
        actorId: actor.userId,
      });
      await audit(tx, {
        actorId: actor.userId,
        action: 'create_subscription',
        entity: 'subscription',
        entityId: id,
        requestId: actor.requestId,
      });
      return id;
    });
    publishChange(id, input.customerId, 'draft');
    return this.get(id);
  },

  /** Starts a quote from a template: its plan, lines and validity come along. */
  async createFromTemplate(
    input: { templateId: number; customerId: number; startDate: string },
    actor: Actor,
  ) {
    const template = await templatesService.get(input.templateId);
    const plan = await plansService.get(template.planId);
    return this.create(
      {
        customerId: input.customerId,
        planId: template.planId,
        templateId: template.id,
        planQuantity: plan.minQuantity,
        startDate: input.startDate,
        expiryDate: null,
        paymentTermId: template.paymentTermId,
        notes: template.notes,
        lines: template.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: null,
        })),
        discountIds: [],
      },
      actor,
      { templateId: template.id, quoteValidUntil: addDays(todayIso(), template.validityDays) },
    );
  },

  async update(id: number, input: SubscriptionInput, actor: Actor) {
    const plan = await plansService.get(input.planId);
    const discountIds = await validateReferences(pool, input);
    const lines = await buildLines(pool, input, plan);
    const totals = priceLines(toPricingLines(lines));

    const customerId = await withTransaction(async (tx) => {
      const current = await repo.lockHeader(tx, id);
      if (!current) throw new NotFoundError('Subscription');
      if (!isSubscriptionEditable(current.status)) {
        throw new RuleError(`A ${current.status} subscription can no longer be edited`);
      }
      if (current.planId !== plan.id) plansService.assertSellable(plan);
      await repo.updateHeader(tx, id, { ...input, planId: plan.id });
      await repo.replaceLines(tx, id, lines);
      await repo.replaceDiscounts(tx, id, discountIds);
      await repo.setTotals(tx, id, totals);
      await audit(tx, {
        actorId: actor.userId,
        action: 'update_subscription',
        entity: 'subscription',
        entityId: id,
        requestId: actor.requestId,
      });
      return current.customerId;
    });
    publishChange(id, customerId, 'updated');
    return this.get(id);
  },

  /**
   * Every status change goes through here: row lock, rule check from the shared
   * workflow table, side effects, timeline entry, realtime event.
   */
  async transition(id: number, action: SubscriptionAction, note: string | null, actor: Actor) {
    if (action === 'renew') return this.renew(id, actor);

    const result = await withTransaction(async (tx) => {
      const sub = await repo.lockHeader(tx, id);
      if (!sub) throw new NotFoundError('Subscription');
      if (actor.role === 'customer' && sub.customerId !== actor.customerId)
        throw new NotFoundError('Subscription');
      const plan = await plansService.get(sub.planId, tx);

      const blocker = subscriptionActionBlocker(action, sub.status, plan);
      if (blocker) throw new RuleError(blocker);

      const today = todayIso();
      const to = SUBSCRIPTION_TRANSITIONS[action].to;
      const patch: Parameters<typeof repo.setStatus>[2] = { status: to };

      switch (action) {
        case 'send_quotation':
          patch.quoteValidUntil =
            sub.quoteValidUntil ?? addDays(today, DEFAULT_QUOTE_VALIDITY_DAYS);
          break;
        case 'confirm':
          if (sub.quoteValidUntil && sub.quoteValidUntil < today) {
            throw new RuleError(
              `This quotation expired on ${sub.quoteValidUntil}. Send a fresh one.`,
            );
          }
          break;
        case 'activate':
          if (sub.expiryDate && sub.expiryDate <= today)
            throw new RuleError('The expiry date has already passed');
          // First invoice covers the period that starts on the start date.
          patch.nextInvoiceDate = sub.nextInvoiceDate ?? sub.startDate;
          break;
        case 'resume': {
          // Paused periods are not billed: billing picks up from today at the earliest.
          const next = sub.nextInvoiceDate ?? today;
          patch.nextInvoiceDate = next < today ? today : next;
          break;
        }
        case 'close':
          patch.nextInvoiceDate = null;
          break;
      }

      await repo.setStatus(tx, id, patch);
      await repo.insertEvent(tx, {
        subscriptionId: id,
        fromStatus: sub.status,
        toStatus: to,
        note,
        actorId: actor.userId,
      });
      await audit(tx, {
        actorId: actor.userId,
        action: `subscription_${action}`,
        entity: 'subscription',
        entityId: id,
        requestId: actor.requestId,
      });
      return { customerId: sub.customerId, status: to };
    });

    publishChange(id, result.customerId, result.status);
    return this.get(id);
  },

  /** Renewal opens a new quotation for the next term, linked to the old one. */
  async renew(id: number, actor: Actor) {
    const old = await this.get(id);
    if (actor.role === 'customer' && old.customerId !== actor.customerId)
      throw new NotFoundError('Subscription');
    const blocker = subscriptionActionBlocker('renew', old.status, old);
    if (blocker) throw new RuleError(blocker);

    const start = old.expiryDate ?? todayIso();
    const termDays = old.expiryDate
      ? Math.round((Date.parse(old.expiryDate) - Date.parse(old.startDate)) / 86_400_000)
      : null;

    const newId = await withTransaction(async (tx) => {
      const newId = await repo.insert(tx, {
        number: await nextNumber(tx, 'SUB'),
        customerId: old.customerId,
        planId: old.planId,
        templateId: old.templateId,
        paymentTermId: old.paymentTermId,
        renewedFromId: old.id,
        status: 'quotation',
        startDate: start,
        expiryDate: termDays ? addDays(start, termDays) : null,
        quoteValidUntil: addDays(todayIso(), DEFAULT_QUOTE_VALIDITY_DAYS),
        notes: old.notes,
        createdBy: actor.userId,
      });
      await repo.replaceLines(tx, newId, old.lines);
      await repo.replaceDiscounts(tx, newId, old.discountIds);
      await repo.setTotals(tx, newId, {
        untaxed: old.amountUntaxed,
        tax: old.amountTax,
        total: old.amountTotal,
      });
      await repo.insertEvent(tx, {
        subscriptionId: newId,
        fromStatus: null,
        toStatus: 'quotation',
        note: `Renewal of ${old.number}`,
        actorId: actor.userId,
      });
      await repo.insertEvent(tx, {
        subscriptionId: old.id,
        fromStatus: old.status,
        toStatus: old.status,
        note: 'Renewal quotation created',
        actorId: actor.userId,
      });
      return newId;
    });
    publishChange(newId, old.customerId, 'quotation');
    return this.get(newId);
  },

  /** Next period window for a subscription, used by billing and the detail page. */
  nextPeriod(
    sub: Pick<SubscriptionDetail, 'nextInvoiceDate' | 'billingPeriod' | 'billingInterval'>,
  ) {
    if (!sub.nextInvoiceDate) return null;
    const end = addDays(
      addPeriod(
        sub.nextInvoiceDate,
        sub.billingPeriod as Plan['billingPeriod'],
        sub.billingInterval,
      ),
      -1,
    );
    return { start: sub.nextInvoiceDate, end };
  },
};
