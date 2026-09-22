import { getMigrations } from 'better-auth/db/migration';
import { createPool } from '../src/server/db';
import { createAuth, socialProviders } from '../src/server/auth/service';
import { authMailer } from '../src/server/auth/mail';
import { migrateWalking } from '../src/server/migrations';

if (process.argv.length > 2) throw new Error('Usage: npm run with-env -- migrate');
if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET)
  throw new Error('DATABASE_URL and AUTH_SECRET are required.');

const pool = createPool(process.env.DATABASE_URL);
try {
  const auth = createAuth({
    pool,
    origin: process.env.AUTH_ORIGIN ?? 'http://127.0.0.1:3000',
    secret: process.env.AUTH_SECRET,
    sendMail: authMailer(process.env),
    providers: socialProviders(process.env),
  });
  const plan = await getMigrations(auth.options);
  if (plan.schemaProblems.length || plan.unsafeChanges.length)
    throw new Error('Authentication schema requires a reviewed migration.');
  await plan.runMigrations();
  await migrateWalking(pool);
  console.log('Authentication and domain schema migrations applied.');
} finally {
  await pool.end();
}
