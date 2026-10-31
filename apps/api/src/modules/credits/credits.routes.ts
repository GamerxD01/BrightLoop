import { Router, type Request, type Response } from 'express';
import { actorOf, idParam } from '../../lib/http';
import { creditsService } from './credits.service';

/** GET /customers/:id/credits for staff. */
export const customerCreditsRoutes = Router({ mergeParams: true }).get(
  '/',
  async (req: Request, res: Response) => {
    res.json({ data: await creditsService.summary(idParam(req)) });
  },
);

/** GET /portal/credits for the signed-in customer. */
export const portalCreditsRoutes = Router().get('/', async (req: Request, res: Response) => {
  res.json({ data: await creditsService.summary(actorOf(req).customerId!) });
});
