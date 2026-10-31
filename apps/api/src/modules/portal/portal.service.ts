import type {
  InvoiceListQuery,
  SubscriptionAction,
  SubscriptionListQuery,
} from '@brightloop/shared';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { invoicesService } from '../invoices/invoices.service';
import { subscriptionsService } from '../subscriptions/subscriptions.service';

/** What a customer may do to their own subscription from the portal. */
const SELF_SERVICE: SubscriptionAction[] = ['pause', 'resume', 'close', 'renew'];

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
    await this.getSubscription(id, actor);
    return subscriptionsService.transition(
      id,
      action,
      'Requested by customer in the portal',
      actor,
    );
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
