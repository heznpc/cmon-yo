import { readFile, writeFile } from 'node:fs/promises';
import { createPool, migrate } from '../src/server/db';
import { collectParks } from '../src/server/facilities/source';
import { importParks } from '../src/server/facilities/import';

const [command, path] = process.argv.slice(2);
try {
  if (command === 'capture' && path) {
    const snapshot = await collectParks();
    await writeFile(path, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        status: 'captured',
        received: snapshot.collection.received,
        pilot: snapshot.expectedCount,
        capturedAt: snapshot.capturedAt,
      }),
    );
  } else {
    if (!process.env.DATABASE_URL) throw new Error('missing database');
    const pool = createPool(process.env.DATABASE_URL);
    try {
      if (command === 'migrate') {
        await migrate(pool);
        console.log('Migration applied');
      } else if (['dry-run', 'apply'].includes(command) && path) {
        const report = await importParks(
          pool,
          JSON.parse(await readFile(path, 'utf8')),
          command === 'dry-run',
        );
        console.log(JSON.stringify(report));
        if (report.status !== 'succeeded') process.exitCode = 1;
      } else throw new Error('usage');
    } finally {
      await pool.end();
    }
  }
} catch {
  console.error(
    'Facility operation failed. Check command, source file and database configuration; no changes from an incomplete capture are published.',
  );
  process.exitCode = 1;
}
