import type { TemplateInput } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';

export interface TemplateLine {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantName: string | null;
  quantity: number;
}

export interface Template {
  id: number;
  name: string;
  planId: number;
  planName: string;
  validityDays: number;
  paymentTermId: number;
  paymentTermName: string;
  notes: string | null;
  lines: TemplateLine[];
}

const SELECT = `
  SELECT t.*, p.name AS plan_name, pt.name AS payment_term_name,
    COALESCE((
      SELECT json_agg(json_build_object(
               'id', l.id, 'productId', l.product_id, 'productName', pr.name, 'variantId', l.variant_id,
               'variantName', av.name, 'quantity', l.quantity) ORDER BY l.position, l.id)
      FROM quotation_template_lines l
      JOIN products pr ON pr.id = l.product_id
      LEFT JOIN product_variants v ON v.id = l.variant_id
      LEFT JOIN attribute_values av ON av.id = v.attribute_value_id
      WHERE l.template_id = t.id), '[]') AS lines
  FROM quotation_templates t
  JOIN plans p ON p.id = t.plan_id
  JOIN payment_terms pt ON pt.id = t.payment_term_id`;

export const templatesRepository = {
  list: (db: Db) => query<Template>(db, `${SELECT} ORDER BY t.name`),
  findById: (db: Db, id: number) => queryOne<Template>(db, `${SELECT} WHERE t.id = $1`, [id]),

  insert: async (db: Db, t: TemplateInput) =>
    (await queryOne<{ id: number }>(
      db,
      `INSERT INTO quotation_templates (name, plan_id, validity_days, payment_term_id, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [t.name, t.planId, t.validityDays, t.paymentTermId, t.notes],
    ))!,

  update: (db: Db, id: number, t: TemplateInput) =>
    queryOne<{ id: number }>(
      db,
      `UPDATE quotation_templates SET name=$2, plan_id=$3, validity_days=$4, payment_term_id=$5, notes=$6, updated_at=now()
       WHERE id=$1 RETURNING id`,
      [id, t.name, t.planId, t.validityDays, t.paymentTermId, t.notes],
    ),

  async replaceLines(db: Db, templateId: number, lines: TemplateInput['lines']) {
    await query(db, 'DELETE FROM quotation_template_lines WHERE template_id = $1', [templateId]);
    if (!lines.length) return;
    await query(
      db,
      `INSERT INTO quotation_template_lines (template_id, product_id, variant_id, quantity, position)
       SELECT $1, x.product_id, x.variant_id, x.quantity, x.position
       FROM unnest($2::bigint[], $3::bigint[], $4::int[], $5::int[]) AS x(product_id, variant_id, quantity, position)`,
      [
        templateId,
        lines.map((l) => l.productId),
        lines.map((l) => l.variantId),
        lines.map((l) => l.quantity),
        lines.map((_, i) => i),
      ],
    );
  },
};
