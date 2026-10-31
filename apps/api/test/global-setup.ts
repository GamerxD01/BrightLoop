import pg from 'pg';

/** Fresh schema for every test run. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/brightloop_test';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}
