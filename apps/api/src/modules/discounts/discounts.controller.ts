import type { Request, Response } from 'express';
import { actorOf, idParam } from '../../lib/http';
import { discountsService as s } from './discounts.service';

export const discountsController = {
  list: async (_req: Request, res: Response) => void res.json({ data: await s.list() }),
  get: async (req: Request, res: Response) => void res.json({ data: await s.get(idParam(req)) }),
  create: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.save(req.body, actorOf(req)) }),
  update: async (req: Request, res: Response) =>
    void res.json({ data: await s.save(req.body, actorOf(req), idParam(req)) }),
};
