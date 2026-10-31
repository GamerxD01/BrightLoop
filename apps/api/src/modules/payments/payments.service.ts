import {
  formatMoney,
  todayIso,
  type ListQuery,
  type PaymentInput,
  type PaymentMethod,
} from '@brightloop/shared';
import { pool, withTransaction, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError, ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { paginated } from '../../lib/pagination';
import { invoicesRepository } from '../invoices/invoices.repository';
import { logger } from '../../lib/logger';
import { notifications } from '../notifications/notifications.service';
import { invoicesService } from '../invoices/invoices.service';
import { paymentsRepository } from './payments.repository';

export const paymentsService = {
  async list(q: ListQuery & { method?: PaymentMethod; from?: string; to?: string }) {
    return paginated(await paymentsRepository.list(pool, q), q);
  },

  /**
   * The rules for taking money, inside the caller's transaction, under a row
   * lock on the invoice: no overpayment, nothing on a draft or cancelled
   * invoice, and the invoice turns Paid the moment it is settled.
   */
  async recordInTx(tx: Db, input: PaymentInput, actor: Actor) {
    if (input.paidOn > todayIso())
      throw new ValidationError({ paidOn: 'Payment date cannot be in the future' });
    const invoice = await invoicesRepository.lockHeader(tx, input.invoiceId);
    if (!invoice) throw new NotFoundError('Invoice');
    if (invoice.status !== 'confirmed') {
      throw new RuleError(
        invoice.status === 'draft'
          ? 'Confirm the invoice before recording a payment'
          : `This invoice is already ${invoice.status}`,
      );
    }
    const due = invoice.amountTotal - invoice.amountPaid;
    if (input.amount > due)
      throw new ValidationError({ amount: `Only ${formatMoney(due)} is outstanding` });

    const payment = await paymentsRepository.insert(tx, input, actor.userId);
    await invoicesRepository.addPayment(tx, invoice.id, input.amount);
    await audit(tx, {
      actorId: actor.userId,
      action: 'record_payment',
      entity: 'payment',
      entityId: payment.id,
      data: { invoiceId: invoice.id, amount: input.amount },
      requestId: actor.requestId,
    });
    return { paymentId: payment.id, invoiceId: invoice.id, customerId: invoice.customerId };
  },

  /** What happens after a payment is committed: a receipt email and live updates. */
  async announce(
    invoiceId: number,
    customerId: number,
    input: Pick<PaymentInput, 'amount' | 'method' | 'paidOn'>,
  ) {
    const fresh = await invoicesService.get(invoiceId);
    // A receipt is a courtesy: a mail problem never undoes a recorded payment.
    notifications
      .receipt(fresh, input.amount, input.method, input.paidOn)
      .catch((err) => logger.error({ err, invoiceId }, 'Receipt email failed'));
    events.publish({
      type: 'payment.recorded',
      data: { invoiceId, amount: input.amount },
      customerId,
    });
    events.publish({
      type: 'invoice.changed',
      data: { id: invoiceId, status: fresh.status },
      customerId,
    });
    return fresh;
  },

  async record(input: PaymentInput, actor: Actor) {
    const done = await withTransaction((tx) => this.recordInTx(tx, input, actor));
    return this.announce(done.invoiceId, done.customerId, input);
  },
};
