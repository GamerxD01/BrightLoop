import { Router, type Request, type Response } from 'express';
import {
  invoiceListQuerySchema,
  subscriptionActionSchema,
  subscriptionListQuerySchema,
} from '@brightloop/shared';
import { pool } from '../../db/pool';
import { catalogRepository } from '../catalog/catalog.repository';
import { changesRoutes } from '../changes/changes.routes';
import { portalCreditsRoutes } from '../credits/credits.routes';
import { actorOf, idParam } from '../../lib/http';
import { getQuery, validate } from '../../middleware/validate';
import { portalService as s } from './portal.service';
import { invoicesController } from '../invoices/invoices.controller';

/** Mounted behind authenticate + customerOnly. */
export const portalRoutes = Router()
  .use('/subscriptions/:id/changes', changesRoutes)
  .use('/credits', portalCreditsRoutes)
  // What a customer can add to a subscription: active products, with variants and prices.
  .get('/addons', async (_req: Request, res: Response) => {
    const rows = await catalogRepository.listProducts(pool, {
      page: 1,
      pageSize: 100,
      dir: 'asc',
      active: true,
    });
    res.json({
      data: rows.map((p) => ({
        id: p.id,
        name: p.name,
        notes: p.notes,
        salesPrice: p.salesPrice,
        taxRateBp: p.taxRateBp,
        variants: p.variants,
      })),
    });
  })
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
  .get('/invoices/:id/pdf', invoicesController.pdf)
  .get('/invoices/:id', async (req: Request, res: Response) => {
    res.json({ data: await s.getInvoice(idParam(req), actorOf(req)) });
  });
