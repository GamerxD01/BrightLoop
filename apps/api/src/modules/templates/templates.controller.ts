import type { Request, Response } from 'express';
import { idParam } from '../../lib/http';
import { templatesService as s } from './templates.service';

export const templatesController = {
  list: async (_req: Request, res: Response) => void res.json({ data: await s.list() }),
  get: async (req: Request, res: Response) => void res.json({ data: await s.get(idParam(req)) }),
  create: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.save(req.body) }),
  update: async (req: Request, res: Response) =>
    void res.json({ data: await s.save(req.body, idParam(req)) }),
  remove: async (req: Request, res: Response) => {
    await s.remove(idParam(req));
    res.status(204).end();
  },
};
