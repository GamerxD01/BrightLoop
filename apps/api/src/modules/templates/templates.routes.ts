import { Router } from 'express';
import { templateSchema } from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { templatesController as c } from './templates.controller';

export const templatesRoutes = Router()
  .get('/', c.list)
  .get('/:id', c.get)
  .post('/', validate(templateSchema), c.create)
  .put('/:id', validate(templateSchema), c.update)
  .delete('/:id', c.remove);
