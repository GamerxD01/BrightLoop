import { Router, type Request, type Response } from 'express';
import { idSchema, isoDateSchema, listQuerySchema } from '@brightloop/shared';
import { z } from 'zod';
import { pool, query } from '../../db/pool';
import { SqlFilter, paginated } from '../../lib/pagination';
import { getQuery, validate } from '../../middleware/validate';

const activityQuerySchema = listQuerySchema.extend({
  actorId: idSchema.optional(),
  action: z.string().trim().max(60).optional(),
  entity: z.string().trim().max(40).optional(),
  entityId: idSchema.optional(),
  requestId: z.string().trim().max(64).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

/**
 * The audit log, readable: who did what to which record, when, and the
 * request id that ties it to the server log. Admin only (mounted that way).
 */
export const activityRoutes = Router()
  .get('/', validate(activityQuerySchema, 'query'), async (req: Request, res: Response) => {
    const q = getQuery(req, activityQuerySchema);
    const f = new SqlFilter()
      .add('a.actor_id = ?', q.actorId)
      .add('a.action = ?', q.action)
      .add('a.entity = ?', q.entity)
      .add('a.entity_id = ?', q.entityId)
      .add('a.request_id = ?', q.requestId)
      .add('a.created_at >= ?::date', q.from)
      .add(`a.created_at < ?::date + 1`, q.to);
    if (q.q)
      f.add(
        `(a.action ILIKE ? OR a.entity ILIKE $${f.params.length + 1} OR u.full_name ILIKE $${f.params.length + 1})`,
        `%${q.q}%`,
      );
    const limit = f.page(q);
    const rows = await query<{ totalCount: number }>(
      pool,
      `SELECT a.id, a.action, a.entity, a.entity_id, a.data, a.request_id, a.created_at,
              a.actor_id, u.full_name AS actor_name, u.role AS actor_role, count(*) OVER () AS total_count
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${f.where} ORDER BY a.created_at DESC, a.id DESC ${limit}`,
      f.params,
    );
    res.json(paginated(rows, q));
  })
  .get('/facets', async (_req: Request, res: Response) => {
    const [actions, actors] = await Promise.all([
      query<{ action: string; n: number }>(
        pool,
        'SELECT action, count(*) AS n FROM audit_log GROUP BY action ORDER BY action',
      ),
      query<{ id: number; fullName: string }>(
        pool,
        `SELECT DISTINCT u.id, u.full_name FROM audit_log a JOIN users u ON u.id = a.actor_id ORDER BY u.full_name`,
      ),
    ]);
    res.json({ data: { actions, actors } });
  });
