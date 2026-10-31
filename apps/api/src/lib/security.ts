import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '@brightloop/shared';
import { env } from '../config/env';

const BCRYPT_ROUNDS = 12;
export const SESSION_COOKIE = 'bl_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // one working day

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** A hash to compare against when the email is unknown, so timing does not reveal accounts. */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export interface SessionClaims {
  sub: number;
  role: Role;
  customerId: number | null;
  ver: number;
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS, algorithm: 'HS256' });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    return typeof payload === 'object' ? (payload as unknown as SessionClaims) : null;
  } catch {
    return null;
  }
}

/** A random URL-safe token and the sha256 we store instead of it. */
export function createOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
