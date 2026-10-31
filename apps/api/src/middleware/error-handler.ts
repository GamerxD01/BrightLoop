import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@brightloop/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFound(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.id,
    },
  };
  res.status(404).json(body);
}

/** The one place errors become responses. Internals never leak to the client. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const log = req.log ?? logger;

  if (err instanceof AppError) {
    if (err.status >= 500) log.error({ err }, err.message);
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        fieldErrors: err.fieldErrors,
        requestId: req.id,
      },
    };
    res.status(err.status).json(body);
    return;
  }

  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'BAD_JSON', message: 'Request body is not valid JSON', requestId: req.id },
    });
    return;
  }

  log.error({ err }, 'Unhandled error');
  const body: ApiErrorBody = {
    error: { code: 'INTERNAL', message: 'Something went wrong on our side', requestId: req.id },
  };
  res.status(500).json(body);
}
