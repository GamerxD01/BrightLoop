import { Router } from 'express';
import { paymentListQuerySchema, paymentSchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { paymentsController as c } from './payments.controller';

export const paymentsRoutes = Router()
  .get('/', validate(paymentListQuerySchema, 'query'), c.list)
  .post('/', validate(paymentSchema), c.record);
