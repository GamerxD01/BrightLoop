import type { Request, Response } from 'express';
import { listQuerySchema } from '@brightloop/shared';
import { idParam } from '../../lib/http';
import { getQuery } from '../../middleware/validate';
import { catalogService as s } from './catalog.service';

export const catalogController = {
  listTaxes: async (_req: Request, res: Response) => void res.json({ data: await s.listTaxes() }),
  createTax: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.saveTax(req.body) }),
  updateTax: async (req: Request, res: Response) =>
    void res.json({ data: await s.saveTax(req.body, idParam(req)) }),

  listPaymentTerms: async (_req: Request, res: Response) =>
    void res.json({ data: await s.listPaymentTerms() }),
  createPaymentTerm: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.createPaymentTerm(req.body) }),

  listAttributes: async (_req: Request, res: Response) =>
    void res.json({ data: await s.listAttributes() }),
  createAttribute: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.saveAttribute(req.body) }),
  updateAttribute: async (req: Request, res: Response) =>
    void res.json({ data: await s.saveAttribute(req.body, idParam(req)) }),

  async listProducts(req: Request, res: Response) {
    const q = getQuery(req, listQuerySchema);
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const active =
      req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
    res.json(
      await s.listProducts({
        ...q,
        type: type === 'service' || type === 'goods' ? type : undefined,
        active,
      }),
    );
  },
  getProduct: async (req: Request, res: Response) =>
    void res.json({ data: await s.getProduct(idParam(req)) }),
  createProduct: async (req: Request, res: Response) =>
    void res.status(201).json({ data: await s.saveProduct(req.body) }),
  updateProduct: async (req: Request, res: Response) =>
    void res.json({ data: await s.saveProduct(req.body, idParam(req)) }),
};
