import type {
  AttributeInput,
  ListQuery,
  PaymentTermInput,
  ProductInput,
  TaxInput,
} from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface Tax {
  id: number;
  name: string;
  rateBp: number;
  isActive: boolean;
}
export interface PaymentTerm {
  id: number;
  name: string;
  dueDays: number;
}
export interface AttributeValue {
  id: number;
  attributeId: number;
  name: string;
  extraPrice: number;
}
export interface Attribute {
  id: number;
  name: string;
  values: AttributeValue[];
}
export interface Variant {
  id: number;
  attributeValueId: number;
  attributeName: string;
  valueName: string;
  extraPrice: number;
  isActive: boolean;
}
export interface Product {
  id: number;
  name: string;
  type: 'service' | 'goods';
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  taxId: number | null;
  taxName: string | null;
  taxRateBp: number | null;
  hsnSac: string | null;
  isActive: boolean;
  variants: Variant[];
  createdAt: string;
}

const PRODUCT_SELECT = `
  SELECT p.*, t.name AS tax_name, t.rate_bp AS tax_rate_bp,
    COALESCE((
      SELECT json_agg(json_build_object(
               'id', v.id, 'attributeValueId', av.id, 'attributeName', a.name, 'valueName', av.name,
               'extraPrice', av.extra_price, 'isActive', v.is_active) ORDER BY a.name, av.name)
      FROM product_variants v
      JOIN attribute_values av ON av.id = v.attribute_value_id
      JOIN product_attributes a ON a.id = av.attribute_id
      WHERE v.product_id = p.id AND v.is_active), '[]') AS variants
  FROM products p LEFT JOIN taxes t ON t.id = p.tax_id`;

export const catalogRepository = {
  // ── taxes
  listTaxes: (db: Db) => query<Tax>(db, 'SELECT * FROM taxes ORDER BY rate_bp, name'),
  findTax: (db: Db, id: number) => queryOne<Tax>(db, 'SELECT * FROM taxes WHERE id = $1', [id]),
  insertTax: async (db: Db, t: TaxInput) =>
    (await queryOne<Tax>(
      db,
      'INSERT INTO taxes (name, rate_bp, is_active) VALUES ($1,$2,$3) RETURNING *',
      [t.name, t.rateBp, t.isActive],
    ))!,
  updateTax: (db: Db, id: number, t: TaxInput) =>
    queryOne<Tax>(
      db,
      'UPDATE taxes SET name=$2, rate_bp=$3, is_active=$4 WHERE id=$1 RETURNING *',
      [id, t.name, t.rateBp, t.isActive],
    ),

  // ── payment terms
  listPaymentTerms: (db: Db) =>
    query<PaymentTerm>(db, 'SELECT * FROM payment_terms ORDER BY due_days'),
  insertPaymentTerm: async (db: Db, t: PaymentTermInput) =>
    (await queryOne<PaymentTerm>(
      db,
      'INSERT INTO payment_terms (name, due_days) VALUES ($1,$2) RETURNING *',
      [t.name, t.dueDays],
    ))!,

  // ── attributes
  listAttributes: (db: Db) =>
    query<Attribute>(
      db,
      `SELECT a.id, a.name,
              COALESCE(json_agg(json_build_object('id', v.id, 'attributeId', a.id, 'name', v.name, 'extraPrice', v.extra_price)
                       ORDER BY v.name) FILTER (WHERE v.id IS NOT NULL), '[]') AS values
       FROM product_attributes a LEFT JOIN attribute_values v ON v.attribute_id = a.id
       GROUP BY a.id ORDER BY a.name`,
    ),
  insertAttribute: async (db: Db, name: string) =>
    (await queryOne<{ id: number }>(
      db,
      'INSERT INTO product_attributes (name) VALUES ($1) RETURNING id',
      [name],
    ))!,
  renameAttribute: (db: Db, id: number, name: string) =>
    queryOne<{ id: number }>(
      db,
      'UPDATE product_attributes SET name = $2 WHERE id = $1 RETURNING id',
      [id, name],
    ),
  upsertAttributeValue: (db: Db, attributeId: number, v: AttributeInput['values'][number]) =>
    v.id
      ? query(
          db,
          'UPDATE attribute_values SET name=$3, extra_price=$4 WHERE id=$1 AND attribute_id=$2',
          [v.id, attributeId, v.name, v.extraPrice],
        )
      : query(
          db,
          'INSERT INTO attribute_values (attribute_id, name, extra_price) VALUES ($1,$2,$3)',
          [attributeId, v.name, v.extraPrice],
        ),

  // ── products
  listProducts(db: Db, q: ListQuery & { type?: string; active?: boolean }) {
    const f = new SqlFilter().add('p.type = ?', q.type);
    if (q.active !== undefined) f.add('p.is_active = ?', q.active);
    if (q.q) f.add('p.name ILIKE ?', `%${q.q}%`);
    const order = orderBy(
      q.sort,
      q.dir,
      { name: 'p.name', salesPrice: 'p.sales_price', createdAt: 'p.created_at' },
      'p.name',
    );
    const limit = f.page(q);
    return query<Product & { totalCount: number }>(
      db,
      `${PRODUCT_SELECT.replace('SELECT p.*', 'SELECT p.*, count(*) OVER () AS total_count')} ${f.where} ${order} ${limit}`,
      f.params,
    );
  },

  findProduct: (db: Db, id: number) =>
    queryOne<Product>(db, `${PRODUCT_SELECT} WHERE p.id = $1`, [id]),

  findProductsByIds: (db: Db, ids: number[]) =>
    query<Product>(db, `${PRODUCT_SELECT} WHERE p.id = ANY($1::bigint[])`, [ids]),

  insertProduct: async (db: Db, p: ProductInput) =>
    (await queryOne<{ id: number }>(
      db,
      `INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id, is_active, hsn_sac)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [p.name, p.type, p.salesPrice, p.costPrice, p.notes, p.taxId, p.isActive, p.hsnSac],
    ))!,

  updateProduct: (db: Db, id: number, p: ProductInput) =>
    queryOne<{ id: number }>(
      db,
      `UPDATE products SET name=$2, type=$3, sales_price=$4, cost_price=$5, notes=$6, tax_id=$7, is_active=$8,
              hsn_sac=$9, updated_at=now() WHERE id=$1 RETURNING id`,
      [id, p.name, p.type, p.salesPrice, p.costPrice, p.notes, p.taxId, p.isActive, p.hsnSac],
    ),

  /**
   * Variants follow the chosen attribute values. Removed ones are archived,
   * not deleted, because existing subscription lines may point at them.
   */
  async syncVariants(db: Db, productId: number, valueIds: number[]) {
    await query(
      db,
      `INSERT INTO product_variants (product_id, attribute_value_id)
       SELECT $1, unnest($2::bigint[])
       ON CONFLICT (product_id, attribute_value_id) DO UPDATE SET is_active = TRUE`,
      [productId, valueIds],
    );
    await query(
      db,
      'UPDATE product_variants SET is_active = FALSE WHERE product_id = $1 AND NOT (attribute_value_id = ANY($2::bigint[]))',
      [productId, valueIds],
    );
  },

  countAttributeValues: async (db: Db, ids: number[]) =>
    (await queryOne<{ n: number }>(
      db,
      'SELECT count(*) AS n FROM attribute_values WHERE id = ANY($1::bigint[])',
      [ids],
    ))!.n,
};
