import pg from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// BIGINT (money in paise, ids, counts) → number. Safe: max paise stored is far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// BIGINT[] (e.g. array_agg of ids) → number[]; the default parser yields strings.
const INT8_ARRAY_OID = 1016 as Parameters<typeof pg.types.setTypeParser>[0];
const parseTextArray = pg.types.getTypeParser(INT8_ARRAY_OID);
pg.types.setTypeParser(INT8_ARRAY_OID, (v: string) =>
  (parseTextArray(v) as unknown as string[]).map(Number),
);
// NUMERIC from SUM/AVG → number.
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE stays a plain "YYYY-MM-DD" string; never shifted by the server timezone.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => logger.error({ err }, 'Idle database client error'));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = pg.Pool | pg.PoolClient;

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function camelize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[camel(key)] = value;
  return out as T;
}

/** Parameterised query; rows come back with camelCase keys. */
export async function query<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const started = performance.now();
  const result = await db.query(text, params);
  const ms = performance.now() - started;
  if (ms > 200) logger.warn({ ms: Math.round(ms), sql: text.slice(0, 160) }, 'Slow query');
  return result.rows.map((r) => camelize<T>(r));
}

export async function queryOne<T>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(db, text, params);
  return rows[0] ?? null;
}

/** Runs `work` in a transaction; rolls back on any thrown error. */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Maps Postgres constraint errors to messages a person can act on. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}

export function isForeignKeyViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23503';
}
