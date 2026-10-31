import type { Request } from 'express';
import type { Role } from '@brightloop/shared';
import { idSchema } from '@brightloop/shared';
import { UnauthorizedError, ValidationError } from './errors';

/** Who is doing something; passed from controllers into services. */
export interface Actor {
  userId: number;
  role: Role;
  customerId: number | null;
  requestId: string;
}

export function actorOf(req: Request): Actor {
  if (!req.user) throw new UnauthorizedError();
  return {
    userId: req.user.id,
    role: req.user.role,
    customerId: req.user.customerId,
    requestId: req.id,
  };
}

/** Reads a positive integer route parameter, e.g. /subscriptions/:id. */
export function idParam(req: Request, name = 'id'): number {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success)
    throw new ValidationError({ [name]: 'Must be a positive whole number' }, 'Invalid id');
  return parsed.data;
}
