import type { DiscountInput, DiscountRule } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';

export interface Discount extends DiscountRule {
  productNames: string[];
  createdAt: string;
}

const SELECT = `
  SELECT d.*,
         COALESCE(array_agg(dp.product_id ORDER BY dp.product_id) FILTER (WHERE dp.product_id IS NOT NULL), '{}') AS product_ids,
         COALESCE(array_agg(p.name ORDER BY dp.product_id) FILTER (WHERE p.id IS NOT NULL), '{}') AS product_names
  FROM discounts d
  LEFT JOIN discount_products dp ON dp.discount_id = d.id
  LEFT JOIN products p ON p.id = dp.product_id`;

const values = (d: DiscountInput) => [
  d.name,
  d.type,
  d.value,
  d.scope,
  d.minAmount,
  d.minQuantity,
  d.startDate,
  d.endDate,
  d.usageLimit,
  d.isActive,
];

export const discountsRepository = {
  list: (db: Db) =>
    query<Discount>(db, `${SELECT} GROUP BY d.id ORDER BY d.is_active DESC, d.start_date DESC`),
  findById: (db: Db, id: number) =>
    queryOne<Discount>(db, `${SELECT} WHERE d.id = $1 GROUP BY d.id`, [id]),
  findByIds: (db: Db, ids: number[]) =>
    query<Discount>(db, `${SELECT} WHERE d.id = ANY($1::bigint[]) GROUP BY d.id ORDER BY d.id`, [
      ids,
    ]),

  /** Discounts attached to a subscription. */
  forSubscription: (db: Db, subscriptionId: number) =>
    query<Discount>(
      db,
      `${SELECT} WHERE d.id IN (SELECT discount_id FROM subscription_discounts WHERE subscription_id = $1)
       GROUP BY d.id ORDER BY d.id`,
      [subscriptionId],
    ),
  /** Row locks so two invoices cannot both take the last use of a discount. */
  lockByIds: (db: Db, ids: number[]) =>
    query(db, 'SELECT id FROM discounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [
      ids,
    ]),

  insert: async (db: Db, d: DiscountInput, createdBy: number) =>
    (await queryOne<{ id: number }>(
      db,
      `INSERT INTO discounts (name, type, value, scope, min_amount, min_quantity, start_date, end_date, usage_limit,
                              is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [...values(d), createdBy],
    ))!,

  update: (db: Db, id: number, d: DiscountInput) =>
    queryOne<{ id: number }>(
      db,
      `UPDATE discounts SET name=$2, type=$3, value=$4, scope=$5, min_amount=$6, min_quantity=$7, start_date=$8,
              end_date=$9, usage_limit=$10, is_active=$11, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [id, ...values(d)],
    ),

  async replaceProducts(db: Db, discountId: number, productIds: number[]) {
    await query(db, 'DELETE FROM discount_products WHERE discount_id = $1', [discountId]);
    if (productIds.length) {
      await query(
        db,
        'INSERT INTO discount_products (discount_id, product_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING',
        [discountId, productIds],
      );
    }
  },

  /** Takes one use atomically; returns false when the limit was already reached. */
  async consumeUse(
    db: Db,
    discountId: number,
    invoiceId: number,
    amount: number,
  ): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
      db,
      `UPDATE discounts SET times_used = times_used + 1
       WHERE id = $1 AND (usage_limit IS NULL OR times_used < usage_limit) RETURNING id`,
      [discountId],
    );
    if (!row) return false;
    await query(
      db,
      'INSERT INTO discount_usages (discount_id, invoice_id, amount) VALUES ($1,$2,$3)',
      [discountId, invoiceId, amount],
    );
    return true;
  },

  /** Gives uses back when an invoice is cancelled. */
  async releaseUses(db: Db, invoiceId: number) {
    await query(
      db,
      `UPDATE discounts d SET times_used = d.times_used - 1
       FROM discount_usages u WHERE u.discount_id = d.id AND u.invoice_id = $1`,
      [invoiceId],
    );
    await query(db, 'DELETE FROM discount_usages WHERE invoice_id = $1', [invoiceId]);
  },
};
