import { Router } from 'express';
import { billingRunSchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { billingController as c } from './billing.controller';

export const billingRoutes = Router()
  .get('/', c.status)
  .post('/run', validate(billingRunSchema), c.run)
  .post('/subscriptions/:id', c.billOne);
