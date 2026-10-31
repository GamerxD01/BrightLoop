import type { ListQuery, Role } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';
import { SqlFilter, orderBy } from '../../lib/pagination';

export interface UserRow {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  totalCount: number;
}

export const usersRepository = {
  list(db: Db, q: ListQuery & { role?: Role }) {
    const f = new SqlFilter().add('role = ?', q.role);
    if (q.q) f.add(`(full_name ILIKE ? OR email ILIKE $${f.params.length + 1})`, `%${q.q}%`);
    const order = orderBy(
      q.sort,
      q.dir,
      { name: 'full_name', createdAt: 'created_at' },
      'created_at',
    );
    const limit = f.page(q);
    return query<UserRow>(
      db,
      `SELECT id, email, full_name, role, is_active, last_login_at, created_at, count(*) OVER () AS total_count
       FROM users ${f.where} ${order} ${limit}`,
      f.params,
    );
  },

  /** Deactivating also bumps the token version, ending any open session. */
  setActive(db: Db, id: number, isActive: boolean) {
    return queryOne<{ id: number; role: Role }>(
      db,
      `UPDATE users SET is_active = $2, token_version = token_version + CASE WHEN $2 THEN 0 ELSE 1 END,
              updated_at = now()
       WHERE id = $1 RETURNING id, role`,
      [id, isActive],
    );
  },
};
