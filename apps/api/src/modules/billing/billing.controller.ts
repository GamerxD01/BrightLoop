import type { Request, Response } from 'express';
import { actorOf, idParam } from '../../lib/http';
import { billingService as s } from './billing.service';

export const billingController = {
  status: async (_req: Request, res: Response) =>
    void res.json({ data: { ...s.status(), due: await s.dueSummary() } }),
  run: async (req: Request, res: Response) =>
    void res.json({ data: await s.run(req.body, actorOf(req)) }),
  billOne: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.billOne(idParam(req), actorOf(req)) }),
};
