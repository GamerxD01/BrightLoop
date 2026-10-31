import { Router, type Request, type Response } from 'express';
import { invoiceActionSchema, invoiceListQuerySchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { remindersService } from '../automation/reminders.service';
import { invoicesController as c } from './invoices.controller';

export const invoicesRoutes = Router()
  .get('/', validate(invoiceListQuerySchema, 'query'), c.list)
  .get('/:id/pdf', c.pdf)
  .get('/:id/reminders', async (req: Request, res: Response) => {
    res.json({ data: await remindersService.history(idParam(req)) });
  })
  .post('/:id/remind', async (req: Request, res: Response) => {
    res.status(201).json({ data: await remindersService.sendNow(idParam(req), actorOf(req)) });
  })
  .get('/:id', c.get)
  .post('/:id/actions', validate(invoiceActionSchema), c.act);
