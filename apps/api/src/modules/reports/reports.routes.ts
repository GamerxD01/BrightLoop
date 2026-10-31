import { Router, type Request, type Response } from 'express';
import { reportQuerySchema } from '@brightloop/shared';
import { getQuery, validate } from '../../middleware/validate';
import { reportsService } from './reports.service';

export const reportsRoutes = Router().get(
  '/summary',
  validate(reportQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    res.json({ data: await reportsService.summary(getQuery(req, reportQuerySchema)) });
  },
);
