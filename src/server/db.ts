import { readFile } from 'node:fs/promises';
import pg from 'pg';

// pg returns int8 as text by default. Authentication timestamps are safe JS
// integers and must remain numeric for expiry/rate-limit arithmetic. Scope the
// parser to our pools; never change pg's process-wide parser or round large IDs.
export const databaseTypes: NonNullable<pg.PoolConfig['types']> = {
  getTypeParser(oid, format) {
    if (oid === 20 && format !== 'binary')
      return (value: string) => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds safe range.');
        return number;
      };
    return pg.types.getTypeParser(oid, format);
  },
};

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    types: databaseTypes,
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
