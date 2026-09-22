import { migrateDatabase } from './migrations';
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
  await migrateDatabase(pool, 1);
}
