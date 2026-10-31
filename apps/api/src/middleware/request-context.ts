import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

/** Tags every request with an id (echoed in X-Request-Id and in error bodies) and logs it. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader('X-Request-Id', req.id);

  const started = performance.now();
  res.on('finish', () => {
    if (req.path === '/api/events') return;
    const ms = Math.round(performance.now() - started);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms,
        userId: req.user?.id,
      },
      'request',
    );
  });
  next();
}
