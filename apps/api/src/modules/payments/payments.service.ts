import {
  formatMoney,
  todayIso,
  type ListQuery,
  type PaymentInput,
  type PaymentMethod,
} from '@brightloop/shared';
import { pool, withTransaction } from '../../db/pool';
import { audit } from '../../lib/audit';
import { NotFoundError, RuleError, ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { paginated } from '../../lib/pagination';
import { invoicesRepository } from '../invoices/invoices.repository';
import { invoicesService } from '../invoices/invoices.service';
import { paymentsRepository } from './payments.repository';

export const paymentsService = {
  async list(q: ListQuery & { method?: PaymentMethod; from?: string; to?: string }) {
    return paginated(await paymentsRepository.list(pool, q), q);
  },

  /**
   * Records money against one invoice under a row lock: no overpayment, no
   * payment on a draft or cancelled invoice, and the invoice flips to Paid
   * the moment it is fully settled.
   */
  async record(input: PaymentInput, actor: Actor) {
    if (input.paidOn > todayIso())
      throw new ValidationError({ paidOn: 'Payment date cannot be in the future' });

    const invoice = await withTransaction(async (tx) => {
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
      return invoice;
    });

    const fresh = await invoicesService.get(invoice.id);
    events.publish({
      type: 'payment.recorded',
      data: { invoiceId: invoice.id, amount: input.amount },
      customerId: invoice.customerId,
    });
    events.publish({
      type: 'invoice.changed',
      data: { id: invoice.id, status: fresh.status },
      customerId: invoice.customerId,
    });
    return fresh;
  },
};
