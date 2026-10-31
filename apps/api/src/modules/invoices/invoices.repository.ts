import type { InvoiceListQuery, InvoiceKind, InvoiceStatus } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';
import type { SellerSnapshot } from '../company/company.service';

export interface InvoiceHeader {
  id: number;
  number: string;
  subscriptionId: number | null;
  customerId: number;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  amountUntaxed: number;
  amountDiscount: number;
  amountTax: number;
  amountTotal: number;
  amountPaid: number;
  sentAt: string | null;
  gstMode: 'intra' | 'inter';
  placeOfSupply: string | null;
  customerGstin: string | null;
  amountCgst: number;
  amountSgst: number;
  amountIgst: number;
  seller: SellerSnapshot | null;
  kind: InvoiceKind;
}

export interface InvoiceLineRow {
  id: number;
  productId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRateBp: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  hsnSac: string | null;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceDetail extends InvoiceHeader {
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  customerAddress: string | null;
  subscriptionNumber: string | null;
  planName: string | null;
  isOverdue: boolean;
  amountDue: number;
  lines: InvoiceLineRow[];
  payments: {
    id: number;
    amount: number;
    method: string;
    paidOn: string;
    note: string | null;
    recordedBy: string | null;
  }[];
  discounts: { name: string; amount: number }[];
}

export interface InvoiceListRow {
  id: number;
  number: string;
  status: InvoiceStatus;
  customerId: number;
  customerName: string;
  subscriptionNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amountTotal: number;
  amountPaid: number;
  isOverdue: boolean;
  totalCount: number;
}

const OVERDUE = `(i.status = 'confirmed' AND i.due_date < CURRENT_DATE)`;

export const invoicesRepository = {
  list(db: Db, q: InvoiceListQuery & { customerScope?: number }) {
    const f = new SqlFilter()
      .add('i.status = ?', q.status)
      .add('i.customer_id = ?', q.customerScope ?? q.customerId)
      .add('i.subscription_id = ?', q.subscriptionId)
      .add('i.invoice_date >= ?', q.from)
      .add('i.invoice_date <= ?', q.to);
    if (q.overdue) f.raw(OVERDUE);
    if (q.q) f.add(`(i.number ILIKE ? OR c.name ILIKE $${f.params.length + 1})`, `%${q.q}%`);
    const order = orderBy(
      q.sort,
      q.dir,
      {
        number: 'i.id',
        invoiceDate: 'i.invoice_date',
        dueDate: 'i.due_date',
        amountTotal: 'i.amount_total',
        customer: 'c.name',
      },
      'i.invoice_date',
    );
    const limit = f.page(q);
    return query<InvoiceListRow>(
      db,
      `SELECT i.id, i.number, i.status, i.customer_id, c.name AS customer_name, s.number AS subscription_number,
              i.invoice_date, i.due_date, i.amount_total, i.amount_paid, ${OVERDUE} AS is_overdue,
              count(*) OVER () AS total_count
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN subscriptions s ON s.id = i.subscription_id
       ${f.where} ${order}, i.id DESC ${limit}`,
      f.params,
    );
  },

  findDetail: (db: Db, id: number) =>
    queryOne<InvoiceDetail>(
      db,
      `SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company,
              c.address AS customer_address, s.number AS subscription_number, p.name AS plan_name,
              ${OVERDUE} AS is_overdue, i.amount_total - i.amount_paid AS amount_due,
              COALESCE((SELECT json_agg(json_build_object(
                          'id', l.id, 'productId', l.product_id, 'description', l.description, 'quantity', l.quantity,
                          'unitPrice', l.unit_price, 'discount', l.discount, 'taxRateBp', l.tax_rate_bp,
                          'taxAmount', l.tax_amount, 'subtotal', l.subtotal, 'total', l.total, 'hsnSac', l.hsn_sac,
                          'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst) ORDER BY l.position, l.id)
                        FROM invoice_lines l WHERE l.invoice_id = i.id), '[]') AS lines,
              COALESCE((SELECT json_agg(json_build_object(
                          'id', pm.id, 'amount', pm.amount, 'method', pm.method, 'paidOn', pm.paid_on,
                          'note', pm.note, 'recordedBy', u.full_name) ORDER BY pm.paid_on, pm.id)
                        FROM payments pm LEFT JOIN users u ON u.id = pm.recorded_by WHERE pm.invoice_id = i.id), '[]') AS payments,
              COALESCE((SELECT json_agg(json_build_object('name', d.name, 'amount', du.amount) ORDER BY du.id)
                        FROM discount_usages du JOIN discounts d ON d.id = du.discount_id WHERE du.invoice_id = i.id), '[]') AS discounts
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       LEFT JOIN subscriptions s ON s.id = i.subscription_id
       LEFT JOIN plans p ON p.id = s.plan_id
       WHERE i.id = $1`,
      [id],
    ),

  lockHeader: (db: Db, id: number) =>
    queryOne<InvoiceHeader>(db, 'SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]),

  /** ON CONFLICT on the one-live-invoice-per-period index: a second attempt returns null. */
  insert: (db: Db, i: Omit<InvoiceHeader, 'id' | 'status' | 'amountPaid' | 'sentAt'>) =>
    queryOne<{ id: number }>(
      db,
      `INSERT INTO invoices (number, subscription_id, customer_id, period_start, period_end, invoice_date, due_date,
                             amount_untaxed, amount_discount, amount_tax, amount_total, gst_mode, place_of_supply,
                             customer_gstin, amount_cgst, amount_sgst, amount_igst, seller, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (subscription_id, period_start) WHERE status <> 'cancelled' AND kind = 'recurring' DO NOTHING
       RETURNING id`,
      [
        i.number,
        i.subscriptionId,
        i.customerId,
        i.periodStart,
        i.periodEnd,
        i.invoiceDate,
        i.dueDate,
        i.amountUntaxed,
        i.amountDiscount,
        i.amountTax,
        i.amountTotal,
        i.gstMode,
        i.placeOfSupply,
        i.customerGstin,
        i.amountCgst,
        i.amountSgst,
        i.amountIgst,
        i.seller ? JSON.stringify(i.seller) : null,
        i.kind,
      ],
    ),

  insertLines: (db: Db, invoiceId: number, lines: Omit<InvoiceLineRow, 'id'>[]) =>
    query(
      db,
      `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount, tax_rate_bp,
                                  tax_amount, subtotal, total, position, hsn_sac, cgst, sgst, igst)
       SELECT $1, x.product_id, x.description, x.quantity, x.unit_price, x.discount, x.tax_rate_bp, x.tax_amount,
              x.subtotal, x.total, x.position, x.hsn_sac, x.cgst, x.sgst, x.igst
       FROM unnest($2::bigint[], $3::text[], $4::int[], $5::bigint[], $6::bigint[], $7::int[], $8::bigint[], $9::bigint[],
                   $10::bigint[], $11::int[], $12::text[], $13::bigint[], $14::bigint[], $15::bigint[])
            AS x(product_id, description, quantity, unit_price, discount, tax_rate_bp, tax_amount, subtotal, total,
                 position, hsn_sac, cgst, sgst, igst)`,
      [
        invoiceId,
        lines.map((l) => l.productId),
        lines.map((l) => l.description),
        lines.map((l) => l.quantity),
        lines.map((l) => l.unitPrice),
        lines.map((l) => l.discount),
        lines.map((l) => l.taxRateBp),
        lines.map((l) => l.taxAmount),
        lines.map((l) => l.subtotal),
        lines.map((l) => l.total),
        lines.map((_, i) => i),
        lines.map((l) => l.hsnSac),
        lines.map((l) => l.cgst),
        lines.map((l) => l.sgst),
        lines.map((l) => l.igst),
      ],
    ),

  setStatus: (db: Db, id: number, status: InvoiceStatus) =>
    query(
      db,
      `UPDATE invoices SET status = $2::invoice_status,
              confirmed_at = CASE WHEN $2::invoice_status = 'confirmed' THEN now() ELSE confirmed_at END,
              cancelled_at = CASE WHEN $2::invoice_status = 'cancelled' THEN now() ELSE cancelled_at END,
              paid_at      = CASE WHEN $2::invoice_status = 'paid' THEN now() ELSE paid_at END,
              updated_at = now()
       WHERE id = $1`,
      [id, status],
    ),

  markSent: (db: Db, id: number) =>
    query(db, 'UPDATE invoices SET sent_at = now(), updated_at = now() WHERE id = $1', [id]),

  addPayment: (db: Db, id: number, amount: number) =>
    queryOne<{ amountPaid: number; amountTotal: number }>(
      db,
      `UPDATE invoices SET amount_paid = amount_paid + $2,
              status = CASE WHEN amount_paid + $2 = amount_total THEN 'paid'::invoice_status ELSE status END,
              paid_at = CASE WHEN amount_paid + $2 = amount_total THEN now() ELSE paid_at END,
              updated_at = now()
       WHERE id = $1 RETURNING amount_paid, amount_total`,
      [id, amount],
    ),

  /** Bulk confirm of drafts created by a billing run. */
  confirmDrafts: (db: Db, ids: number[]) =>
    query<{ id: number; customerId: number }>(
      db,
      `UPDATE invoices SET status = 'confirmed', confirmed_at = now(), updated_at = now()
       WHERE id = ANY($1::bigint[]) AND status = 'draft' RETURNING id, customer_id`,
      [ids],
    ),
};
