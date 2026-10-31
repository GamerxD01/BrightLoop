import type { Role } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';

export interface UserRecord {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  customerId: number | null;
  isActive: boolean;
  tokenVersion: number;
  passwordHash: string;
}

const USER_COLUMNS =
  'id, email, full_name, role, customer_id, is_active, token_version, password_hash';

export const authRepository = {
  findByEmail(db: Db, email: string) {
    return queryOne<UserRecord>(db, `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  },

  findById(db: Db, id: number) {
    return queryOne<UserRecord>(db, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  },

  async insertUser(
    db: Db,
    user: {
      email: string;
      passwordHash: string;
      fullName: string;
      role: Role;
      customerId: number | null;
      createdBy: number | null;
    },
  ) {
    const row = await queryOne<UserRecord>(
      db,
      `INSERT INTO users (email, password_hash, full_name, role, customer_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
      [user.email, user.passwordHash, user.fullName, user.role, user.customerId, user.createdBy],
    );
    return row!;
  },

  touchLogin(db: Db, id: number) {
    return query(db, 'UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
  },

  /** New password + bumped token version: every existing session is revoked. */
  setPassword(db: Db, id: number, passwordHash: string) {
    return query(
      db,
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1`,
      [id, passwordHash],
    );
  },

  insertResetToken(db: Db, userId: number, tokenHash: string, expiresAt: Date) {
    return query(
      db,
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
  },

  /** Marks the token used and returns its user — only if it is unused and unexpired. */
  consumeResetToken(db: Db, tokenHash: string) {
    return queryOne<{ userId: number }>(
      db,
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash],
    );
  },

  invalidateResetTokens(db: Db, userId: number) {
    return query(
      db,
      'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
  },
};
