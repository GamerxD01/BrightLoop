import type { NextFunction, Request, Response } from 'express';
import { toFieldErrors } from '@brightloop/shared';
import type { ZodTypeAny, z } from 'zod';
import { ValidationError } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and replaces req[source] with the parsed (trimmed, coerced,
 * defaulted) value. Handlers only ever see data that passed the shared schema.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) throw new ValidationError(toFieldErrors(result.error));
    if (source === 'query') {
      // Express 5 exposes req.query as a getter; store the parsed copy separately.
      req.validatedQuery = result.data;
    } else {
      (req as unknown as Record<string, unknown>)[source] = result.data;
    }
    next();
  };
}

/** Typed accessor for a validated query string. */
export function getQuery<S extends ZodTypeAny>(req: Request, _schema: S): z.infer<S> {
  return req.validatedQuery as z.infer<S>;
}
