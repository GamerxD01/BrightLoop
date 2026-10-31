import type { LineKind, SubscriptionListQuery, SubscriptionStatus } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface SubscriptionLine {
  id: number;
  kind: LineKind;
  productId: number | null;
  variantId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxId: number | null;
  taxRateBp: number;
  hsnSac: string | null;
}

export type NewLine = Omit<SubscriptionLine, 'id'>;

export interface SubscriptionHeader {
  id: number;
  number: string;
  customerId: number;
  planId: number;
  templateId: number | null;
  paymentTermId: number;
  renewedFromId: number | null;
  status: SubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
  quoteValidUntil: string | null;
  nextInvoiceDate: string | null;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDetail extends SubscriptionHeader {
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  planName: string;
  billingPeriod: string;
  billingInterval: number;
  minQuantity: number;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  autoClose: boolean;
  paymentTermName: string;
  dueDays: number;
  templateName: string | null;
  renewedFromNumber: string | null;
  lines: SubscriptionLine[];
  discountIds: number[];
  events: {
    id: number;
    fromStatus: SubscriptionStatus | null;
    toStatus: SubscriptionStatus;
    note: string | null;
    actorName: string | null;
    createdAt: string;
  }[];
}

export interface SubscriptionListRow {
  id: number;
  number: string;
  status: SubscriptionStatus;
  customerId: number;
  customerName: string;
  planName: string;
  billingPeriod: string;
  startDate: string;
  expiryDate: string | null;
  nextInvoiceDate: string | null;
  amountTotal: number;
  totalCount: number;
}

const DETAIL_SELECT = `
  SELECT s.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company,
         p.name AS plan_name, p.billing_period, p.billing_interval, p.min_quantity, p.closable, p.pausable,
         p.renewable, p.auto_close, pt.name AS payment_term_name, pt.due_days, qt.name AS template_name,
         rf.number AS renewed_from_number,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', l.id, 'kind', l.kind, 'productId', l.product_id, 'variantId', l.variant_id,
                     'description', l.description, 'quantity', l.quantity, 'unitPrice', l.unit_price,
                     'taxId', l.tax_id, 'taxRateBp', l.tax_rate_bp, 'hsnSac', l.hsn_sac) ORDER BY l.position, l.id)
                   FROM subscription_lines l WHERE l.subscription_id = s.id), '[]') AS lines,
         COALESCE((SELECT array_agg(sd.discount_id ORDER BY sd.discount_id)
                   FROM subscription_discounts sd WHERE sd.subscription_id = s.id), '{}') AS discount_ids,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', e.id, 'fromStatus', e.from_status, 'toStatus', e.to_status, 'note', e.note,
                     'actorName', u.full_name, 'createdAt', e.created_at) ORDER BY e.created_at, e.id)
                   FROM subscription_events e LEFT JOIN users u ON u.id = e.actor_id
                   WHERE e.subscription_id = s.id), '[]') AS events
  FROM subscriptions s
  JOIN customers c ON c.id = s.customer_id
  JOIN plans p ON p.id = s.plan_id
  JOIN payment_terms pt ON pt.id = s.payment_term_id
  LEFT JOIN quotation_templates qt ON qt.id = s.template_id
  LEFT JOIN subscriptions rf ON rf.id = s.renewed_from_id`;

export const subscriptionsRepository = {
  list(db: Db, q: SubscriptionListQuery) {
    const f = new SqlFilter()
      .add('s.status = ?', q.status)
      .add('s.plan_id = ?', q.planId)
      .add('s.customer_id = ?', q.customerId);
    if (q.q) f.add(`(s.number ILIKE ? OR c.name ILIKE $${f.params.length + 1})`, `%${q.q}%`);
    const order = orderBy(
      q.sort,
      q.dir,
      {
        number: 's.id',
        customer: 'c.name',
        startDate: 's.start_date',
        nextInvoiceDate: 's.next_invoice_date',
        amountTotal: 's.amount_total',
        createdAt: 's.created_at',
      },
      's.created_at',
    );
    const limit = f.page(q);
    return query<SubscriptionListRow>(
      db,
      `SELECT s.id, s.number, s.status, s.customer_id, c.name AS customer_name, p.name AS plan_name, p.billing_period,
              s.start_date, s.expiry_date, s.next_invoice_date, s.amount_total, count(*) OVER () AS total_count
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       ${f.where} ${order}, s.id DESC ${limit}`,
      f.params,
    );
  },

  findDetail: (db: Db, id: number) =>
    queryOne<SubscriptionDetail>(db, `${DETAIL_SELECT} WHERE s.id = $1`, [id]),

  /** Row lock for any status change, so two people cannot move the same subscription at once. */
  lockHeader: (db: Db, id: number) =>
    queryOne<SubscriptionHeader>(db, 'SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE', [id]),

  async insert(
    db: Db,
    s: Pick<
      SubscriptionHeader,
      | 'number'
      | 'customerId'
      | 'planId'
      | 'templateId'
      | 'paymentTermId'
      | 'renewedFromId'
      | 'status'
      | 'startDate'
      | 'expiryDate'
      | 'quoteValidUntil'
      | 'notes'
    > & { createdBy: number },
  ) {
    return (await queryOne<{ id: number }>(
      db,
      `INSERT INTO subscriptions (number, customer_id, plan_id, template_id, payment_term_id, renewed_from_id, status,
                                  start_date, expiry_date, quote_valid_until, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        s.number,
        s.customerId,
        s.planId,
        s.templateId,
        s.paymentTermId,
        s.renewedFromId,
        s.status,
        s.startDate,
        s.expiryDate,
        s.quoteValidUntil,
        s.notes,
        s.createdBy,
      ],
    ))!.id;
  },

  updateHeader: (
    db: Db,
    id: number,
    s: Pick<
      SubscriptionHeader,
      'customerId' | 'planId' | 'paymentTermId' | 'startDate' | 'expiryDate' | 'notes'
    >,
  ) =>
    query(
      db,
      `UPDATE subscriptions SET customer_id=$2, plan_id=$3, payment_term_id=$4, start_date=$5, expiry_date=$6, notes=$7,
              updated_at=now() WHERE id=$1`,
      [id, s.customerId, s.planId, s.paymentTermId, s.startDate, s.expiryDate, s.notes],
    ),

  setTotals: (db: Db, id: number, t: { untaxed: number; tax: number; total: number }) =>
    query(
      db,
      'UPDATE subscriptions SET amount_untaxed=$2, amount_tax=$3, amount_total=$4 WHERE id=$1',
      [id, t.untaxed, t.tax, t.total],
    ),

  async replaceLines(db: Db, subscriptionId: number, lines: NewLine[]) {
    await query(db, 'DELETE FROM subscription_lines WHERE subscription_id = $1', [subscriptionId]);
    await query(
      db,
      `INSERT INTO subscription_lines (subscription_id, kind, product_id, variant_id, description, quantity, unit_price,
                                       tax_id, tax_rate_bp, position, hsn_sac)
       SELECT $1, x.kind, x.product_id, x.variant_id, x.description, x.quantity, x.unit_price, x.tax_id, x.tax_rate_bp, x.position, x.hsn_sac
       FROM unnest($2::line_kind[], $3::bigint[], $4::bigint[], $5::text[], $6::int[], $7::bigint[], $8::bigint[], $9::int[], $10::int[], $11::text[])
            AS x(kind, product_id, variant_id, description, quantity, unit_price, tax_id, tax_rate_bp, position, hsn_sac)`,
      [
        subscriptionId,
        lines.map((l) => l.kind),
        lines.map((l) => l.productId),
        lines.map((l) => l.variantId),
        lines.map((l) => l.description),
        lines.map((l) => l.quantity),
        lines.map((l) => l.unitPrice),
        lines.map((l) => l.taxId),
        lines.map((l) => l.taxRateBp),
        lines.map((_, i) => i),
        lines.map((l) => l.hsnSac ?? null),
      ],
    );
  },

  async replaceDiscounts(db: Db, subscriptionId: number, discountIds: number[]) {
    await query(db, 'DELETE FROM subscription_discounts WHERE subscription_id = $1', [
      subscriptionId,
    ]);
    if (discountIds.length) {
      await query(
        db,
        'INSERT INTO subscription_discounts (subscription_id, discount_id) SELECT $1, unnest($2::bigint[])',
        [subscriptionId, discountIds],
      );
    }
  },

  findLines: (db: Db, subscriptionId: number) =>
    query<SubscriptionLine>(
      db,
      'SELECT * FROM subscription_lines WHERE subscription_id = $1 ORDER BY position, id',
      [subscriptionId],
    ),

  setStatus: (
    db: Db,
    id: number,
    patch: {
      status: SubscriptionStatus;
      nextInvoiceDate?: string | null;
      quoteValidUntil?: string | null;
    },
  ) =>
    query(
      db,
      `UPDATE subscriptions SET status = $2,
              next_invoice_date = CASE WHEN $3::boolean THEN $4::date ELSE next_invoice_date END,
              quote_valid_until = CASE WHEN $5::boolean THEN $6::date ELSE quote_valid_until END,
              updated_at = now()
       WHERE id = $1`,
      [
        id,
        patch.status,
        patch.nextInvoiceDate !== undefined,
        patch.nextInvoiceDate ?? null,
        patch.quoteValidUntil !== undefined,
        patch.quoteValidUntil ?? null,
      ],
    ),

  insertEvent: (
    db: Db,
    e: {
      subscriptionId: number;
      fromStatus: SubscriptionStatus | null;
      toStatus: SubscriptionStatus;
      note?: string | null;
      actorId: number | null;
    },
  ) =>
    query(
      db,
      'INSERT INTO subscription_events (subscription_id, from_status, to_status, note, actor_id) VALUES ($1,$2,$3,$4,$5)',
      [e.subscriptionId, e.fromStatus, e.toStatus, e.note ?? null, e.actorId],
    ),
};
