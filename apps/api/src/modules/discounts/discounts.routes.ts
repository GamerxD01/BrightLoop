import { Router } from 'express';
import { discountSchema } from '@brightloop/shared';
import { adminOnly } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { discountsController as c } from './discounts.controller';

/** "Only the admin can create discount rules." Staff may read them to attach to subscriptions. */
export const discountsRoutes = Router()
  .get('/', c.list)
  .get('/:id', c.get)
  .post('/', adminOnly, validate(discountSchema), c.create)
  .put('/:id', adminOnly, validate(discountSchema), c.update);
