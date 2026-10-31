import { todayIso } from '@brightloop/shared';
import type { PortalSubscribeInput, SubscriptionInput } from '@brightloop/shared';
import { pool, queryOne } from '../../db/pool';
import { plansRepository } from '../plans/plans.repository';
import { RuleError } from '../../lib/errors';
import type {
  InvoiceListQuery,
  SubscriptionAction,
  SubscriptionListQuery,
} from '@brightloop/shared';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { invoicesService } from '../invoices/invoices.service';
import { subscriptionsService } from '../subscriptions/subscriptions.service';

/** What a customer may do to their own subscription from the portal; "confirm" is accepting a quotation. */
const SELF_SERVICE: SubscriptionAction[] = ['confirm', 'pause', 'resume', 'close', 'renew'];

/**
 * The portal reuses the back-office services but pins every query to the
 * signed-in customer. A record that belongs to someone else is "not found".
 */
export const portalService = {
  listSubscriptions(q: SubscriptionListQuery, actor: Actor) {
    return subscriptionsService.list({ ...q, customerId: actor.customerId! });
  },

  async getSubscription(id: number, actor: Actor) {
    const sub = await subscriptionsService.get(id);
    if (sub.customerId !== actor.customerId || sub.status === 'draft')
      throw new NotFoundError('Subscription');
    const { notes: _internal, ...visible } = sub;
    return visible;
  },

  async act(id: number, action: SubscriptionAction, actor: Actor) {
    if (!SELF_SERVICE.includes(action))
      throw new ForbiddenError('Please contact us to make this change');
    const sub = await this.getSubscription(id, actor);
    if (action === 'confirm') {
      // Accepting a quote: confirm it, and start it at once if its start date has come.
      const confirmed = await subscriptionsService.transition(
        id,
        'confirm',
        'Quotation accepted by the customer',
        actor,
      );
      if (sub.startDate <= todayIso()) {
        return subscriptionsService.transition(id, 'activate', 'Started on acceptance', actor);
      }
      return confirmed;
    }
    return subscriptionsService.transition(
      id,
      action,
      'Requested by customer in the portal',
      actor,
    );
  },

  /** Plans a customer can buy today. */
  async listPlans() {
    const today = todayIso();
    const rows = await plansRepository.list(pool, { page: 1, pageSize: 100, dir: 'asc' });
    return rows
      .filter((p) => p.isActive && p.startDate <= today && (!p.endDate || p.endDate >= today))
      .map(({ activeSubscriptions: _n, ...p }) => p);
  },

  /** The back-office input a portal order stands for: always the customer's own, no discounts. */
  async toInput(input: PortalSubscribeInput, actor: Actor): Promise<SubscriptionInput> {
    if (input.startDate < todayIso()) throw new RuleError('The start date cannot be in the past');
    const term = await queryOne<{ id: number }>(
      pool,
      'SELECT id FROM payment_terms ORDER BY due_days, id LIMIT 1',
    );
    if (!term) throw new RuleError('No payment terms are set up yet');
    return {
      customerId: actor.customerId!,
      planId: input.planId,
      templateId: null,
      planQuantity: input.planQuantity,
      startDate: input.startDate,
      expiryDate: null,
      paymentTermId: term.id,
      notes: null,
      lines: input.lines.map((l) => ({ ...l, unitPrice: null })),
      discountIds: [],
    };
  },

  async previewOrder(input: PortalSubscribeInput, actor: Actor) {
    return subscriptionsService.preview(await this.toInput(input, actor));
  },

  /**
   * Subscribing in the portal is the customer accepting their own quote:
   * the subscription goes through Draft, Quotation and Confirmed on its
   * timeline, and starts at once when the start date is today.
   */
  async subscribe(input: PortalSubscribeInput, actor: Actor) {
    const created = await subscriptionsService.create(await this.toInput(input, actor), actor);
    await subscriptionsService.transition(
      created.id,
      'send_quotation',
      'Ordered by the customer in the portal',
      actor,
    );
    await subscriptionsService.transition(
      created.id,
      'confirm',
      'Confirmed by the customer',
      actor,
    );
    if (input.startDate <= todayIso())
      await subscriptionsService.transition(created.id, 'activate', 'Started on order', actor);
    return this.getSubscription(created.id, actor);
  },

  listInvoices(q: InvoiceListQuery, actor: Actor) {
    // Drafts are internal until confirmed.
    return invoicesService.list(
      { ...q, status: q.status === 'draft' ? 'confirmed' : q.status },
      actor,
    );
  },

  async getInvoice(id: number, actor: Actor) {
    const invoice = await invoicesService.get(id, actor);
    if (invoice.status === 'draft') throw new NotFoundError('Invoice');
    return invoice;
  },
};
