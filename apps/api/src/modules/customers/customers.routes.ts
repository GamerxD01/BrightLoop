import { Router } from 'express';
import { customerSchema, listQuerySchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { customerCreditsRoutes } from '../credits/credits.routes';
import { customersController as c } from './customers.controller';

export const customersRoutes = Router()
  .get('/', validate(listQuerySchema, 'query'), c.list)
  .get('/:id', c.get)
  .post('/', validate(customerSchema), c.create)
  .put('/:id', validate(customerSchema), c.update)
  .use('/:id/credits', customerCreditsRoutes);
