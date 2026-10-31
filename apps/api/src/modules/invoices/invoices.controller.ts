import type { Request, Response } from 'express';
import { invoiceListQuerySchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { invoicesService as s } from './invoices.service';

export const invoicesController = {
  list: async (req: Request, res: Response) =>
    void res.json(await s.list(getQuery(req, invoiceListQuerySchema))),
  get: async (req: Request, res: Response) => void res.json({ data: await s.get(idParam(req)) }),
  async pdf(req: Request, res: Response) {
    const file = await s.pdf(
      idParam(req),
      req.user?.role === 'customer' ? actorOf(req) : undefined,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${file.filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.content);
  },
  act: async (req: Request, res: Response) =>
    void res.json({ data: await s.act(idParam(req), req.body.action, actorOf(req)) }),
};
