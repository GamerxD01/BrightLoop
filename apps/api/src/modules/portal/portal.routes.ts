import { Router, type Request, type Response } from 'express';
import {
  invoiceListQuerySchema,
  subscriptionActionSchema,
  subscriptionListQuerySchema,
} from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { getQuery, validate } from '../../middleware/validate';
import { portalService as s } from './portal.service';

/** Mounted behind authenticate + customerOnly. */
export const portalRoutes = Router()
  .get(
    '/subscriptions',
    validate(subscriptionListQuerySchema, 'query'),
    async (req: Request, res: Response) => {
      res.json(await s.listSubscriptions(getQuery(req, subscriptionListQuerySchema), actorOf(req)));
    },
  )
  .get('/subscriptions/:id', async (req: Request, res: Response) => {
    res.json({ data: await s.getSubscription(idParam(req), actorOf(req)) });
  })
  .post(
    '/subscriptions/:id/actions',
    validate(subscriptionActionSchema),
    async (req: Request, res: Response) => {
      res.json({ data: await s.act(idParam(req), req.body.action, actorOf(req)) });
    },
  )
  .get(
    '/invoices',
    validate(invoiceListQuerySchema, 'query'),
    async (req: Request, res: Response) => {
      res.json(await s.listInvoices(getQuery(req, invoiceListQuerySchema), actorOf(req)));
    },
  )
  .get('/invoices/:id', async (req: Request, res: Response) => {
    res.json({ data: await s.getInvoice(idParam(req), actorOf(req)) });
  });
