import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool';
import { audit } from '../lib/audit';

const VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};
/** Sub-resources of the catalog router, by URL segment. */
const SEGMENT: Record<string, string> = {
  products: 'product',
  taxes: 'tax',
  'payment-terms': 'payment_term',
  attributes: 'attribute',
};

/**
 * Records every successful write on a router in the audit log: who, what,
 * which record (the id in the response), and the request id. For simple CRUD
 * modules whose services do not take an actor.
 */
export function auditWrites(entity: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const verb = VERB[req.method];
    if (!verb || !req.user) return next();
    // Remember the id a create returns; write the entry once the response has gone out.
    let createdId: number | null = null;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const data = (body as { data?: { id?: number } } | undefined)?.data;
      if (typeof data?.id === 'number') createdId = data.id;
      return json(body);
    };
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const segment = req.path.split('/').filter(Boolean)[0];
      const kind = (segment && SEGMENT[segment]) || entity;
      const entityId = createdId ?? (Number(req.path.match(/\/(\d+)/)?.[1]) || null);
      void audit(pool, {
        actorId: req.user!.id,
        action: `${verb}_${kind}`,
        entity: kind,
        entityId,
        requestId: req.id,
      }).catch(() => undefined);
    });
    next();
  };
}
