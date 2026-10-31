import { Router } from 'express';
import { listQuerySchema, planSchema } from '@brightloop/shared';
import { adminOnly } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { plansController as c } from './plans.controller';

export const plansRoutes = Router()
  .get('/', validate(listQuerySchema, 'query'), c.list)
  .get('/:id', c.get)
  .post('/', adminOnly, validate(planSchema), c.create)
  .put('/:id', adminOnly, validate(planSchema), c.update);
