import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@brightloop/shared';
import { queryOne, pool } from '../db/pool';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { SESSION_COOKIE, verifySession } from '../lib/security';

export interface AuthUser {
  id: number;
  role: Role;
  customerId: number | null;
  fullName: string;
  email: string;
}

/**
 * Reads the httpOnly session cookie, then re-checks the user row so a
 * deactivated account or a password reset (token_version bump) ends access at once.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const claims = token ? verifySession(token) : null;
  if (!claims) throw new UnauthorizedError();

  const user = await queryOne<AuthUser & { isActive: boolean; tokenVersion: number }>(
    pool,
    `SELECT id, role, customer_id, full_name, email, is_active, token_version FROM users WHERE id = $1`,
    [claims.sub],
  );
  if (!user || !user.isActive || user.tokenVersion !== claims.ver) {
    throw new UnauthorizedError('Your session has ended. Please sign in again.');
  }
  req.user = {
    id: user.id,
    role: user.role,
    customerId: user.customerId,
    fullName: user.fullName,
    email: user.email,
  };
  next();
}

/** Allows only the listed roles through. Use after `authenticate`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (!roles.includes(req.user.role)) throw new ForbiddenError();
    next();
  };
}

/** Back-office routes: admin and staff. */
export const backOffice = requireRole('admin', 'staff');
export const adminOnly = requireRole('admin');
export const customerOnly = requireRole('customer');
