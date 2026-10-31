import { Router, type Request, type Response } from 'express';
import { subscriptionChangeSchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { changesService as s } from './changes.service';

/**
 * Mid-period changes, mounted twice: under /subscriptions for staff and under
 * /portal/subscriptions for customers. The service checks ownership itself.
 */
export const changesRoutes = Router({ mergeParams: true })
  .get('/', async (req: Request, res: Response) => {
    res.json({ data: await s.history(idParam(req)) });
  })
  .post('/preview', validate(subscriptionChangeSchema), async (req: Request, res: Response) => {
    res.json({ data: await s.preview(idParam(req), req.body, actorOf(req)) });
  })
  .post('/', validate(subscriptionChangeSchema), async (req: Request, res: Response) => {
    res.status(201).json({ data: await s.apply(idParam(req), req.body, actorOf(req)) });
  });
