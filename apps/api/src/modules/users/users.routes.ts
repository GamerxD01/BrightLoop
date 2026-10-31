import { Router } from 'express';
import { createStaffSchema, listQuerySchema, updateUserSchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { usersController as c } from './users.controller';

/** Mounted behind adminOnly. */
export const usersRoutes = Router()
  .get('/', validate(listQuerySchema.passthrough(), 'query'), c.list)
  .post('/', validate(createStaffSchema), c.createStaff)
  .patch('/:id', validate(updateUserSchema), c.setActive);
