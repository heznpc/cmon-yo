import { readFile } from 'node:fs/promises';
import pg from 'pg';

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
    query_timeout: 2500,
    idleTimeoutMillis: 10_000,
  });
}
export async function migrate(pool: pg.Pool) {
  const sql = await readFile('db/001_places.sql', 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(15012890)');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
