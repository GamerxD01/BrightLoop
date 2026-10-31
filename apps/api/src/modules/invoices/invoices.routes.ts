import { Router } from 'express';
import { invoiceActionSchema, invoiceListQuerySchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { invoicesController as c } from './invoices.controller';

export const invoicesRoutes = Router()
  .get('/', validate(invoiceListQuerySchema, 'query'), c.list)
  .get('/:id/pdf', c.pdf)
  .get('/:id', c.get)
  .post('/:id/actions', validate(invoiceActionSchema), c.act);
