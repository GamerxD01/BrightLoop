import express, { Router, type Request, type Response } from 'express';
import { LOGO_MAX_BYTES, companySchema } from '@brightloop/shared';
import { actorOf } from '../../lib/http';
import { adminOnly, authenticate, backOffice } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { companyService as s } from './company.service';

/** Public: the login page and emails need the brand before anyone signs in. */
export const brandRoutes = Router()
  .get('/', async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ data: await s.brand() });
  })
  .get('/logo', async (req: Request, res: Response) => {
    const row = await s.logo();
    if (!row?.logo || !row.logoMime) {
      res.status(404).end();
      return;
    }
    const etag = `"${row.updatedAt.getTime()}"`;
    if (req.header('if-none-match') === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', row.logoMime);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(row.logo);
  });

export const companyRoutes = Router()
  .get('/', authenticate, backOffice, async (_req: Request, res: Response) => {
    res.json({ data: await s.get() });
  })
  .put(
    '/',
    authenticate,
    adminOnly,
    validate(companySchema),
    async (req: Request, res: Response) => {
      res.json({ data: await s.update(req.body, actorOf(req)) });
    },
  )
  .put(
    '/logo',
    authenticate,
    adminOnly,
    express.raw({ type: ['image/png', 'image/jpeg'], limit: LOGO_MAX_BYTES + 1024 }),
    async (req: Request, res: Response) => {
      res.json({ data: await s.setLogo(req.body, actorOf(req)) });
    },
  )
  .delete('/logo', authenticate, adminOnly, async (req: Request, res: Response) => {
    res.json({ data: await s.removeLogo(actorOf(req)) });
  });
