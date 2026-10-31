import type { Request, Response } from 'express';
import { listQuerySchema } from '@brightloop/shared';
import { idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { plansService as s } from './plans.service';

export const plansController = {
  list: async (req: Request, res: Response) =>
    void res.json(await s.list(getQuery(req, listQuerySchema))),
  get: async (req: Request, res: Response) => void res.json({ data: await s.get(idParam(req)) }),
  create: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.save(req.body) }),
  update: async (req: Request, res: Response) =>
    void res.json({ data: await s.save(req.body, idParam(req)) }),
};
