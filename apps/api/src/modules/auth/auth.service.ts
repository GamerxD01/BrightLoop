import type { LoginInput, ResetPasswordInput, SignupInput } from '@brightloop/shared';
import { pool, withTransaction } from '../../db/pool';
import { env } from '../../config/env';
import { ConflictError, UnauthorizedError, BadRequestError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { audit } from '../../lib/audit';
import {
  DUMMY_HASH,
  createOpaqueToken,
  hashPassword,
  sha256,
  signSession,
  verifyPassword,
} from '../../lib/security';
import { notifications } from '../notifications/notifications.service';
import { customersService } from '../customers/customers.service';
import { authRepository, type UserRecord } from './auth.repository';

const RESET_TTL_MINUTES = 30;

export interface PublicUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRecord['role'];
  customerId: number | null;
}

function toPublic(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, customerId: u.customerId };
}

function issueSession(u: UserRecord) {
  return signSession({ sub: u.id, role: u.role, customerId: u.customerId, ver: u.tokenVersion });
}

export const authService = {
  /** Self-service signup always creates a portal customer, never staff. */
  async signup(input: SignupInput, requestId: string) {
    const existing = await authRepository.findByEmail(pool, input.email);
    if (existing)
      throw new ConflictError('An account with this email already exists', {
        email: 'Already registered',
      });

    const passwordHash = await hashPassword(input.password);
    const user = await withTransaction(async (tx) => {
      const customer = await customersService.findOrCreateForSignup(tx, {
        name: input.name,
        email: input.email,
        company: input.company ?? null,
      });
      const created = await authRepository.insertUser(tx, {
        email: input.email,
        passwordHash,
        fullName: input.name,
        role: 'customer',
        customerId: customer.id,
        createdBy: null,
      });
      await audit(tx, {
        actorId: created.id,
        action: 'signup',
        entity: 'user',
        entityId: created.id,
        requestId,
      });
      return created;
    });
    notifications
      .welcome(user.email, user.fullName, user.customerId!)
      .catch((err) => logger.error({ err }, 'Welcome email failed'));
    return { user: toPublic(user), token: issueSession(user) };
  },

  async login(input: LoginInput) {
    const user = await authRepository.findByEmail(pool, input.email);
    // Always run bcrypt so a missing account takes as long as a wrong password.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedError('Email or password is incorrect');
    if (!user.isActive) throw new UnauthorizedError('This account has been deactivated');
    await authRepository.touchLogin(pool, user.id);
    return { user: toPublic(user), token: issueSession(user) };
  },

  async me(userId: number) {
    const user = await authRepository.findById(pool, userId);
    if (!user || !user.isActive) throw new UnauthorizedError();
    return toPublic(user);
  },

  /**
   * Always succeeds from the caller's point of view, so the endpoint cannot be
   * used to discover which emails have accounts.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await authRepository.findByEmail(pool, email);
    if (!user || !user.isActive) return;

    const { token, hash } = createOpaqueToken();
    await withTransaction(async (tx) => {
      await authRepository.invalidateResetTokens(tx, user.id);
      await authRepository.insertResetToken(
        tx,
        user.id,
        hash,
        new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      );
    });

    const link = `${env.APP_URL}/reset-password?token=${token}`;
    try {
      await notifications.passwordReset(user.email, user.fullName, link, RESET_TTL_MINUTES);
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Could not send password reset email');
    }
  },

  async resetPassword(input: ResetPasswordInput, requestId: string) {
    const passwordHash = await hashPassword(input.password);
    await withTransaction(async (tx) => {
      const row = await authRepository.consumeResetToken(tx, sha256(input.token));
      if (!row)
        throw new BadRequestError(
          'This reset link is invalid or has expired',
          'RESET_TOKEN_INVALID',
        );
      await authRepository.setPassword(tx, row.userId, passwordHash);
      await audit(tx, {
        actorId: row.userId,
        action: 'password_reset',
        entity: 'user',
        entityId: row.userId,
        requestId,
      });
    });
  },
};
