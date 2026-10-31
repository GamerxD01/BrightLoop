import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pool } from './db/pool';
import { errorHandler, notFound } from './middleware/error-handler';
import { rateLimit } from './middleware/rate-limit';
import { requestContext } from './middleware/request-context';
import { apiRoutes } from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'script-src': ["'self'"], 'connect-src': ["'self'"] },
      },
    }),
  );
  // Small bodies everywhere; bank statement uploads alone may be larger.
  const smallJson = express.json({ limit: '100kb' });
  const statementJson = express.json({ limit: '2.5mb' });
  app.use((req, res, next) =>
    req.method === 'POST' && req.path === '/api/bank-imports'
      ? statementJson(req, res, next)
      : smallJson(req, res, next),
  );
  app.use(cookieParser());
  app.use(requestContext);
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }));

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  app.use('/api', apiRoutes);
  app.use('/api', notFound);

  // In production the API also serves the built web app from one port.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
