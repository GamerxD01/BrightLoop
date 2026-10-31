import type { Request, Response } from 'express';
import { listQuerySchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { usersService } from './users.service';

export const usersController = {
  async list(req: Request, res: Response) {
    const q = getQuery(req, listQuerySchema);
    res.json(await usersService.list({ ...q, role: req.query.role as string | undefined }));
  },
  async createStaff(req: Request, res: Response) {
    res.status(201).json({ data: await usersService.createStaff(req.body, actorOf(req)) });
  },
  async setActive(req: Request, res: Response) {
    res.json({ data: await usersService.setActive(idParam(req), req.body.isActive, actorOf(req)) });
  },
};
