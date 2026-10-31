import { Router } from 'express';
import {
  fromTemplateSchema,
  subscriptionActionSchema,
  subscriptionListQuerySchema,
  subscriptionSchema,
} from '@brightloop/shared';
import { validate } from '../../middleware/validate';
import { changesRoutes } from '../changes/changes.routes';
import { subscriptionsController as c } from './subscriptions.controller';

export const subscriptionsRoutes = Router()
  .get('/', validate(subscriptionListQuerySchema, 'query'), c.list)
  .post('/preview', validate(subscriptionSchema), c.preview)
  .post('/from-template', validate(fromTemplateSchema), c.fromTemplate)
  .get('/:id', c.get)
  .post('/', validate(subscriptionSchema), c.create)
  .put('/:id', validate(subscriptionSchema), c.update)
  .delete('/:id', c.removeDraft)
  .post('/:id/actions', validate(subscriptionActionSchema), c.transition)
  .use('/:id/changes', changesRoutes);
