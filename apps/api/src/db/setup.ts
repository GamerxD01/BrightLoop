/**
 * One-command first run: create the database if it is missing, migrate, seed.
 *   npm run setup            (from the repository root)
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { env } from '../config/env';

async function ensureDatabase() {
  const url = new URL(env.DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[\w-]+$/.test(name)) throw new Error(`Unexpected database name "${name}"`);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
      console.warn(`Created database ${name}`);
    }
  } finally {
    await admin.end();
  }
}

ensureDatabase()
  .then(() => {
    const run = (script: string, ...args: string[]) => {
      const r = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
        stdio: 'inherit',
      });
      if (r.status !== 0) process.exit(r.status ?? 1);
    };
    run('src/db/seed.ts', ...process.argv.slice(2));
  })
  .catch((err) => {
    console.error('Setup failed:', err.message);
    console.error('Check DATABASE_URL in apps/api/.env and that PostgreSQL is running.');
    process.exit(1);
  });
