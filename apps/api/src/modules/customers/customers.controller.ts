import type { Request, Response } from 'express';
import { listQuerySchema } from '@brightloop/shared';
import { idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { customersService } from './customers.service';

export const customersController = {
  async list(req: Request, res: Response) {
    res.json(await customersService.list(getQuery(req, listQuerySchema)));
  },
  async get(req: Request, res: Response) {
    res.json({ data: await customersService.get(idParam(req)) });
  },
  async create(req: Request, res: Response) {
    res.status(201).json({ data: await customersService.create(req.body) });
  },
  async update(req: Request, res: Response) {
    res.json({ data: await customersService.update(idParam(req), req.body) });
  },
};
