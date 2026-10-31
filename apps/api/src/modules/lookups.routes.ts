import { Router, type Request, type Response } from 'express';
import { pool, query } from '../db/pool';
import { catalogRepository } from './catalog/catalog.repository';
import { discountsRepository } from './discounts/discounts.repository';
import { templatesRepository } from './templates/templates.repository';

/**
 * Everything a back-office form needs in one round trip. Small reference
 * tables only; customers are searched through their own endpoint.
 */
export const lookupsRoutes = Router().get('/', async (_req: Request, res: Response) => {
  const [taxes, paymentTerms, attributes, products, plans, templates, discounts] =
    await Promise.all([
      catalogRepository.listTaxes(pool),
      catalogRepository.listPaymentTerms(pool),
      catalogRepository.listAttributes(pool),
      catalogRepository.listProducts(pool, { page: 1, pageSize: 100, dir: 'asc', active: true }),
      query(
        pool,
        `SELECT p.id, p.name, p.price, p.billing_period, p.billing_interval, p.min_quantity, p.start_date, p.end_date,
                        p.tax_id, t.rate_bp AS tax_rate_bp, p.is_active, p.closable, p.pausable, p.renewable, p.auto_close
                 FROM plans p LEFT JOIN taxes t ON t.id = p.tax_id ORDER BY p.name`,
      ),
      templatesRepository.list(pool),
      discountsRepository.list(pool),
    ]);
  res.json({
    data: {
      taxes,
      paymentTerms,
      attributes,
      products: products.map(({ totalCount: _t, ...p }) => p),
      plans,
      templates,
      discounts,
    },
  });
});
