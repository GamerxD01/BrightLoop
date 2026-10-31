import type { Request, Response } from 'express';
import { paymentListQuerySchema } from '@brightloop/shared';
import { actorOf } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { paymentsService as s } from './payments.service';

export const paymentsController = {
  list: async (req: Request, res: Response) =>
    void res.json(await s.list(getQuery(req, paymentListQuerySchema))),
  record: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.record(req.body, actorOf(req)) }),
};
