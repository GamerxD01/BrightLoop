import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { idSchema, listQuerySchema } from '@brightloop/shared';
import { pool, query, queryOne } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';
import { idParam } from '../../lib/http';
import { SqlFilter, paginated } from '../../lib/pagination';
import { getQuery, validate } from '../../middleware/validate';

const outboxQuery = listQuerySchema.extend({
  kind: z.string().max(20).optional(),
  entity: z.enum(['invoice', 'subscription', 'customer']).optional(),
  entityId: idSchema.optional(),
});

/** Every email the system sent or recorded, newest first. Mounted for back office. */
export const outboxRoutes = Router()
  .get('/', validate(outboxQuery, 'query'), async (req: Request, res: Response) => {
    const q = getQuery(req, outboxQuery);
    const f = new SqlFilter()
      .add('kind = ?', q.kind)
      .add('entity = ?', q.entity)
      .add('entity_id = ?', q.entityId);
    if (q.q) f.add(`(to_address ILIKE ? OR subject ILIKE $${f.params.length + 1})`, `%${q.q}%`);
    const limit = f.page(q);
    const rows = await query<{ totalCount: number }>(
      pool,
      `SELECT id, kind, to_address, subject, status, error, entity, entity_id, customer_id, attachments, created_at,
              count(*) OVER () AS total_count
       FROM email_log ${f.where} ORDER BY created_at DESC, id DESC ${limit}`,
      f.params,
    );
    res.json(paginated(rows, q));
  })
  .get('/:id', async (req: Request, res: Response) => {
    const row = await queryOne(pool, 'SELECT * FROM email_log WHERE id = $1', [idParam(req)]);
    if (!row) throw new NotFoundError('Email');
    res.json({ data: row });
  });
