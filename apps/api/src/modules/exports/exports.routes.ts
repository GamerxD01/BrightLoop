import { Router, type Request, type Response } from 'express';
import {
  LABELS,
  invoiceListQuerySchema,
  listQuerySchema,
  paymentListQuerySchema,
  subscriptionListQuerySchema,
  todayIso,
} from '@brightloop/shared';
import type { ZodTypeAny } from 'zod';
import { pool } from '../../db/pool';
import { audit } from '../../lib/audit';
import { toCsv, rupees, type Cell } from '../../lib/csv';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { actorOf } from '../../lib/http';
import { customersRepository } from '../customers/customers.repository';
import { invoicesRepository } from '../invoices/invoices.repository';
import { paymentsRepository } from '../payments/payments.repository';
import { subscriptionsRepository } from '../subscriptions/subscriptions.repository';
import { toFieldErrors } from '@brightloop/shared';

/** The most rows one export returns; filters narrow anything bigger. */
const MAX_ROWS = 50_000;

interface Export {
  schema: ZodTypeAny;
  headers: string[];
  rows: (q: Record<string, unknown>) => Promise<Cell[][]>;
}

/**
 * Every list exports exactly what its screen shows: the same filters, the
 * same query, all pages. Read through the same repositories as the screens.
 */
const EXPORTS: Record<string, Export> = {
  subscriptions: {
    schema: subscriptionListQuerySchema,
    headers: [
      'Number',
      'Customer',
      'Plan',
      'Status',
      'Start',
      'Expiry',
      'Next invoice',
      'Per period (INR)',
    ],
    rows: async (q) =>
      (await subscriptionsRepository.list(pool, q as never)).map((s) => [
        s.number,
        s.customerName,
        s.planName,
        LABELS.subscriptionStatus[s.status],
        s.startDate,
        s.expiryDate,
        s.nextInvoiceDate,
        rupees(s.amountTotal),
      ]),
  },
  invoices: {
    schema: invoiceListQuerySchema,
    headers: [
      'Number',
      'Customer',
      'Subscription',
      'Issued',
      'Due',
      'Status',
      'Overdue',
      'Total (INR)',
      'Paid (INR)',
      'Owed (INR)',
    ],
    rows: async (q) =>
      (await invoicesRepository.list(pool, q as never)).map((i) => [
        i.number,
        i.customerName,
        i.subscriptionNumber,
        i.invoiceDate,
        i.dueDate,
        LABELS.invoiceStatus[i.status],
        i.isOverdue ? 'Yes' : 'No',
        rupees(i.amountTotal),
        rupees(i.amountPaid),
        rupees(i.status === 'confirmed' ? i.amountTotal - i.amountPaid : 0),
      ]),
  },
  payments: {
    schema: paymentListQuerySchema,
    headers: ['Received', 'Invoice', 'Customer', 'Method', 'Amount (INR)', 'Note', 'Recorded by'],
    rows: async (q) =>
      (await paymentsRepository.list(pool, q as never)).map((p) => [
        p.paidOn,
        p.invoiceNumber,
        p.customerName,
        LABELS.paymentMethod[p.method],
        rupees(p.amount),
        p.note,
        p.recordedBy,
      ]),
  },
  customers: {
    schema: listQuerySchema,
    headers: [
      'Name',
      'Company',
      'Email',
      'Phone',
      'Active subscriptions',
      'Owes (INR)',
      'Portal login',
    ],
    rows: async (q) =>
      (await customersRepository.list(pool, q as never)).map((c) => [
        c.name,
        c.company,
        c.email,
        c.phone,
        c.activeSubscriptions,
        rupees(c.outstanding),
        c.hasPortalAccess ? 'Yes' : 'No',
      ]),
  },
};

export const exportsRoutes = Router().get('/:entity', async (req: Request, res: Response) => {
  const def = EXPORTS[String(req.params.entity)];
  if (!def) throw new NotFoundError('Export');
  const parsed = def.schema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError(toFieldErrors(parsed.error));
  const q = { ...parsed.data, page: 1, pageSize: MAX_ROWS };

  const rows = await def.rows(q);
  await audit(pool, {
    actorId: actorOf(req).userId,
    action: 'export',
    entity: String(req.params.entity),
    data: { rows: rows.length, filters: req.query as Record<string, unknown> },
    requestId: req.id,
  });
  res
    .type('text/csv; charset=utf-8')
    .attachment(`brightloop-${req.params.entity}-${todayIso()}.csv`)
    .send(toCsv(def.headers, rows));
});
