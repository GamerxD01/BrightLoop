import { Router, type Request, type Response } from 'express';
import { bankImportSchema, bankLineUpdateSchema, bankPostSchema } from '@brightloop/shared';
import { actorOf, idParam } from '../../lib/http';
import { validate } from '../../middleware/validate';
import { bankService as s } from './bank.service';

/** Mounted behind back-office auth. */
export const bankRoutes = Router()
  .get('/', async (_req: Request, res: Response) => {
    res.json({ data: await s.list() });
  })
  .get('/sample', async (_req: Request, res: Response) => {
    res
      .type('text/csv')
      .attachment('sample-bank-statement.csv')
      .send(await s.sample());
  })
  .post('/', validate(bankImportSchema), async (req: Request, res: Response) => {
    res.status(201).json({ data: await s.import(req.body, actorOf(req)) });
  })
  .get('/:id', async (req: Request, res: Response) => {
    res.json({ data: await s.get(idParam(req)) });
  })
  .patch(
    '/:id/lines/:lineId',
    validate(bankLineUpdateSchema),
    async (req: Request, res: Response) => {
      res.json({
        data: await s.updateLine(idParam(req), idParam(req, 'lineId'), req.body, actorOf(req)),
      });
    },
  )
  .post('/:id/post', validate(bankPostSchema), async (req: Request, res: Response) => {
    res.json({ data: await s.post(idParam(req), req.body.lineIds, actorOf(req)) });
  });
