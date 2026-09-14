import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool, migrate } from '../../src/server/db';
import { importParks } from '../../src/server/facilities/import';

export async function isolatedPlacesDatabase(prefix: string) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Separate QA database required.');
  const schema = prefix + '_' + randomUUID().replaceAll('-', '');
  const admin = createPool(process.env.TEST_DATABASE_URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = createPool(url.href);
  try {
    await migrate(pool);
    await importParks(
      pool,
      JSON.parse(await readFile('contracts/samples/muan-parks.json', 'utf8')),
      false,
    );
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
