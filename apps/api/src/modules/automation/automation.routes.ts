import { Router, type Request, type Response } from 'express';
import { actorOf } from '../../lib/http';
import { adminOnly } from '../../middleware/auth';
import { automationService as s } from './automation.service';

/** Mounted behind back-office auth; running a job by hand is admin-only. */
export const automationRoutes = Router()
  .get('/', async (_req: Request, res: Response) => {
    res.json({ data: await s.status() });
  })
  .post('/:job/run', adminOnly, async (req: Request, res: Response) => {
    res.json({ data: await s.runNow(String(req.params.job), actorOf(req)) });
  });
