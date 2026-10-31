import { ROLES, type CreateStaffInput, type ListQuery, type Role } from '@brightloop/shared';
import { isUniqueViolation, pool, withTransaction } from '../../db/pool';
import { audit } from '../../lib/audit';
import { ConflictError, NotFoundError, RuleError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { paginated } from '../../lib/pagination';
import { hashPassword } from '../../lib/security';
import { authRepository } from '../auth/auth.repository';
import { usersRepository } from './users.repository';

export const usersService = {
  async list(q: ListQuery & { role?: string }) {
    const role = ROLES.includes(q.role as Role) ? (q.role as Role) : undefined;
    return paginated(await usersRepository.list(pool, { ...q, role }), q);
  },

  /** Only an admin reaches this (route guard); staff accounts are never self-created. */
  async createStaff(input: CreateStaffInput, actor: Actor) {
    const passwordHash = await hashPassword(input.password);
    try {
      return await withTransaction(async (tx) => {
        const user = await authRepository.insertUser(tx, {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
          role: 'staff',
          customerId: null,
          createdBy: actor.userId,
        });
        await audit(tx, {
          actorId: actor.userId,
          action: 'create_staff',
          entity: 'user',
          entityId: user.id,
          requestId: actor.requestId,
        });
        const { passwordHash: _p, tokenVersion: _t, ...safe } = user;
        return safe;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('An account with this email already exists', {
          email: 'Already registered',
        });
      throw err;
    }
  },

  async setActive(id: number, isActive: boolean, actor: Actor) {
    if (id === actor.userId && !isActive)
      throw new RuleError('You cannot deactivate your own account');
    const row = await usersRepository.setActive(pool, id, isActive);
    if (!row) throw new NotFoundError('User');
    await audit(pool, {
      actorId: actor.userId,
      action: isActive ? 'activate_user' : 'deactivate_user',
      entity: 'user',
      entityId: id,
      requestId: actor.requestId,
    });
    return row;
  },
};
