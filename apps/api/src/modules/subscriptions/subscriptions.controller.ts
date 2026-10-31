import type { Request, Response } from 'express';
import { subscriptionListQuerySchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { subscriptionsService as s } from './subscriptions.service';

export const subscriptionsController = {
  list: async (req: Request, res: Response) =>
    void res.json(await s.list(getQuery(req, subscriptionListQuerySchema))),
  get: async (req: Request, res: Response) => void res.json({ data: await s.get(idParam(req)) }),
  preview: async (req: Request, res: Response) =>
    void res.json({ data: await s.preview(req.body) }),
  create: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.create(req.body, actorOf(req)) }),
  fromTemplate: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.createFromTemplate(req.body, actorOf(req)) }),
  update: async (req: Request, res: Response) =>
    void res.json({ data: await s.update(idParam(req), req.body, actorOf(req)) }),
  transition: async (req: Request, res: Response) =>
    void res.json({
      data: await s.transition(idParam(req), req.body.action, req.body.note ?? null, actorOf(req)),
    }),
};
