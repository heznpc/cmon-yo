import { createPool, migrate } from '../src/server/db';
import { migrateMeetings } from '../src/server/services/meetings';
if (process.argv[2] !== 'migrate' || !process.env.DATABASE_URL)
  throw new Error('Usage: npm run with-env -- meetups -- migrate (after auth migrate)');
const pool = createPool(process.env.DATABASE_URL);
try {
  await migrate(pool);
  await migrateMeetings(pool);
  console.log('Meetup schema migration applied.');
} finally {
  await pool.end();
}
